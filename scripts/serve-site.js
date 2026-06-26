/* Minimal static file server for the built ./site bundle.
   Used by the Playwright browser test (and handy for local previews) so the
   smoke test exercises exactly what gets deployed, with no extra dependency. */

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'site');
const port = Number(process.env.PORT) || 4173;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(root, relative));

  // Prevent path traversal outside the bundle root.
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, () => console.log(`serve-site: serving site/ on http://localhost:${port}`));
