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
  req.on('data', c => { if (body.length < 524288) body += c; });
  req.on('end', async () => {
    try {
      const { question, messages, contacts, messageLines } = JSON.parse(body);
      if (!question || (!messageLines && (!Array.isArray(messages) || messages.length === 0))) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...securityHeaders });
        res.end(JSON.stringify({ error: 'question and messages required' }));
        return;
      }
      const openaiKey = process.env.OPENAI_API_KEY || '';
      if (!openaiKey) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...securityHeaders });
        res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }));
        return;
      }

      // Use pre-formatted messageLines (with human-readable dates) if available
      const msgContext = messageLines || messages.map(m =>
        `[${m.id}] ${m.fromMe ? 'EU' : m.contact}: ${m.text}`
      ).join('\n');

      const contactList = contacts && contacts.length > 0
        ? '\nContatos: ' + contacts.join(', ')
        : '';

      const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

      const chatMessages = [
        {
          role: 'system',
          content: `Voce e um assistente que analisa mensagens de WhatsApp. Hoje e ${today}.

O usuario fara perguntas sobre suas conversas. Cada mensagem tem o formato:
[indice] (data hora) CONTATO: texto

Analise TODAS as mensagens e encontre as que respondem a pergunta do usuario.

REGRAS:
- O campo "id" na resposta deve ser o NUMERO entre colchetes [numero] — ex: se a mensagem e [42], o id e "42"
- "EU" significa que o proprio usuario enviou a mensagem
- Considere contexto temporal: "hoje" = ${today}, "ontem" = dia anterior
- Priorize mensagens mais relevantes e recentes
- Maximo 10 resultados

Responda APENAS em JSON:
{"results": [{"id": "indice", "contact": "nome", "reason": "por que e relevante"}], "summary": "resposta direta para o usuario em portugues"}`
        },
        {
          role: 'user',
          content: `${contactList}\n\nMensagens:\n${msgContext}\n\nPergunta: ${question}`
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

function handleAiOrganize(req, res, securityHeaders) {
  let body = '';
  req.on('data', c => { if (body.length < 131072) body += c; });
  req.on('end', () => {
    try {
      const { text } = JSON.parse(body);
      if (!text || typeof text !== 'string' || text.trim().length < 10) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...securityHeaders });
        res.end(JSON.stringify({ error: 'text required (min 10 chars)' }));
        return;
      }
      const openaiKey = process.env.OPENAI_API_KEY || '';
      if (!openaiKey) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...securityHeaders });
        res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }));
        return;
      }

      const reqBody = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Voce e um assistente que organiza textos complexos em estruturas claras e visuais.

O usuario vai colar um texto longo, confuso ou denso. Sua tarefa e:
1. Extrair o titulo/tema principal
2. Dividir em secoes logicas com headings claros
3. Dentro de cada secao, listar os pontos-chave como bullets curtos e objetivos
4. Adicionar uma conclusao/resumo final
5. Se houver dados numericos, comparacoes, percentuais, valores ou tendencias no texto, gerar UM grafico adequado

REGRAS:
- Mantenha a essencia e informacoes do texto original, nao invente dados
- Simplifique a linguagem mas preserve termos tecnicos importantes
- Cada bullet deve ter no maximo 1-2 linhas
- Maximo 5 secoes
- Responda em portugues
- Responda SOMENTE com JSON valido

REGRAS DO GRAFICO:
- Inclua "chart" SOMENTE se existirem dados numericos reais no texto
- Se nao houver dados numericos, NAO inclua o campo "chart"
- type pode ser: "bar", "pie", "line", "doughnut"
- Escolha o tipo mais adequado:
  * "bar" para comparacoes entre categorias (ex: vendas por produto, gastos por area)
  * "pie" ou "doughnut" para proporcoes/distribuicao de um total (ex: 40% A, 30% B, 30% C)
  * "line" para evolucao temporal ou tendencias (ex: receita por mes, crescimento ao longo do tempo)
- IMPORTANTE: gere no MINIMO 4 pontos de dados para o grafico ficar visualmente bom
- Se o texto menciona apenas 2 pontos temporais (ex: "em janeiro era X, agora e Y"), extrapole os meses intermediarios com valores proporcionais para criar uma linha suave
- labels e values DEVEM ter o mesmo tamanho
- values devem ser numeros (nao strings)
- Use um chartTitle descritivo e curto
- Para graficos de linha, se os labels forem meses, use abreviacoes (Jan, Fev, Mar, Abr, Mai, Jun, Jul, Ago, Set, Out, Nov, Dez)

Formato:
{"title": "Titulo principal", "sections": [{"heading": "Nome da secao", "points": ["ponto 1", "ponto 2"]}], "conclusion": "Resumo final em 1-2 frases", "chart": {"type": "bar", "chartTitle": "Titulo do grafico", "labels": ["A", "B", "C", "D"], "values": [10, 20, 30, 25]}}`
          },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        max_tokens: 1500,
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

module.exports = { handleAiSuggest, handleAiGraphQuery, handleAiSearch, handleAiOrganize };
