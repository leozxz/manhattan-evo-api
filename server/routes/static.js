const fs = require('fs');
const path = require('path');

// Serve React build if available, fallback to legacy public/
const reactDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
const legacyPublic = path.join(__dirname, '..', '..', 'public');
const isReact = fs.existsSync(path.join(reactDist, 'index.html'));
const DIR = isReact ? reactDist : legacyPublic;

// Legacy whitelist (only for vanilla JS frontend)
const LEGACY_WHITELIST = new Set(['index.html', 'favicon.png', 'css', 'js', 'audios']);
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
  const filePath = path.resolve(path.join(DIR, requestedFile));

  // Path traversal protection
  if (!filePath.startsWith(DIR + path.sep) && filePath !== DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain', ...securityHeaders });
    res.end('Forbidden');
    return;
  }

  // For legacy public/, enforce whitelist
  if (!isReact) {
    const topLevel = requestedFile.split('/')[0];
    if (!LEGACY_WHITELIST.has(topLevel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...securityHeaders });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
      res.writeHead(403, { 'Content-Type': 'text/plain', ...securityHeaders });
      res.end('Forbidden');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: serve index.html for non-file routes (React Router)
      if (isReact && !ext) {
        const indexPath = path.join(DIR, 'index.html');
        fs.readFile(indexPath, (err2, indexData) => {
          if (err2) {
            res.writeHead(404, { 'Content-Type': 'text/plain', ...securityHeaders });
            res.end('Not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache', ...securityHeaders });
          res.end(indexData);
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain', ...securityHeaders });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      ...securityHeaders,
    });
    res.end(data);
  });
}

module.exports = { serveStatic };
