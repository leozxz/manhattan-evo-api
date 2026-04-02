const crypto = require('crypto');
const redis = require('../services/redis');

// =====================
// PASSWORD HASHING (native crypto.scrypt — no external deps)
// =====================
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) return reject(err);
      resolve(salt + ':' + derived.toString('hex'));
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const [salt, hash] = stored.split(':');
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derived));
    });
  });
}

// =====================
// SESSION MANAGEMENT
// =====================
const memorySessions = {};

async function createSession(userId, username, role) {
  const token = crypto.randomBytes(32).toString('hex');
  const data = JSON.stringify({ userId, username, role, created: Date.now() });
  const stored = await redis.sessionSet(token, data);
  if (!stored) memorySessions[token] = data;
  return token;
}

async function getSession(token) {
  const redisResult = await redis.sessionValid(token);
  if (redisResult !== null) {
    if (!redisResult) return null;
    // redis sessionValid returns true/false, try to get full data
    const data = await redis.sessionGet?.(token);
    if (data) return typeof data === 'string' ? JSON.parse(data) : data;
    return { valid: true };
  }
  const mem = memorySessions[token];
  if (!mem) return null;
  const parsed = JSON.parse(mem);
  if (Date.now() - parsed.created > 86400000) {
    delete memorySessions[token];
    return null;
  }
  return parsed;
}

async function destroySession(token) {
  await redis.sessionDel(token);
  delete memorySessions[token];
}

// =====================
// DB USER OPERATIONS
// =====================
let pool = null;
function getPool() {
  if (!pool) {
    const connStr = process.env.DATABASE_URL || '';
    if (!connStr) return null;
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: connStr, max: 3 });
  }
  return pool;
}

async function findUserByUsername(username) {
  const db = getPool();
  if (!db) return null;
  const result = await db.query(
    'SELECT * FROM "PanelUser" WHERE username = $1 AND active = true',
    [username]
  );
  return result.rows[0] || null;
}

async function userCount() {
  const db = getPool();
  if (!db) return 0;
  const result = await db.query('SELECT COUNT(*) as count FROM "PanelUser"');
  return parseInt(result.rows[0].count);
}

async function seedAdmin() {
  const db = getPool();
  if (!db) return;
  const count = await userCount();
  if (count > 0) return;

  const password = process.env.ADMIN_PASS || 'admin123';
  const hash = await hashPassword(password);
  await db.query(
    `INSERT INTO "PanelUser" (username, "passwordHash", name, role) VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO NOTHING`,
    ['admin', hash, 'Administrador', 'admin']
  );
  console.log('[Auth] Admin user created (username: admin)');
}

// =====================
// AUTH MIDDLEWARE
// =====================
function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, v] = c.trim().split('=');
    if (k && v) cookies[k] = v;
  });
  return cookies;
}

function loginPage(error) {
  const errHtml = error
    ? '<div class="err">' + error + '</div>'
    : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login - Manhattan</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;height:100vh}
.login{background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);width:320px}
h2{margin-bottom:24px;color:#111b21;text-align:center}
input{width:100%;padding:10px 12px;border:1px solid #dfe5e7;border-radius:8px;font-size:14px;margin-bottom:12px}
button{width:100%;padding:10px;background:#25d366;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600}
button:hover{background:#1da851}.err{color:#ea0038;font-size:13px;text-align:center;margin-bottom:12px}</style></head>
<body><div class="login"><h2>Manhattan</h2>${errHtml}
<form method="POST" action="/auth/login">
<input name="user" placeholder="Usuario" required>
<input name="pass" type="password" placeholder="Senha" required>
<button type="submit">Entrar</button></form></div></body></html>`;
}

async function checkAuth(req, res, securityHeaders) {
  // If no DB, fall back to env-based auth
  const db = getPool();
  if (!db) {
    const envPass = process.env.PANEL_PASS || '';
    if (!envPass) return true; // no auth configured
  }

  const cookies = parseCookies(req);
  if (cookies.session) {
    const session = await getSession(cookies.session);
    if (session) {
      req.user = session;
      return true;
    }
  }

  if (req.method === 'POST' && req.url === '/auth/login') return 'login';

  res.writeHead(401, { 'Content-Type': 'text/html', ...securityHeaders });
  res.end(loginPage());
  return false;
}

async function handleLogin(req, res, securityHeaders) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    const params = new URLSearchParams(body);
    const username = params.get('user');
    const password = params.get('pass');

    try {
      // Try DB auth first
      const dbUser = await findUserByUsername(username);
      if (dbUser) {
        const valid = await verifyPassword(password, dbUser.passwordHash);
        if (valid) {
          const token = await createSession(dbUser.id, dbUser.username, dbUser.role);
          res.writeHead(302, {
            'Set-Cookie': 'session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400',
            'Location': '/',
          });
          res.end();
          return;
        }
      }

      // Fallback to env-based auth (backwards compatible)
      const envUser = process.env.PANEL_USER || 'admin';
      const envPass = process.env.PANEL_PASS || '';
      if (envPass && username === envUser && password === envPass) {
        const token = await createSession('env', envUser, 'admin');
        res.writeHead(302, {
          'Set-Cookie': 'session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400',
          'Location': '/',
        });
        res.end();
        return;
      }

      res.writeHead(401, { 'Content-Type': 'text/html', ...securityHeaders });
      res.end(loginPage('Usuario ou senha incorretos'));
    } catch (err) {
      console.error('[Auth] Login error:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/html', ...securityHeaders });
      res.end(loginPage('Erro interno, tente novamente'));
    }
  });
}

async function handleLogout(req, res, securityHeaders) {
  const cookies = parseCookies(req);
  if (cookies.session) await destroySession(cookies.session);
  res.writeHead(302, {
    'Set-Cookie': 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    'Location': '/',
    ...securityHeaders,
  });
  res.end();
}

module.exports = { checkAuth, handleLogin, handleLogout, seedAdmin, hashPassword };
