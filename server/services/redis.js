const Redis = require('ioredis');

const REDIS_URL = () => process.env.REDIS_URL || 'redis://localhost:6379';

let client = null;
let subscriber = null;

function getClient() {
  if (!client) {
    const url = REDIS_URL();
    if (!url) return null;
    try {
      client = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 5000),
        lazyConnect: true,
      });
      client.on('error', (err) => console.error('[Redis] Error:', err.message));
      client.on('connect', () => console.log('[Redis] Connected'));
      client.connect().catch(() => {});
    } catch (err) {
      console.error('[Redis] Init error:', err.message);
      client = null;
    }
  }
  return client;
}

function getSubscriber() {
  if (!subscriber) {
    const url = REDIS_URL();
    if (!url) return null;
    try {
      subscriber = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 5000),
        lazyConnect: true,
      });
      subscriber.on('error', (err) => console.error('[Redis:sub] Error:', err.message));
      subscriber.connect().catch(() => {});
    } catch {
      subscriber = null;
    }
  }
  return subscriber;
}

function isAvailable() {
  return client && client.status === 'ready';
}

// =====================
// CACHE — generic get/set with TTL
// =====================
async function cacheGet(key) {
  if (!isAvailable()) return null;
  try {
    const val = await client.get('mht:' + key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}

async function cacheSet(key, value, ttlSeconds = 300) {
  if (!isAvailable()) return;
  try {
    await client.set('mht:' + key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {}
}

async function cacheDel(key) {
  if (!isAvailable()) return;
  try { await client.del('mht:' + key); } catch {}
}

// =====================
// SESSIONS — replaces in-memory sessions{}
// =====================
async function sessionSet(token) {
  if (!isAvailable()) return false;
  try {
    await client.set('mht:sess:' + token, Date.now().toString(), 'EX', 86400); // 24h
    return true;
  } catch { return false; }
}

async function sessionValid(token) {
  if (!isAvailable()) return null; // null = fallback to memory
  try {
    const val = await client.get('mht:sess:' + token);
    return val ? true : false;
  } catch { return null; }
}

async function sessionDel(token) {
  if (!isAvailable()) return;
  try { await client.del('mht:sess:' + token); } catch {}
}

// =====================
// RATE LIMITING — distributed sliding window
// =====================
async function rateLimitCheck(ip, windowMs = 60000, maxReqs = 120) {
  if (!isAvailable()) return null; // null = fallback to memory
  try {
    const key = 'mht:rl:' + ip;
    const now = Date.now();
    const pipeline = client.pipeline();
    pipeline.zadd(key, now, now.toString() + ':' + Math.random().toString(36).slice(2, 6));
    pipeline.zremrangebyscore(key, 0, now - windowMs);
    pipeline.zcard(key);
    pipeline.pexpire(key, windowMs);
    const results = await pipeline.exec();
    const count = results[2][1];
    return count > maxReqs;
  } catch { return null; }
}

// =====================
// PUB/SUB — for SSE multi-server
// =====================
const SSE_CHANNEL = 'mht:sse';

function publishSSE(event, data) {
  if (!isAvailable()) return;
  try {
    client.publish(SSE_CHANNEL, JSON.stringify({ event, data }));
  } catch {}
}

function subscribeSSE(callback) {
  const sub = getSubscriber();
  if (!sub) return;
  sub.subscribe(SSE_CHANNEL).catch(() => {});
  sub.on('message', (channel, message) => {
    if (channel !== SSE_CHANNEL) return;
    try {
      const { event, data } = JSON.parse(message);
      callback(event, data);
    } catch {}
  });
}

// =====================
// MESSAGE QUEUE — scheduled messages
// =====================
async function enqueueMessage(msg, sendAtTimestamp) {
  if (!isAvailable()) return false;
  try {
    await client.zadd('mht:msgqueue', sendAtTimestamp, JSON.stringify(msg));
    return true;
  } catch { return false; }
}

async function dequeueReady() {
  if (!isAvailable()) return [];
  try {
    const now = Date.now();
    const items = await client.zrangebyscore('mht:msgqueue', 0, now);
    if (items.length === 0) return [];
    await client.zremrangebyscore('mht:msgqueue', 0, now);
    return items.map(i => { try { return JSON.parse(i); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

async function queueSize() {
  if (!isAvailable()) return 0;
  try { return await client.zcard('mht:msgqueue'); } catch { return 0; }
}

module.exports = {
  getClient, isAvailable,
  cacheGet, cacheSet, cacheDel,
  sessionSet, sessionValid, sessionDel,
  rateLimitCheck,
  publishSSE, subscribeSSE,
  enqueueMessage, dequeueReady, queueSize,
};
