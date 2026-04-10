const crypto = require('crypto');
const { broadcastSSE } = require('../services/sse');

// Webhook secret for HMAC verification
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

// Allowed event types from Evolution API
const ALLOWED_EVENTS = new Set([
  'MESSAGES_UPSERT', 'messages.upsert',
  'MESSAGES_UPDATE', 'messages.update',
  'CONNECTION_UPDATE', 'connection.update',
  'GROUP_PARTICIPANTS_UPDATE', 'group-participants.update',
  'CHATS_UPDATE', 'chats.update',
  'CHATS_UPSERT', 'chats.upsert',
  'PRESENCE_UPDATE', 'presence.update',
  'GROUPS_UPSERT', 'groups.upsert',
]);

// Simple rate limiter: max 100 requests per second
let webhookReqCount = 0;
let webhookReqWindow = Date.now();
const WEBHOOK_RATE_LIMIT = 100;
const WEBHOOK_RATE_WINDOW = 1000; // 1 second

function isWebhookRateLimited() {
  const now = Date.now();
  if (now - webhookReqWindow > WEBHOOK_RATE_WINDOW) {
    webhookReqCount = 0;
    webhookReqWindow = now;
  }
  webhookReqCount++;
  return webhookReqCount > WEBHOOK_RATE_LIMIT;
}

function verifySignature(body, signature) {
  if (!WEBHOOK_SECRET) return true; // No secret configured = skip verification
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function handleWebhook(req, res, securityHeaders) {
  // Rate limit check
  if (isWebhookRateLimited()) {
    console.warn('[webhook] RATE LIMITED — too many requests');
    res.writeHead(429, { 'Content-Type': 'application/json', ...(securityHeaders || {}) });
    res.end('{"error":"Too many requests"}');
    return;
  }

  let body = '';
  req.on('data', c => { if (body.length < 65536) body += c; });
  req.on('end', () => {
    // HMAC signature verification
    const signature = req.headers['x-webhook-signature'] || req.headers['x-hub-signature-256'] || '';
    if (!verifySignature(body, signature)) {
      console.warn('[webhook] REJECTED — invalid signature from', req.socket?.remoteAddress);
      res.writeHead(401, { 'Content-Type': 'application/json', ...(securityHeaders || {}) });
      res.end('{"error":"Invalid signature"}');
      return;
    }

    try {
      const data = JSON.parse(body);
      const event = data.event || 'unknown';

      // Event whitelist check
      if (!ALLOWED_EVENTS.has(event)) {
        console.warn('[webhook] REJECTED — unknown event:', event, 'from', req.socket?.remoteAddress);
        res.writeHead(400, { 'Content-Type': 'application/json', ...(securityHeaders || {}) });
        res.end('{"error":"Event type not allowed: ' + event + '"}');
        return;
      }

      console.log('[webhook]', event, JSON.stringify(data).substring(0, 800));
      broadcastSSE(event, data);
    } catch (e) {
      console.warn('[webhook] REJECTED — parse error:', e.message);
      res.writeHead(400, { 'Content-Type': 'application/json', ...(securityHeaders || {}) });
      res.end('{"error":"Invalid JSON"}');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json', ...(securityHeaders || {}) });
    res.end('{"ok":true}');
  });
}

module.exports = { handleWebhook, WEBHOOK_SECRET };
