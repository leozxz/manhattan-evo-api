const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'public');

const PUBLIC_WHITELIST = new Set(['index.html', 'favicon.png', 'css', 'js', 'audios']);
const ALLOWED_EXTENSIONS = new Set(['.html', '.js', '.css', '.mp3', '.ogg', '.wav', '.png', '.jpg', '.gif', '.svg', '.json']);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res, urlPath, securityHeaders) {
  const requestedFile = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const topLevel = requestedFile.split('/')[0];

  if (!PUBLIC_WHITELIST.has(topLevel)) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...securityHeaders });
    res.end('Not found');
    return;
  }

  const filePath = path.resolve(path.join(DIR, requestedFile));

  if (!filePath.startsWith(DIR + path.sep) && filePath !== DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain', ...securityHeaders });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    res.writeHead(403, { 'Content-Type': 'text/plain', ...securityHeaders });
    res.end('Forbidden');
    return;
  }

  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...securityHeaders });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      ...securityHeaders,
    });
    res.end(data);
  });
}

module.exports = { serveStatic };
