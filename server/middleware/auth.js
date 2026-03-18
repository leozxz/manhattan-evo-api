const crypto = require('crypto');

const PANEL_USER = () => process.env.PANEL_USER || 'admin';
const PANEL_PASS = () => process.env.PANEL_PASS || '';

const sessions = {};

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = Date.now();
  return token;
}

function isValidSession(token) {
  const created = sessions[token];
  if (!created) return false;
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

function checkAuth(req, res, securityHeaders) {
  if (!PANEL_PASS()) return true;

  const cookies = parseCookies(req);
  if (cookies.session && isValidSession(cookies.session)) return true;

  if (req.method === 'POST' && req.url === '/auth/login') return 'login';

  res.writeHead(401, { 'Content-Type': 'text/html', ...securityHeaders });
  res.end(loginPage());
  return false;
}

function handleLogin(req, res, securityHeaders) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const params = new URLSearchParams(body);
    const user = params.get('user');
    const pass = params.get('pass');

    if (user === PANEL_USER() && pass === PANEL_PASS()) {
      const token = createSession();
      res.writeHead(302, {
        'Set-Cookie': 'session=' + token + '; HttpOnly; SameSite=Strict; Path=/',
        'Location': '/',
      });
      res.end();
    } else {
      res.writeHead(401, { 'Content-Type': 'text/html', ...securityHeaders });
      res.end(loginPage().replace('<div id="err" class="err"></div>', '<div id="err" class="err">Usuario ou senha incorretos</div>'));
    }
  });
}

module.exports = { checkAuth, handleLogin };
