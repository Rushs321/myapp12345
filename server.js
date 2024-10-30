import app from './index.js'; // Import the app from index.js
import http from 'http'; // Import the http module

const server = http.createServer(app);
server.listen(process.env.PORT || 8080);
