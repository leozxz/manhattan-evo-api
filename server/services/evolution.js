const http = require('http');
const https = require('https');
const redis = require('./redis');

const EVO_API_URL = () => process.env.EVO_API_URL || 'http://localhost:8080';
const EVO_API_KEY = () => process.env.EVO_API_KEY || '';

// Cacheable GET paths with TTL (seconds)
const CACHE_ROUTES = {
  '/chat/findContacts/': 300,      // 5 min
  '/group/fetchAllGroups/': 120,   // 2 min
  '/instance/fetchInstances': 15,  // 15 sec
};

function getCacheTTL(apiPath) {
  for (const [prefix, ttl] of Object.entries(CACHE_ROUTES)) {
    if (apiPath.startsWith(prefix)) return ttl;
  }
  return 0;
}

function evoRequest(method, reqPath, body) {
  return new Promise((resolve) => {
    const url = new URL(reqPath, EVO_API_URL());
    const client = url.protocol === 'https:' ? https : http;
    const headers = { 'apikey': EVO_API_KEY() };
    if (body) headers['Content-Type'] = 'application/json';
    const req = client.request({
      hostname: url.hostname, port: url.port || undefined,
      path: url.pathname + url.search, method, headers,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function proxyToEvo(req, res, apiPath, securityHeaders) {
  // Check cache for GET requests
  if (req.method === 'GET') {
    const ttl = getCacheTTL(apiPath);
    if (ttl > 0) {
      const cached = await redis.cacheGet('proxy:' + apiPath);
      if (cached) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Cache': 'HIT',
          ...securityHeaders,
        });
        res.end(JSON.stringify(cached));
        return;
      }
    }
  }

  const url = new URL(apiPath, EVO_API_URL());
  const client = url.protocol === 'https:' ? https : http;

  const proxyHeaders = { 'apikey': EVO_API_KEY() };
  if (req.headers['content-type']) proxyHeaders['Content-Type'] = req.headers['content-type'];
  if (req.headers['content-length']) proxyHeaders['Content-Length'] = req.headers['content-length'];
  if (req.headers['transfer-encoding']) proxyHeaders['Transfer-Encoding'] = req.headers['transfer-encoding'];

  const proxyReq = client.request({
    hostname: url.hostname, port: url.port || undefined,
    path: url.pathname + url.search, method: req.method, headers: proxyHeaders,
  }, (proxyRes) => {
    // For cacheable GET routes, buffer response and cache it
    if (req.method === 'GET' && proxyRes.statusCode === 200) {
      const ttl = getCacheTTL(apiPath);
      if (ttl > 0) {
        let body = '';
        proxyRes.on('data', c => body += c);
        proxyRes.on('end', () => {
          res.writeHead(200, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/json',
            'Cache-Control': 'no-cache',
            'X-Cache': 'MISS',
            ...securityHeaders,
          });
          res.end(body);
          // Cache in background
          try { redis.cacheSet('proxy:' + apiPath, JSON.parse(body), ttl); } catch {}
        });
        return;
      }
    }

    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      'Cache-Control': 'no-cache', ...securityHeaders,
    });
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json', ...securityHeaders });
    res.end(JSON.stringify({ error: 'Evolution API unavailable' }));
  });
  req.pipe(proxyReq);
}

module.exports = { evoRequest, proxyToEvo };
