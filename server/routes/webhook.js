const { broadcastSSE } = require('../services/sse');

function handleWebhook(req, res) {
  let body = '';
  req.on('data', c => { if (body.length < 65536) body += c; });
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const event = data.event || 'unknown';
      console.log('[webhook]', event, JSON.stringify(data).substring(0, 800));
      broadcastSSE(event, data);
    } catch (e) { console.log('[webhook] parse error:', e.message); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
}

module.exports = { handleWebhook };
