const crypto = require('crypto');
const redis = require('../services/redis');
const mc = require('../services/marketingcloud');

// =====================
// PASSWORD HASHING
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
// 2FA CODE STORAGE (3 min TTL, max 5 attempts)
// =====================
const memoryCodes = {};
const MAX_2FA_ATTEMPTS = 5;

async function storeCode(userId, code) {
  const key = 'mht:2fa:' + userId;
  const stored = await redis.sessionSet(key, JSON.stringify({ code, created: Date.now(), attempts: 0 }));
  if (!stored) memoryCodes[userId] = { code, created: Date.now(), attempts: 0 };
}

async function verifyCode(userId, code) {
  const key = 'mht:2fa:' + userId;
  let data = await redis.sessionGet?.(key);
  let fromRedis = !!data;
  if (!data) data = memoryCodes[userId];
  else if (typeof data === 'string') data = JSON.parse(data);

  if (!data) return false;
  if (Date.now() - data.created > 180000) { // 3 minutes
    await redis.sessionDel(key);
    delete memoryCodes[userId];
    return false;
  }

  // Check max attempts — invalidate code after too many failures
  if (data.attempts >= MAX_2FA_ATTEMPTS) {
    await redis.sessionDel(key);
    delete memoryCodes[userId];
    return false;
  }

  if (data.code !== code) {
    // Increment attempt counter
    data.attempts = (data.attempts || 0) + 1;
    if (fromRedis) {
      await redis.sessionSet(key, JSON.stringify(data));
    } else {
      memoryCodes[userId] = data;
    }
    return false;
  }

  // Cleanup after successful verification
  await redis.sessionDel(key);
  delete memoryCodes[userId];
  return true;
}

// =====================
// PENDING LOGIN (stores user data between password and 2FA steps)
// =====================
const memoryPending = {};

async function storePending(token, userData) {
  const key = 'mht:pending:' + token;
  const data = JSON.stringify({ ...userData, created: Date.now() });
  const stored = await redis.sessionSet(key, data);
  if (!stored) memoryPending[token] = data;
}

async function getPending(token) {
  const key = 'mht:pending:' + token;
  let data = await redis.sessionGet?.(key);
  if (!data) data = memoryPending[token];
  if (!data) return null;
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (Date.now() - parsed.created > 300000) { // 5 min max
    await redis.sessionDel(key);
    delete memoryPending[token];
    return null;
  }
  return parsed;
}

async function clearPending(token) {
  await redis.sessionDel('mht:pending:' + token);
  delete memoryPending[token];
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

  const password = process.env.ADMIN_PASS;
  if (!password) {
    console.error('[Auth] ADMIN_PASS not set — skipping admin seed. Set ADMIN_PASS in .env to create the admin user.');
    return;
  }
  const hash = await hashPassword(password);
  await db.query(
    `INSERT INTO "PanelUser" (username, "passwordHash", name, role) VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO NOTHING`,
    ['admin', hash, 'Administrador', 'admin']
  );
  console.log('[Auth] Admin user created (username: admin)');
}

