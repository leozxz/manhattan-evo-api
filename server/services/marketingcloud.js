const https = require('https');
const http = require('http');

const MC_AUTH_URL = process.env.SFMC_AUTH_URL || process.env.MC_AUTH_URL || 'https://mcn29v1t3hsj32w921hh7z9yz2xm.auth.marketingcloudapis.com';
const MC_REST_URL = process.env.SFMC_REST_URL || process.env.MC_REST_URL || 'https://mcn29v1t3hsj32w921hh7z9yz2xm.rest.marketingcloudapis.com';
const MC_CLIENT_ID = process.env.SFMC_CLIENT_ID || process.env.MC_CLIENT_ID || '';
const MC_CLIENT_SECRET = process.env.SFMC_CLIENT_SECRET || process.env.MC_CLIENT_SECRET || '';
const MC_ACCOUNT_ID = process.env.SFMC_MID || process.env.MC_ACCOUNT_ID || '';

let cachedToken = null;
let tokenExpiry = 0;

function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(parsed, options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await request(MC_AUTH_URL + '/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, JSON.stringify({
    grant_type: 'client_credentials',
    client_id: MC_CLIENT_ID,
    client_secret: MC_CLIENT_SECRET,
    account_id: MC_ACCOUNT_ID,
  }));

  if (res.status !== 200 || !res.data.access_token) {
    console.error('[MC] Token error:', res.data);
    throw new Error('Failed to get Marketing Cloud token');
  }

  cachedToken = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000; // refresh 1min before expiry
  return cachedToken;
}

async function sendWhatsAppCode(phone, email, code) {
  const token = await getToken();

  const res = await request(MC_REST_URL + '/messaging/v1/ott/messages/', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
  }, JSON.stringify({
    definitionKey: process.env.SFMC_CUSTOMER_KEY || 'auth_manhattan',
    recipients: [{
      contactKey: email,
      to: phone,
      attributes: { codigo: code },
    }],
  }));

  if (res.status < 200 || res.status >= 300) {
    console.error('[MC] Send error:', res.status, res.data);
    throw new Error('Failed to send WhatsApp code');
  }

  console.log('[MC] Code sent to', phone);
  return true;
}

function isConfigured() {
  return !!(MC_CLIENT_ID && MC_CLIENT_SECRET);
}

module.exports = { sendWhatsAppCode, isConfigured };
