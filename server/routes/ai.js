const https = require('https');

function handleAiSuggest(req, res, securityHeaders) {
  let body = '';
  req.on('data', c => { if (body.length < 65536) body += c; });
  req.on('end', () => {
    try {
      const { messages } = JSON.parse(body);
      if (!Array.isArray(messages) || messages.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...securityHeaders });
        res.end(JSON.stringify({ error: 'messages array required' }));
        return;
      }
      const openaiKey = process.env.OPENAI_API_KEY || '';
      if (!openaiKey) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...securityHeaders });
        res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }));
        return;
      }

      const chatMessages = [
        {
          role: 'system',
          content: 'Voce e um assistente de atendimento ao cliente via WhatsApp. Com base nas ultimas mensagens da conversa, sugira UMA resposta curta, natural e apropriada que o atendente poderia enviar. Responda APENAS com o texto da sugestao, sem aspas, sem explicacoes. Seja direto, cordial e profissional. Responda no mesmo idioma das mensagens.'
        },
        ...messages.slice(-15).map(m => ({
          role: m.fromMe ? 'assistant' : 'user',
          content: m.text
        }))
      ];

      const reqBody = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: chatMessages,
        temperature: 0.7,
        max_tokens: 200,
      });

      const aiReq = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + openaiKey,
          'Content-Length': Buffer.byteLength(reqBody),
        },
      }, (aiRes) => {
        let data = '';
        aiRes.on('data', c => data += c);
        aiRes.on('end', () => {
          try {
            if (aiRes.statusCode !== 200) {
              res.writeHead(502, { 'Content-Type': 'application/json', ...securityHeaders });
              res.end(JSON.stringify({ error: 'OpenAI API error' }));
              return;
            }
            const parsed = JSON.parse(data);
            const suggestion = parsed.choices?.[0]?.message?.content?.trim() || '';
            res.writeHead(200, { 'Content-Type': 'application/json', ...securityHeaders });
            res.end(JSON.stringify({ suggestion }));
          } catch {
            res.writeHead(500, { 'Content-Type': 'application/json', ...securityHeaders });
            res.end(JSON.stringify({ error: 'Failed to parse AI response' }));
          }
        });
      });
      aiReq.on('error', () => {
        res.writeHead(502, { 'Content-Type': 'application/json', ...securityHeaders });
        res.end(JSON.stringify({ error: 'OpenAI API unavailable' }));
      });
      aiReq.write(reqBody);
      aiReq.end();
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json', ...securityHeaders });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
  });
}

module.exports = { handleAiSuggest };
