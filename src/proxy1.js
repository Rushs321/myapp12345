"use strict";
/*
 * proxy.js
 * The bandwidth hero proxy handler.
 * proxy(httpRequest, httpResponse);
 */
import got from "got";
import _ from "lodash";
import shouldCompress from "./shouldCompress.js";
import redirect from "./redirect.js";
import compress from "./compress.js";
import copyHeaders from "./copyHeaders.js"; // Assuming these are your modules
const { pick } = _;


export default async function proxy(req, res) {
  /*
   * Avoid loopback that could cause a server hang.
   */
 /* if (
    req.headers["via"] === "1.1 bandwidth-hero" &&
    ["127.0.0.1", "::1"].includes(req.headers["x-forwarded-for"] || req.ip)
  ) {
    return redirect(req, res);
  }*/

  try {
    const options = {
      headers: {
        ...pick(req.headers, ["cookie", "dnt", "referer", "range"]),
        "user-agent": "Bandwidth-Hero Compressor",
      },
      followRedirect: false, // We handle redirects manually
      throwHttpErrors: false, // We handle errors based on status code
      retry: { limit: 2 }, // Optionally, define retry limits (if needed)
      timeout: { request: 10000 },
      decompress: true
    };

    // Using got.stream to initiate the request and stream data
    let origin = await got.stream(req.params.url, options);

    // Stream event listeners
    origin.on("response", (response) => {
      _onRequestResponse(response, req, res); // Response handler function
    });

    origin.on("error", (err) => {
      _onRequestError(req, res, err); // Error handler function
    });

  } catch (err) {
    _onRequestError(req, res, err);
  }
}

function _onRequestError(req, res, err) {
  // Ignore invalid URL.
  if (err.code === "ERR_INVALID_URL") {
    return res.status(400).send("Invalid URL");
  }

  /*
   * When there's a real error, Redirect then destroy the stream immediately.
   */
  redirect(req, res);
  console.error(err);
}

function _onRequestResponse(response, req, res) {
  // Handle error-like status codes (4xx/5xx)
  if (origin.statusCode >= 400) {
    return redirect(req, res);
  }

  // Handle redirects (3xx)
  if (response.statusCode >= 300 && response.headers.location) {
    return redirect(req, res);
  }

  // Add headers from origin to client response
  copyHeaders(response, res);
  res.setHeader("content-encoding", "identity");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");

  req.params.originType = response.headers["content-type"] || "";
  req.params.originSize = response.headers["content-length"] || "0";

  // Handle stream errors
  origin.on("error", () => req.socket.destroy());

  // Check if we should compress the response
  if (shouldCompress(req)) {
    /*
     * sharp supports streaming – stream from the origin and pipe it through compression
     */
    return compress(req, res, origin);
  } else {
    /*
     * If no compression, pipe the origin response as-is to the client.
     */
    res.setHeader("x-proxy-bypass", 1);

    for (const headerName of ["accept-ranges", "content-type", "content-length", "content-range"]) {
      if (headerName in response.headers) {
        res.setHeader(headerName, response.headers[headerName]);
      }
    }

    // Directly pipe the origin stream to the response stream
    return origin.pipe(res);
  }
}
