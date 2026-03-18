const rateLimit = {};
const RATE_WINDOW = 60000;
const RATE_MAX = 120;

function isRateLimited(ip) {
  const now = Date.now();
  if (!rateLimit[ip] || now - rateLimit[ip].start > RATE_WINDOW) {
    rateLimit[ip] = { start: now, count: 1 };
    return false;
  }
  rateLimit[ip].count++;
  return rateLimit[ip].count > RATE_MAX;
}

// Clean up periodically
setInterval(() => {
  const now = Date.now();
  for (const ip in rateLimit) {
    if (now - rateLimit[ip].start > RATE_WINDOW) delete rateLimit[ip];
  }
}, RATE_WINDOW);

module.exports = { isRateLimited };
