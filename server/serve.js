const http = require('http');
const fs = require('fs');
const path = require('path');

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
const WEBHOOK_URL = process.env.WEBHOOK_URL || ('http://localhost:' + PORT + '/webhook/internal');

// Services
const { addClient, removeClient, initPubSub } = require('./services/sse');
const { startSync } = require('./services/sync');
const { proxyToEvo } = require('./services/evolution');
const redis = require('./services/redis');
const { evoRequest } = require('./services/evolution');

// Middleware
const { checkAuth, handleLogin, handleVerify, handleResend, handleRegisterPage, handleRegister, handleLogout, seedAdmin, hashPassword, getPool } = require('./middleware/auth');
const { isRateLimited } = require('./middleware/rateLimit');

// Routes
const { handleWebhook } = require('./routes/webhook');
const { handleAiSuggest, handleAiSearch, handleAiOrganize } = require('./routes/ai');
const { serveStatic } = require('./routes/static');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://maps.googleapis.com https://pps.whatsapp.net; media-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
};

// Start background sync and Redis pub/sub
startSync();
initPubSub();

// Message queue processor — sends scheduled messages
setInterval(async () => {
  const msgs = await redis.dequeueReady();
  for (const msg of msgs) {
    try {
      if (msg.type === 'text' && msg.instance && msg.body) {
        await evoRequest('POST', '/message/sendText/' + msg.instance, msg.body);
        console.log('[Queue] Sent scheduled message to', msg.body.number);
      }
    } catch (err) {
      console.error('[Queue] Error:', err.message);
    }
  }
}, 5000);

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

  // Health check (no auth)
  if (req.method === 'GET' && urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
    return;
  }

  // Login (no auth)
  if (req.method === 'POST' && urlPath === '/auth/login') {
    return handleLogin(req, res, SECURITY_HEADERS);
  }

  // 2FA verify (no auth — user is mid-login)
  if (req.method === 'POST' && urlPath === '/auth/verify') {
    return handleVerify(req, res, SECURITY_HEADERS);
  }

  // 2FA resend (no auth — user is mid-login)
  if (req.method === 'POST' && urlPath === '/auth/resend') {
    return handleResend(req, res, SECURITY_HEADERS);
  }

  // Register (no auth)
  if (urlPath === '/auth/register') {
    if (req.method === 'GET') return handleRegisterPage(req, res, SECURITY_HEADERS);
    if (req.method === 'POST') return handleRegister(req, res, SECURITY_HEADERS);
  }

  // Logout (no auth check needed)
  if (req.method === 'GET' && urlPath === '/auth/logout') {
    return handleLogout(req, res, SECURITY_HEADERS);
  }

  // Webhook receiver (HMAC-authenticated — Evolution API calls this)
  if (req.method === 'POST' && urlPath === '/webhook/internal') {
    return handleWebhook(req, res, SECURITY_HEADERS);
  }

  // Auth check (async for Redis sessions)
  handleAuthenticated(req, res, ip, urlPath, fullApiPath);
}).listen(PORT, () => {
  const PANEL_PASS = process.env.PANEL_PASS || '';
  const PANEL_USER = process.env.PANEL_USER || 'admin';
  console.log('Serving Manhattan on http://localhost:' + PORT);
  if (PANEL_PASS) console.log('Auth enabled (user: ' + PANEL_USER + ')');
  else console.log('WARNING: No PANEL_PASS set, auth disabled. Set PANEL_PASS in .env for production.');
  if (redis.isAvailable()) console.log('Redis connected');
  else console.log('Redis not available, using in-memory fallback');
  seedAdmin();
});

