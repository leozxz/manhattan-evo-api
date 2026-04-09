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

function handleAiGraphQuery(req, res, securityHeaders) {
  let body = '';
  req.on('data', c => { if (body.length < 65536) body += c; });
  req.on('end', () => {
    try {
      const { question, entities, summary } = JSON.parse(body);
      if (!question) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...securityHeaders });
        res.end(JSON.stringify({ error: 'question required' }));
        return;
      }
      const openaiKey = process.env.OPENAI_API_KEY || '';
      if (!openaiKey) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...securityHeaders });
        res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }));
        return;
      }

      const entityList = (entities || []).map(e => e.category + ': ' + e.label + ' = ' + (e.value || '')).join('\n');

      const prompt = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Voce e um assistente que responde perguntas sobre um cliente com base no perfil extraido de conversas de WhatsApp.

PERFIL DO CLIENTE:
${summary || 'Sem resumo.'}

ENTIDADES CONHECIDAS:
${entityList || 'Nenhuma.'}

REGRAS:
1. Se a resposta esta nas entidades, responda e retorne "found": true com os labels das entidades relevantes em "matchLabels".
2. Se a resposta NAO esta nas entidades, retorne "found": false e sugira uma mensagem natural que o atendente poderia enviar ao cliente para obter essa informacao, sem ser invasivo e mantendo o contexto da conversa.
3. Responda SOMENTE com JSON valido.

Formato:
{"answer": "resposta", "found": true/false, "matchLabels": ["label1", "label2"], "suggestedMessage": "mensagem sugerida ou null"}`
          },
          { role: 'user', content: question }
        ],
        temperature: 0.3,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      });

      const aiReq = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + openaiKey,
          'Content-Length': Buffer.byteLength(prompt),
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
            const content = parsed.choices?.[0]?.message?.content?.trim() || '{}';
            const result = JSON.parse(content);
            res.writeHead(200, { 'Content-Type': 'application/json', ...securityHeaders });
            res.end(JSON.stringify(result));
          } catch {
            res.writeHead(500, { 'Content-Type': 'application/json', ...securityHeaders });
            res.end(JSON.stringify({ error: 'Failed to parse AI response' }));
          }
        });
      });
      aiReq.on('error', () => {
        res.writeHead(502, { 'Content-Type': 'application/json', ...securityHeaders });
        res.end(JSON.stringify({ error: 'OpenAI unavailable' }));
      });
      aiReq.write(prompt);
      aiReq.end();
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json', ...securityHeaders });
      res.end(JSON.stringify({ error: 'Invalid request' }));
    }
  });
}

function handleAiSearch(req, res, securityHeaders) {
  let body = '';
  req.on('data', c => { if (body.length < 65536) body += c; });
  req.on('end', async () => {
    try {
      const { question, messages, contacts } = JSON.parse(body);
      if (!question || !Array.isArray(messages) || messages.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...securityHeaders });
        res.end(JSON.stringify({ error: 'question and messages array required' }));
        return;
      }
      const openaiKey = process.env.OPENAI_API_KEY || '';
      if (!openaiKey) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...securityHeaders });
        res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }));
        return;
      }

      // Build compact message context for AI
      // messages format: [{ id, contact, text, fromMe, timestamp }]
      const msgContext = messages.map(m =>
        `[${m.id}] ${m.fromMe ? 'EU' : m.contact}: ${m.text}`
      ).join('\n');

      const contactList = contacts && contacts.length > 0
        ? '\n\nContatos conhecidos: ' + contacts.join(', ')
        : '';

      const chatMessages = [
        {
          role: 'system',
          content: `Voce e um assistente que analisa mensagens de WhatsApp. O usuario vai fazer uma pergunta sobre suas conversas. Analise as mensagens abaixo e encontre quais respondem a pergunta.

Responda APENAS em JSON valido com este formato:
{"results": [{"id": "id_da_mensagem", "contact": "nome_do_contato", "reason": "breve explicacao de por que esta mensagem e relevante"}], "summary": "resposta resumida para o usuario"}

Se nao encontrar nenhuma mensagem relevante, retorne: {"results": [], "summary": "Nao encontrei mensagens relacionadas a essa pergunta."}

IMPORTANTE: O campo "id" deve ser exatamente o id entre colchetes [id] de cada mensagem. Retorne no maximo 10 resultados, priorizando os mais relevantes.`
        },
        {
          role: 'user',
          content: `Mensagens recentes:\n${msgContext}${contactList}\n\nPergunta: ${question}`
        }
      ];

      const reqBody = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: chatMessages,
        temperature: 0.2,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
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
            const content = parsed.choices?.[0]?.message?.content || '{}';
            const result = JSON.parse(content);
            res.writeHead(200, { 'Content-Type': 'application/json', ...securityHeaders });
            res.end(JSON.stringify(result));
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

module.exports = { handleAiSuggest, handleAiGraphQuery, handleAiSearch };