// =====================
// HTML PAGES
// =====================
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const PAGE_STYLE = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;height:100vh}
.login{background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);width:340px}
h2{margin-bottom:8px;color:#111b21;text-align:center}
.sub{color:#667781;font-size:13px;text-align:center;margin-bottom:24px}
input{width:100%;padding:10px 12px;border:1px solid #dfe5e7;border-radius:8px;font-size:14px;margin-bottom:12px;outline:none}
input:focus{border-color:#25d366}
button{width:100%;padding:10px;background:#25d366;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600}
button:hover{background:#1da851}.err{color:#ea0038;font-size:13px;text-align:center;margin-bottom:12px}
.code-input{text-align:center;font-size:24px;letter-spacing:12px;font-weight:700}
.timer{color:#667781;font-size:12px;text-align:center;margin-top:8px}
.link{text-align:center;margin-top:16px;font-size:13px;color:#667781}
.link a{color:#25d366;text-decoration:none;font-weight:500}
.link a:hover{text-decoration:underline}
.resend{background:none;color:#25d366;border:none;font-size:13px;cursor:pointer;margin-top:4px;font-weight:500;width:auto;padding:4px}
.resend:hover{text-decoration:underline;background:none}`;

function loginPage(error) {
  const errHtml = error ? '<div class="err">' + escapeHtml(error) + '</div>' : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login - Manhattan</title><style>${PAGE_STYLE}</style></head>
<body><div class="login"><h2>Manhattan</h2><p class="sub">Acesse sua conta</p>${errHtml}
<form method="POST" action="/auth/login">
<input name="user" placeholder="Usuario" required autocomplete="username">
<input name="pass" type="password" placeholder="Senha" required autocomplete="current-password">
<button type="submit">Entrar</button></form>
<p class="link"><a href="/auth/register">Criar conta</a></p>
</div></body></html>`;
}

function registerPage(error, values) {
  const v = values || {};
  const errHtml = error ? '<div class="err">' + escapeHtml(error) + '</div>' : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Criar Conta - Manhattan</title><style>${PAGE_STYLE}</style></head>
<body><div class="login"><h2>Manhattan</h2><p class="sub">Crie sua conta</p>${errHtml}
<form method="POST" action="/auth/register">
<input name="user" placeholder="Usuario" required autocomplete="username" value="${escapeHtml(v.user)}">
<input name="email" type="email" placeholder="Email" required autocomplete="email" value="${escapeHtml(v.email)}">
<input name="phone" placeholder="Telefone (ex: 5511999999999)" required inputmode="numeric" value="${escapeHtml(v.phone)}">
<input name="pass" type="password" placeholder="Senha" required autocomplete="new-password">
<input name="pass2" type="password" placeholder="Confirmar senha" required autocomplete="new-password">
<button type="submit">Criar conta</button></form>
<p class="link"><a href="/">Ja tenho conta</a></p>
</div></body></html>`;
}

function mfaPage(pendingToken, phone, error) {
  const masked = phone ? phone.slice(0, 4) + '****' + phone.slice(-2) : '****';
  const errHtml = error ? '<div class="err">' + escapeHtml(error) + '</div>' : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verificacao - Manhattan</title><style>${PAGE_STYLE}</style></head>
<body><div class="login"><h2>Verificacao</h2>
<p class="sub">Enviamos um codigo para o WhatsApp<br><strong>${escapeHtml(masked)}</strong></p>${errHtml}
<form method="POST" action="/auth/verify">
<input type="hidden" name="token" value="${escapeHtml(pendingToken)}">
<input name="code" class="code-input" placeholder="000000" maxlength="6" required autocomplete="one-time-code" inputmode="numeric">
<button type="submit">Verificar</button>
</form>
<p class="timer">O codigo expira em 3 minutos</p>
<form method="POST" action="/auth/resend" style="text-align:center">
<input type="hidden" name="token" value="${escapeHtml(pendingToken)}">
<button type="submit" class="resend">Reenviar codigo</button>
</form>
</div>
<script>document.querySelector('.code-input').focus();</script>
</body></html>`;
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

async function checkAuth(req, res, securityHeaders) {
  const db = getPool();
  if (!db) {
    const envPass = process.env.PANEL_PASS || '';
    if (!envPass) return true;
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

// =====================
// LOGIN HANDLER (Step 1: password -> send 2FA code)
// =====================
async function handleLogin(req, res, securityHeaders) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    const params = new URLSearchParams(body);
    const username = params.get('user');
    const password = params.get('pass');

    try {
      const dbUser = await findUserByUsername(username);
      if (!dbUser) {
        res.writeHead(401, { 'Content-Type': 'text/html', ...securityHeaders });
        res.end(loginPage('Usuario ou senha incorretos'));
        return;
      }

      const valid = await verifyPassword(password, dbUser.passwordHash);
      if (!valid) {
        res.writeHead(401, { 'Content-Type': 'text/html', ...securityHeaders });
        res.end(loginPage('Usuario ou senha incorretos'));
        return;
      }

      // If 2FA not configured (no phone) or MC not configured, skip 2FA
      if (!dbUser.phone || !mc.isConfigured()) {
        const token = await createSession(dbUser.id, dbUser.username, dbUser.role);
        res.writeHead(302, {
          'Set-Cookie': 'session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400',
          'Location': '/',
        });
        res.end();
        return;
      }

      // Generate 6-digit code and send via WhatsApp
      const code = crypto.randomInt(100000, 1000000).toString();
      await storeCode(dbUser.id, code);

      const pendingToken = crypto.randomBytes(32).toString('hex');
      await storePending(pendingToken, {
        userId: dbUser.id,
        username: dbUser.username,
        role: dbUser.role,
        phone: dbUser.phone,
        email: dbUser.email,
      });

      await mc.sendWhatsAppCode(dbUser.phone, dbUser.email || dbUser.username, code);

      res.writeHead(200, { 'Content-Type': 'text/html', ...securityHeaders });
      res.end(mfaPage(pendingToken, dbUser.phone));
    } catch (err) {
      console.error('[Auth] Login error:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/html', ...securityHeaders });
      res.end(loginPage('Erro interno, tente novamente'));
    }
  });
}

// =====================
// VERIFY HANDLER (Step 2: check 2FA code)
// =====================
async function handleVerify(req, res, securityHeaders) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    const params = new URLSearchParams(body);
    const pendingToken = params.get('token');
    const code = params.get('code');

    try {
      const pending = await getPending(pendingToken);
      if (!pending) {
        res.writeHead(401, { 'Content-Type': 'text/html', ...securityHeaders });
        res.end(loginPage('Sessao expirada, faca login novamente'));
        return;
      }

      const valid = await verifyCode(pending.userId, code);
      if (!valid) {
        res.writeHead(401, { 'Content-Type': 'text/html', ...securityHeaders });
        res.end(mfaPage(pendingToken, pending.phone, 'Codigo incorreto ou expirado'));
        return;
      }

      await clearPending(pendingToken);

      // Activate account if this is a registration verification
      if (pending.isRegistration) {
        const db = getPool();
        await db.query('UPDATE "PanelUser" SET active = true, "updatedAt" = NOW() WHERE id = $1', [pending.userId]);
      }

      const sessionToken = await createSession(pending.userId, pending.username, pending.role);
      res.writeHead(302, {
        'Set-Cookie': 'session=' + sessionToken + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400',
        'Location': '/',
      });
      res.end();
    } catch (err) {
      console.error('[Auth] Verify error:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/html', ...securityHeaders });
      res.end(loginPage('Erro interno, tente novamente'));
    }
  });
}

// =====================
// RESEND HANDLER
// =====================
async function handleResend(req, res, securityHeaders) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    const params = new URLSearchParams(body);
    const pendingToken = params.get('token');

    try {
      const pending = await getPending(pendingToken);
      if (!pending) {
        res.writeHead(401, { 'Content-Type': 'text/html', ...securityHeaders });
        res.end(loginPage('Sessao expirada, faca login novamente'));
        return;
      }

      const code = crypto.randomInt(100000, 1000000).toString();
      await storeCode(pending.userId, code);
      await mc.sendWhatsAppCode(pending.phone, pending.email || pending.username, code);

      res.writeHead(200, { 'Content-Type': 'text/html', ...securityHeaders });
      res.end(mfaPage(pendingToken, pending.phone));
    } catch (err) {
      console.error('[Auth] Resend error:', err.message);
      res.writeHead(200, { 'Content-Type': 'text/html', ...securityHeaders });
      res.end(mfaPage(pendingToken, '', 'Erro ao reenviar, tente novamente'));
    }
  });
}

// =====================
// REGISTER HANDLER
// =====================
async function handleRegisterPage(req, res, securityHeaders) {
  res.writeHead(200, { 'Content-Type': 'text/html', ...securityHeaders });
  res.end(registerPage());
}

async function handleRegister(req, res, securityHeaders) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    const params = new URLSearchParams(body);
    const username = params.get('user')?.trim();
    const email = params.get('email')?.trim();
    const phone = params.get('phone')?.trim().replace(/\D/g, '');
    const password = params.get('pass');
    const password2 = params.get('pass2');
    const values = { user: username, email, phone };

    try {
      if (!username || !email || !phone || !password) {
        res.writeHead(400, { 'Content-Type': 'text/html', ...securityHeaders });
        res.end(registerPage('Preencha todos os campos', values));
        return;
      }

      if (password !== password2) {
        res.writeHead(400, { 'Content-Type': 'text/html', ...securityHeaders });
        res.end(registerPage('As senhas nao coincidem', values));
        return;
      }

      if (password.length < 6) {
        res.writeHead(400, { 'Content-Type': 'text/html', ...securityHeaders });
        res.end(registerPage('A senha deve ter pelo menos 6 caracteres', values));
        return;
      }

      const db = getPool();

      // Check duplicate username
      const existingUser = await db.query('SELECT id FROM "PanelUser" WHERE username = $1', [username]);
      if (existingUser.rows.length > 0) {
        res.writeHead(400, { 'Content-Type': 'text/html', ...securityHeaders });
        res.end(registerPage('Este usuario ja existe', values));
        return;
      }

      // Check duplicate email
      const existingEmail = await db.query('SELECT id FROM "PanelUser" WHERE email = $1', [email]);
      if (existingEmail.rows.length > 0) {
        res.writeHead(400, { 'Content-Type': 'text/html', ...securityHeaders });
        res.end(registerPage('Este email ja esta em uso', values));
        return;
      }

      // Create user (inactive until verified)
      const hash = await hashPassword(password);
      const result = await db.query(
        `INSERT INTO "PanelUser" (username, "passwordHash", name, email, phone, role, active)
         VALUES ($1, $2, $3, $4, $5, 'user', false) RETURNING id`,
        [username, hash, username, email, phone]
      );
      const userId = result.rows[0].id;

      // Generate code and send via WhatsApp
      const code = crypto.randomInt(100000, 1000000).toString();
      await storeCode(userId, code);

      const pendingToken = crypto.randomBytes(32).toString('hex');
      await storePending(pendingToken, {
        userId,
        username,
        role: 'user',
        phone,
        email,
        isRegistration: true,
      });

      await mc.sendWhatsAppCode(phone, email, code);

      res.writeHead(200, { 'Content-Type': 'text/html', ...securityHeaders });
      res.end(mfaPage(pendingToken, phone));
    } catch (err) {
      console.error('[Auth] Register error:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/html', ...securityHeaders });
      res.end(registerPage('Erro interno, tente novamente', values));
    }
  });
}

// =====================
// LOGOUT
// =====================
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

module.exports = { checkAuth, handleLogin, handleVerify, handleResend, handleRegisterPage, handleRegister, handleLogout, seedAdmin, hashPassword, getPool };