async function handleAuthenticated(req, res, ip, urlPath, fullApiPath) {
  const authResult = await checkAuth(req, res, SECURITY_HEADERS);
  if (!authResult) return;

  // SSE endpoint
  if (req.method === 'GET' && urlPath === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    });
    res.write('event: connected\ndata: {"status":"ok"}\n\n');
    addClient(res);
    req.on('close', () => removeClient(res));
    return;
  }

  // Config endpoint
  if (req.method === 'GET' && urlPath === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ webhookUrl: WEBHOOK_URL }));
    return;
  }

  // Current user info
  if (req.method === 'GET' && urlPath === '/api/me') {
    const user = req.user || {};
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ userId: user.userId, username: user.username, role: user.role }));
    return;
  }

  // User management (admin only)
  if (urlPath === '/api/users' || urlPath.startsWith('/api/users/')) {
    const isAdmin = req.user && req.user.role === 'admin';
    if (!isAdmin) {
      res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Admin access required' }));
      return;
    }

    // PATCH /api/users/:id/role — toggle role
    const roleMatch = urlPath.match(/^\/api\/users\/([^/]+)\/role$/);
    if (req.method === 'PATCH' && roleMatch) {
      let body = '';
      req.on('data', c => { if (body.length < 1024) body += c; });
      req.on('end', async () => {
        try {
          const { role } = JSON.parse(body);
          if (role !== 'admin' && role !== 'user') {
            res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
            res.end(JSON.stringify({ error: 'role must be admin or user' }));
            return;
          }
          const db = getPool();
          if (!db) {
            res.writeHead(503, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
            res.end(JSON.stringify({ error: 'Database not configured' }));
            return;
          }
          const result = await db.query(
            'UPDATE "PanelUser" SET role = $1, "updatedAt" = NOW() WHERE id = $2 RETURNING id, username, name, role, email, active',
            [role, roleMatch[1]]
          );
          if (result.rows.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
            res.end(JSON.stringify({ error: 'User not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
          res.end(JSON.stringify(result.rows[0]));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/users') {
      let body = '';
      req.on('data', c => { if (body.length < 4096) body += c; });
      req.on('end', async () => {
        try {
          const { username, password, name, email, phone } = JSON.parse(body);
          if (!username || !password) {
            res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
            res.end(JSON.stringify({ error: 'username and password required' }));
            return;
          }
          const db = getPool();
          if (!db) {
            res.writeHead(503, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
            res.end(JSON.stringify({ error: 'Database not configured' }));
            return;
          }
          const hash = await hashPassword(password);
          const result = await db.query(
            `INSERT INTO "PanelUser" (username, "passwordHash", name, role, email, phone)
             VALUES ($1, $2, $3, 'user', $4, $5)
             ON CONFLICT (username) DO UPDATE SET "passwordHash" = $2, name = $3, email = COALESCE($4, "PanelUser".email), phone = COALESCE($5, "PanelUser".phone), "updatedAt" = NOW()
             RETURNING id, username, name, role, email, phone, "createdAt"`,
            [username, hash, name || username, email || null, phone || null]
          );
          res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
          res.end(JSON.stringify(result.rows[0]));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
    if (req.method === 'GET' && urlPath === '/api/users') {
      try {
        const db = getPool();
        if (!db) {
          res.writeHead(503, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
          res.end(JSON.stringify({ error: 'Database not configured' }));
          return;
        }
        const result = await db.query('SELECT id, username, name, role, email, active, "createdAt" FROM "PanelUser" ORDER BY "createdAt"');
        res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify(result.rows));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
  }

  // Message queue — schedule a message
  if (req.method === 'POST' && urlPath === '/queue/schedule') {
    let body = '';
    req.on('data', c => { if (body.length < 65536) body += c; });
    req.on('end', async () => {
      try {
        const { instance, number, text, sendAt } = JSON.parse(body);
        if (!instance || !number || !text || !sendAt) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
          res.end(JSON.stringify({ error: 'instance, number, text, sendAt required' }));
          return;
        }
        const ok = await redis.enqueueMessage(
          { type: 'text', instance, body: { number, text, linkPreview: true } },
          new Date(sendAt).getTime()
        );
        if (!ok) {
          res.writeHead(503, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
          res.end(JSON.stringify({ error: 'Redis not available for queue' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ ok: true, sendAt }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // Message queue — check status
  if (req.method === 'GET' && urlPath === '/queue/status') {
    const size = await redis.queueSize();
    res.writeHead(200, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ queued: size, redis: redis.isAvailable() }));
    return;
  }

  // AI suggest
  if (req.method === 'POST' && urlPath === '/ai/suggest') {
    if (await isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    return handleAiSuggest(req, res, SECURITY_HEADERS);
  }

  // AI search across conversations
  if (req.method === 'POST' && urlPath === '/ai/search') {
    if (await isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    return handleAiSearch(req, res, SECURITY_HEADERS);
  }

  // AI organize ideas
  if (req.method === 'POST' && urlPath === '/ai/organize') {
    if (await isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    return handleAiOrganize(req, res, SECURITY_HEADERS);
  }

  // Proxy to Evolution API
  const apiPrefixes = ['/instance/', '/message/', '/chat/', '/group/', '/webhook/'];
  if (apiPrefixes.some(p => urlPath.startsWith(p))) {
    if (await isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    return proxyToEvo(req, res, fullApiPath, SECURITY_HEADERS);
  }

  // Static files
  serveStatic(req, res, urlPath, SECURITY_HEADERS);
}
