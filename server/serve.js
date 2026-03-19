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
const { checkAuth, handleLogin } = require('./middleware/auth');
const { isRateLimited } = require('./middleware/rateLimit');

// Routes
const { handleWebhook } = require('./routes/webhook');
const { handleAiSuggest } = require('./routes/ai');
const { serveStatic } = require('./routes/static');
const knowledge = require('./knowledge');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://maps.googleapis.com https://pps.whatsapp.net; media-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
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

  // Webhook receiver (no auth — Evolution API calls this)
  if (req.method === 'POST' && urlPath === '/webhook/internal') {
    return handleWebhook(req, res);
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
  knowledge.init().catch(err => console.error('[Knowledge] Init error:', err.message));
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
          { type: 'text', instance, body: { number, text } },
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

  // Knowledge graph
  if (urlPath.startsWith('/knowledge/')) {
    if (await isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    return knowledge.handleRequest(req, res, urlPath, fullApiPath);
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
