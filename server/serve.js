const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env file if present (simple parser, no dependencies)
const ROOT = path.join(__dirname, '..');
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  });
}

const PORT = process.env.PORT || 3000;
const EVO_API_URL = process.env.EVO_API_URL || 'http://localhost:8080';
const EVO_API_KEY = process.env.EVO_API_KEY || '';
const PANEL_USER = process.env.PANEL_USER || 'admin';
const PANEL_PASS = process.env.PANEL_PASS || '';
const DIR = path.join(__dirname, '..', 'public');
const WEBHOOK_URL = process.env.WEBHOOK_URL || ('http://localhost:' + PORT + '/webhook/internal');

// SSE (Server-Sent Events) client management
const sseClients = new Set();

function broadcastSSE(event, data) {
  const msg = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

// Whitelist of public directories/files (only these are served statically)
const PUBLIC_WHITELIST = new Set(['index.html', 'css', 'js', 'audios']);
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

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://maps.googleapis.com; media-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
};

// Simple rate limiter for proxy routes
const rateLimit = {};
const RATE_WINDOW = 60000; // 1 minute
const RATE_MAX = 120; // max requests per window

function isRateLimited(ip) {
  const now = Date.now();
  if (!rateLimit[ip] || now - rateLimit[ip].start > RATE_WINDOW) {
    rateLimit[ip] = { start: now, count: 1 };
    return false;
  }
  rateLimit[ip].count++;
  return rateLimit[ip].count > RATE_MAX;
}

// Clean up rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const ip in rateLimit) {
    if (now - rateLimit[ip].start > RATE_WINDOW) delete rateLimit[ip];
  }
}, RATE_WINDOW);

// Basic auth check
function checkAuth(req, res) {
  if (!PANEL_PASS) return true; // auth disabled if no password set

  // Check session cookie
  const cookies = parseCookies(req);
  if (cookies.session && isValidSession(cookies.session)) return true;

  // Check if this is a login POST
  if (req.method === 'POST' && req.url === '/auth/login') return 'login';

  // Send 401
  res.writeHead(401, { 'Content-Type': 'text/html', ...SECURITY_HEADERS });
  res.end(loginPage());
  return false;
}

const sessions = {};

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = Date.now();
  return token;
}

function isValidSession(token) {
  const created = sessions[token];
  if (!created) return false;
  // Sessions expire after 24h
  if (Date.now() - created > 86400000) {
    delete sessions[token];
    return false;
  }
  return true;
}

function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, v] = c.trim().split('=');
    if (k && v) cookies[k] = v;
  });
  return cookies;
}

function loginPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login - Manhattan</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;height:100vh}
.login{background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);width:320px}
h2{margin-bottom:24px;color:#111b21;text-align:center}
input{width:100%;padding:10px 12px;border:1px solid #dfe5e7;border-radius:8px;font-size:14px;margin-bottom:12px}
button{width:100%;padding:10px;background:#25d366;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600}
button:hover{background:#1da851}.err{color:#ea0038;font-size:13px;text-align:center;margin-bottom:12px}</style></head>
<body><div class="login"><h2>Manhattan</h2><div id="err" class="err"></div>
<form method="POST" action="/auth/login">
<input name="user" placeholder="Usuario" required>
<input name="pass" type="password" placeholder="Senha" required>
<button type="submit">Entrar</button></form></div></body></html>`;
}

function handleLogin(req, res) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const params = new URLSearchParams(body);
    const user = params.get('user');
    const pass = params.get('pass');

    if (user === PANEL_USER && pass === PANEL_PASS) {
      const token = createSession();
      res.writeHead(302, {
        'Set-Cookie': 'session=' + token + '; HttpOnly; SameSite=Strict; Path=/',
        'Location': '/',
      });
      res.end();
    } else {
      res.writeHead(401, { 'Content-Type': 'text/html', ...SECURITY_HEADERS });
      res.end(loginPage().replace('<div id="err" class="err"></div>', '<div id="err" class="err">Usuario ou senha incorretos</div>'));
    }
  });
}

function proxyToEvo(req, res, apiPath) {
  const url = new URL(apiPath, EVO_API_URL);
  const client = url.protocol === 'https:' ? https : http;

  const proxyHeaders = { 'apikey': EVO_API_KEY };
  if (req.headers['content-type']) proxyHeaders['Content-Type'] = req.headers['content-type'];
  if (req.headers['content-length']) proxyHeaders['Content-Length'] = req.headers['content-length'];
  if (req.headers['transfer-encoding']) proxyHeaders['Transfer-Encoding'] = req.headers['transfer-encoding'];

  const proxyReq = client.request({
    hostname: url.hostname, port: url.port || undefined,
    path: url.pathname + url.search, method: req.method, headers: proxyHeaders,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      'Cache-Control': 'no-cache', ...SECURITY_HEADERS,
    });
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ error: 'Evolution API unavailable' }));
  });
  req.pipe(proxyReq);
}

http.createServer((req, res) => {
  const ip = req.socket.remoteAddress || '';

  // Safe URL decode
  const [rawPath, queryString] = req.url.split('?');
  let urlPath;
  try {
    urlPath = decodeURIComponent(rawPath);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Bad request');
    return;
  }
  const fullApiPath = queryString ? urlPath + '?' + queryString : urlPath;

  // Handle login POST
  if (req.method === 'POST' && urlPath === '/auth/login') {
    return handleLogin(req, res);
  }

  // Auth check (skip if PANEL_PASS not set)
  const authResult = checkAuth(req, res);
  if (!authResult) return;

  // SSE endpoint — stream real-time events to frontend
  if (req.method === 'GET' && urlPath === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    });
    res.write('event: connected\ndata: {"status":"ok"}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Config endpoint — returns webhook URL for instance setup
  if (req.method === 'GET' && urlPath === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ webhookUrl: WEBHOOK_URL }));
    return;
  }

  // Internal webhook receiver — Evolution API sends events here
  if (req.method === 'POST' && urlPath === '/webhook/internal') {
    let body = '';
    req.on('data', c => { if (body.length < 65536) body += c; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const event = data.event || 'unknown';
        console.log('[webhook]', event, JSON.stringify(data).substring(0, 800));
        broadcastSSE(event, data);
      } catch (e) { console.log('[webhook] parse error:', e.message); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }

  // Proxy API routes to Evolution API (server-side, key never exposed)
  const apiPrefixes = ['/instance/', '/message/', '/chat/', '/group/', '/webhook/'];
  if (apiPrefixes.some(p => urlPath.startsWith(p))) {
    if (isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    return proxyToEvo(req, res, fullApiPath);
  }

  // Static file serving — whitelist only
  const requestedFile = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const topLevel = requestedFile.split('/')[0];

  if (!PUBLIC_WHITELIST.has(topLevel)) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Not found');
    return;
  }

  const filePath = path.resolve(path.join(DIR, requestedFile));

  // Path traversal protection
  if (!filePath.startsWith(DIR + path.sep) && filePath !== DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Forbidden');
    return;
  }

  // Extension whitelist
  const ext = path.extname(filePath).toLowerCase();
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    res.writeHead(403, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
    res.end('Forbidden');
    return;
  }

  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log('Serving Manhattan on http://localhost:' + PORT);
  if (PANEL_PASS) console.log('Auth enabled (user: ' + PANEL_USER + ')');
  else console.log('WARNING: No PANEL_PASS set, auth disabled. Set PANEL_PASS in .env for production.');
});
