const redis = require('../services/redis');

// In-memory fallback
const memoryRateLimit = {};
const RATE_WINDOW = 60000;
const RATE_MAX = 120;

async function isRateLimited(ip) {
  // Try Redis (distributed)
  const redisResult = await redis.rateLimitCheck(ip, RATE_WINDOW, RATE_MAX);
  if (redisResult !== null) return redisResult;

  // Fallback to in-memory
  const now = Date.now();
  if (!memoryRateLimit[ip] || now - memoryRateLimit[ip].start > RATE_WINDOW) {
    memoryRateLimit[ip] = { start: now, count: 1 };
    return false;
  }
  memoryRateLimit[ip].count++;
  return memoryRateLimit[ip].count > RATE_MAX;
}

// Clean up memory fallback periodically
setInterval(() => {
  const now = Date.now();
  for (const ip in memoryRateLimit) {
    if (now - memoryRateLimit[ip].start > RATE_WINDOW) delete memoryRateLimit[ip];
  }
}, RATE_WINDOW);

module.exports = { isRateLimited };
