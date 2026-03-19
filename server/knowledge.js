// =====================
// KNOWLEDGE GRAPH — Customer Intelligence from Chat Messages
// =====================
// Standalone module: extracts entities/relationships from WhatsApp messages
// using OpenAI, stores in PostgreSQL, exposes REST endpoints.
// =====================

const https = require('https');
const { Pool } = require('pg');

const OPENAI_API_KEY = () => process.env.OPENAI_API_KEY || '';
const DATABASE_URL = () => process.env.DATABASE_URL || '';
const EVO_API_URL = () => process.env.EVO_API_URL || 'http://localhost:8080';
const EVO_API_KEY = () => process.env.EVO_API_KEY || '';

// =====================
// DATABASE
// =====================
let pool = null;

function getPool() {
  if (!pool) {
    const connStr = DATABASE_URL();
    if (!connStr) throw new Error('DATABASE_URL not set');
    pool = new Pool({ connectionString: connStr, max: 5 });
  }
  return pool;
}

async function initTables() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS "ContactKnowledge" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "remoteJid" VARCHAR(100) NOT NULL,
      "instanceId" TEXT NOT NULL,
      "pushName" VARCHAR(100),
      summary TEXT,
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "updatedAt" TIMESTAMP DEFAULT NOW(),
      UNIQUE("remoteJid", "instanceId")
    );

    CREATE TABLE IF NOT EXISTS "KnowledgeEntity" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "contactKnowledgeId" TEXT NOT NULL REFERENCES "ContactKnowledge"(id) ON DELETE CASCADE,
      category VARCHAR(50) NOT NULL,
      label VARCHAR(255) NOT NULL,
      value TEXT,
      confidence FLOAT DEFAULT 1.0,
      source VARCHAR(50),
      metadata JSONB,
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "updatedAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "KnowledgeRelationship" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "contactKnowledgeId" TEXT NOT NULL REFERENCES "ContactKnowledge"(id) ON DELETE CASCADE,
      "fromEntityId" TEXT NOT NULL REFERENCES "KnowledgeEntity"(id) ON DELETE CASCADE,
      "toEntityId" TEXT NOT NULL REFERENCES "KnowledgeEntity"(id) ON DELETE CASCADE,
      type VARCHAR(100) NOT NULL,
      description TEXT,
      "createdAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "ContactTask" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "contactKnowledgeId" TEXT NOT NULL REFERENCES "ContactKnowledge"(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      priority VARCHAR(20) DEFAULT 'media',
      status VARCHAR(20) DEFAULT 'pendente',
      "dueDate" VARCHAR(50),
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "updatedAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ke_contact ON "KnowledgeEntity"("contactKnowledgeId");
    CREATE INDEX IF NOT EXISTS idx_ke_category ON "KnowledgeEntity"(category);
    CREATE INDEX IF NOT EXISTS idx_kr_contact ON "KnowledgeRelationship"("contactKnowledgeId");
    CREATE INDEX IF NOT EXISTS idx_ct_contact ON "ContactTask"("contactKnowledgeId");
    CREATE INDEX IF NOT EXISTS idx_ct_status ON "ContactTask"(status);
  `);
  console.log('[Knowledge] Tables initialized');
}

// =====================
// OPENAI LLM
// =====================
const EXTRACTION_PROMPT = `Voce e um analisador de informacoes de clientes. Analise as mensagens do chat e extraia informacoes importantes sobre o cliente.

CATEGORIAS DE ENTIDADES para extrair:
- PESSOA: nomes de familiares, amigos, colegas (label: nome da pessoa, value: relacao com o contato ex: "mae", "esposa", "amigo")
- FAMILIA: informacoes familiares (label: tipo como "estado_civil", "filhos", "conjuge", value: detalhe especifico)
- FINANCEIRO: EXTRAIA COM MAXIMO DETALHE. Cada informacao financeira deve ser uma entidade SEPARADA:
  * patrimonio_total: valor total mencionado (ex: "R$ 143.000")
  * investimento_[plataforma]: valor ou descricao por plataforma (label: "investimento_binance", value: "maior parte dos R$ 143k, foco em cripto")
  * investimento_[plataforma]: (label: "investimento_btg", value: "parte restante dos investimentos")
  * tipo_investimento: tipos mencionados (label: "cripto", value: "maior parte do patrimonio, na Binance")
  * renda_mensal: se mencionada
  * divida_[tipo]: dividas mencionadas com valor e contexto
  * despesa_[tipo]: gastos recorrentes mencionados
  * banco_[nome]: bancos/corretoras que usa
  * perfil_investidor: conservador/moderado/arrojado (inferir do tipo de investimento)
  * objetivo_financeiro: metas financeiras mencionadas
- SAUDE: condicoes de saude, medicamentos, planos (label: tipo, value: detalhe)
- MORADIA: endereco, tipo de imovel, bairro, cidade (label: tipo, value: detalhe)
- TRABALHO: empresa, cargo, area de atuacao, salario (label: tipo, value: detalhe)
- EDUCACAO: formacao, cursos, instituicoes (label: tipo, value: detalhe)
- INTERESSE: hobbies, preferencias, gostos (label: tipo, value: detalhe)
- EVENTO: datas importantes, aniversarios, compromissos (label: tipo, value: detalhe com data se disponivel)
- SENTIMENTO: humor atual, satisfacao, reclamacoes (label: tipo, value: detalhe)

REGRAS:
1. Extraia APENAS informacoes explicitamente mencionadas nas mensagens.
2. NAO invente ou infira informacoes que nao estejam claras.
3. Atribua um nivel de confianca (0.0 a 1.0) para cada entidade.
4. Identifique relacionamentos entre entidades quando possivel.
5. Gere um resumo breve do perfil atualizado do cliente.
6. FINANCEIRO: crie uma entidade SEPARADA para cada dado financeiro. Nunca agrupe tudo em uma entidade so. Inclua valores monetarios quando mencionados. Inclua a plataforma/banco quando mencionado.
7. LABELS devem ser em portugues, legíveis e formatados como titulo humano. Exemplos corretos: "Patrimonio Total", "Corretora Binance", "Perfil do Investidor", "Renda Mensal", "Estado Civil", "Nome da Mae". NUNCA use snake_case ou labels tecnicos como "investimento_binance" ou "patrimonio_total". Sempre use formato de titulo legivel.

CONTEXTO EXISTENTE DO CLIENTE:
{existingContext}

MENSAGENS RECENTES:
{messages}

Responda SOMENTE com JSON valido no seguinte formato:
{
  "entities": [
    {"category": "CATEGORIA", "label": "rotulo", "value": "valor extraido", "confidence": 0.9}
  ],
  "relationships": [
    {"fromLabel": "rotulo_entidade_1", "toLabel": "rotulo_entidade_2", "type": "TIPO_RELACAO", "description": "descricao"}
  ],
  "summary": "Resumo atualizado do perfil do cliente"
}`;

const TASK_EXTRACTION_PROMPT = `Voce e um assistente que analisa conversas de WhatsApp e identifica tarefas/acoes pendentes para o atendente executar em relacao ao cliente.

Analise as mensagens e extraia NOVAS tarefas acionaveis. Exemplos:
- Cliente pediu um documento → "Enviar documento X"
- Cliente mencionou interesse em produto → "Apresentar produto Y"
- Cliente tem duvida pendente → "Responder sobre Z"
- Cliente agendou algo → "Confirmar agendamento para data"
- Cliente reclamou de algo → "Resolver reclamacao sobre W"
- Follow-up necessario → "Fazer follow-up sobre assunto"

REGRAS:
1. Extraia APENAS tarefas reais baseadas no conteudo das mensagens.
2. Prioridade: "alta" (urgente/reclamacao), "media" (pedido normal), "baixa" (follow-up/lembrete).
3. Inclua data limite se mencionada ou inferivel.
4. Maximo 5 novas tarefas. Foque nas mais relevantes e recentes.
5. NAO crie tarefas para coisas ja resolvidas na conversa.
6. NUNCA repita tarefas que ja existem (veja a lista abaixo). Se uma tarefa existente ainda faz sentido, NAO a recrie. Crie apenas tarefas NOVAS que ainda nao foram identificadas.
7. Se nao houver novas tarefas a criar, retorne "tasks": [].

TAREFAS JA EXISTENTES (NAO REPETIR):
{existingTasks}

MENSAGENS RECENTES:
{messages}

Responda SOMENTE com JSON valido:
{
  "tasks": [
    {"title": "titulo curto da tarefa", "description": "detalhes e contexto", "priority": "alta|media|baixa", "dueDate": "data se aplicavel ou null"}
  ]
}`;


function callOpenAI(prompt) {
  return new Promise((resolve, reject) => {
    const key = OPENAI_API_KEY();
    if (!key) return reject(new Error('OPENAI_API_KEY not set'));

    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Voce e um extrator de informacoes de clientes. Responda APENAS com JSON valido.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error('OpenAI API ' + res.statusCode + ': ' + data.substring(0, 500)));
          }
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content;
          if (!content) return reject(new Error('Empty OpenAI response'));
          resolve(JSON.parse(content));
        } catch (e) {
          reject(new Error('OpenAI parse error: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// =====================
// EVOLUTION API CLIENT (fetch messages)
// =====================
function evoRequest(method, path, body) {
  const http = require('http');
  const url = new URL(path, EVO_API_URL());
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const headers = { 'apikey': EVO_API_KEY() };
    if (body) headers['Content-Type'] = 'application/json';
    const req = client.request({
      hostname: url.hostname, port: url.port || undefined,
      path: url.pathname + url.search, method, headers,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// =====================
// EXTRACTION LOGIC
// =====================
async function getExistingKnowledge(db, instanceId, remoteJid) {
  const ck = await db.query(
    'SELECT * FROM "ContactKnowledge" WHERE "remoteJid" = $1 AND "instanceId" = $2',
    [remoteJid, instanceId]
  );
  if (ck.rows.length === 0) return null;

  const contact = ck.rows[0];
  const entities = await db.query(
    'SELECT * FROM "KnowledgeEntity" WHERE "contactKnowledgeId" = $1 ORDER BY category',
    [contact.id]
  );
  contact.entities = entities.rows;
  return contact;
}

async function saveExtraction(db, instanceId, remoteJid, pushName, extraction) {
  // Upsert ContactKnowledge
  const upsert = await db.query(`
    INSERT INTO "ContactKnowledge" (id, "remoteJid", "instanceId", "pushName", summary, "updatedAt")
    VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW())
    ON CONFLICT ("remoteJid", "instanceId")
    DO UPDATE SET summary = $4, "pushName" = COALESCE($3, "ContactKnowledge"."pushName"), "updatedAt" = NOW()
    RETURNING id
  `, [remoteJid, instanceId, pushName || null, extraction.summary || '']);

  const contactId = upsert.rows[0].id;

  // Upsert entities
  for (const entity of (extraction.entities || [])) {
    await db.query(`
      INSERT INTO "KnowledgeEntity" (id, "contactKnowledgeId", category, label, value, confidence, source, "updatedAt")
      VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 'chat_extraction', NOW())
      ON CONFLICT DO NOTHING
    `, [contactId, entity.category, entity.label, entity.value, entity.confidence || 1.0]);

    // Update if exists with same category+label
    await db.query(`
      UPDATE "KnowledgeEntity" SET value = $1, confidence = $2, "updatedAt" = NOW()
      WHERE "contactKnowledgeId" = $3 AND category = $4 AND label = $5
    `, [entity.value, entity.confidence || 1.0, contactId, entity.category, entity.label]);
  }

  // Save relationships
  for (const rel of (extraction.relationships || [])) {
    const from = await db.query(
      'SELECT id FROM "KnowledgeEntity" WHERE "contactKnowledgeId" = $1 AND label = $2 LIMIT 1',
      [contactId, rel.fromLabel]
    );
    const to = await db.query(
      'SELECT id FROM "KnowledgeEntity" WHERE "contactKnowledgeId" = $1 AND label = $2 LIMIT 1',
      [contactId, rel.toLabel]
    );
    if (from.rows[0] && to.rows[0]) {
      await db.query(`
        INSERT INTO "KnowledgeRelationship" (id, "contactKnowledgeId", "fromEntityId", "toEntityId", type, description)
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [contactId, from.rows[0].id, to.rows[0].id, rel.type, rel.description || null]);
    }
  }

  return contactId;
}

async function fetchMessagesFromDB(instanceId, instanceName, remoteJid, limit) {
  const db = getPool();
  const rawNum = remoteJid.split('@')[0];
  const jidVariants = [remoteJid];
  if (remoteJid.includes('@lid')) jidVariants.push(rawNum + '@s.whatsapp.net');
  if (remoteJid.includes('@s.whatsapp.net')) jidVariants.push(rawNum + '@lid');

  console.log('[Knowledge] Querying DB for JID variants:', jidVariants);

  const result = await db.query(`
    SELECT key, message, "pushName", "messageTimestamp"
    FROM "Message"
    WHERE "instanceId" = $1
      AND key->>'remoteJid' = ANY($2)
    ORDER BY "messageTimestamp" DESC
    LIMIT $3
  `, [instanceId, jidVariants, limit || 50]);

  console.log('[Knowledge] Found', result.rows.length, 'messages in DB');

  if (result.rows.length === 0) {
    throw new Error('No messages found for ' + remoteJid + ' (DB query, variants: ' + jidVariants.join(', ') + ')');
  }

  return result.rows;
}

async function extractFromMessages(instanceId, instanceName, remoteJid, messageCount) {
  const db = getPool();
  const messages = await fetchMessagesFromDB(instanceId, instanceName, remoteJid, messageCount || 50);

  // Extract text from messages
  const texts = messages
    .sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
    .map(m => {
      const fromMe = m.key?.fromMe;
      const text =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        '';
      if (!text) return null;
      return '[' + (fromMe ? 'Bot' : (m.pushName || 'Cliente')) + ']: ' + text;
    })
    .filter(Boolean);

  if (texts.length === 0) {
    throw new Error('No text messages found for ' + remoteJid);
  }

  // Get existing context
  const existing = await getExistingKnowledge(db, instanceId, remoteJid);
  const existingContext = existing
    ? 'Resumo: ' + (existing.summary || 'Nenhum') + '\nEntidades conhecidas: ' +
      (existing.entities || []).map(e => e.category + ':' + e.label + '=' + e.value).join(', ')
    : 'Nenhuma informacao previa sobre este cliente.';

  const prompt = EXTRACTION_PROMPT
    .replace('{existingContext}', existingContext)
    .replace('{messages}', texts.join('\n'));

  // Call LLM
  console.log('[Knowledge] Calling OpenAI for', remoteJid, '(' + texts.length + ' messages)');
  const extraction = await callOpenAI(prompt);

  // Validate
  if (!Array.isArray(extraction.entities)) extraction.entities = [];
  if (!Array.isArray(extraction.relationships)) extraction.relationships = [];

  // Save
  const pushName = messages.find(m => !m.key?.fromMe)?.pushName || null;
  await saveExtraction(db, instanceId, remoteJid, pushName, extraction);

  console.log('[Knowledge] Extracted', extraction.entities.length, 'entities for', remoteJid);
  return extraction;
}

// =====================
// REST HANDLERS
// =====================
async function getContactKnowledge(instanceId, remoteJid) {
  const db = getPool();
  const ck = await db.query(
    'SELECT * FROM "ContactKnowledge" WHERE "remoteJid" = $1 AND "instanceId" = $2',
    [remoteJid, instanceId]
  );
  if (ck.rows.length === 0) return null;

  const contact = ck.rows[0];
  const entities = await db.query(
    'SELECT * FROM "KnowledgeEntity" WHERE "contactKnowledgeId" = $1 ORDER BY category',
    [contact.id]
  );
  const relationships = await db.query(`
    SELECT kr.*, fe.label as "fromLabel", fe.category as "fromCategory",
           te.label as "toLabel", te.category as "toCategory"
    FROM "KnowledgeRelationship" kr
    JOIN "KnowledgeEntity" fe ON kr."fromEntityId" = fe.id
    JOIN "KnowledgeEntity" te ON kr."toEntityId" = te.id
    WHERE kr."contactKnowledgeId" = $1
  `, [contact.id]);

  return {
    ...contact,
    entities: entities.rows,
    relationships: relationships.rows.map(r => ({
      ...r,
      fromEntity: { label: r.fromLabel, category: r.fromCategory },
      toEntity: { label: r.toLabel, category: r.toCategory },
    })),
  };
}

async function listContacts(instanceId) {
  const db = getPool();
  const result = await db.query(`
    SELECT ck.*,
      (SELECT COUNT(*) FROM "KnowledgeEntity" WHERE "contactKnowledgeId" = ck.id) as "entityCount",
      (SELECT COUNT(*) FROM "KnowledgeRelationship" WHERE "contactKnowledgeId" = ck.id) as "relationshipCount"
    FROM "ContactKnowledge" ck
    WHERE ck."instanceId" = $1
    ORDER BY ck."updatedAt" DESC
  `, [instanceId]);
  return result.rows;
}

async function deleteContactKnowledge(instanceId, remoteJid) {
  const db = getPool();
  const result = await db.query(
    'DELETE FROM "ContactKnowledge" WHERE "remoteJid" = $1 AND "instanceId" = $2 RETURNING id',
    [remoteJid, instanceId]
  );
  return { deleted: result.rowCount > 0 };
}

// =====================
// TASKS — AI-generated from conversation
// =====================
async function extractTasks(instanceId, instanceName, remoteJid) {
  const db = getPool();

  // Ensure ContactKnowledge exists
  let ck = await db.query(
    'SELECT id FROM "ContactKnowledge" WHERE "remoteJid" = $1 AND "instanceId" = $2',
    [remoteJid, instanceId]
  );
  if (ck.rows.length === 0) {
    await db.query(
      'INSERT INTO "ContactKnowledge" ("remoteJid", "instanceId") VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [remoteJid, instanceId]
    );
    ck = await db.query(
      'SELECT id FROM "ContactKnowledge" WHERE "remoteJid" = $1 AND "instanceId" = $2',
      [remoteJid, instanceId]
    );
  }
  const contactKnowledgeId = ck.rows[0].id;
  console.log('[Tasks] extractTasks called for', remoteJid, 'contactKnowledgeId:', contactKnowledgeId);

  // Fetch messages
  let messages;
  try {
    messages = await fetchMessagesFromDB(instanceId, instanceName, remoteJid);
  } catch (err) {
    console.log('[Tasks] fetchMessagesFromDB error:', err.message);
    throw err;
  }
  console.log('[Tasks] Fetched', messages.length, 'messages from DB');

  const msgText = messages.map(m => {
    const sender = m.key?.fromMe ? 'Atendente' : (m.pushName || 'Cliente');
    const text = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
    return sender + ': ' + text;
  }).filter(l => l.includes(': ') && l.split(': ')[1]).join('\n');

  console.log('[Tasks] Message text lines:', msgText.split('\n').length, '| Total chars:', msgText.length);
  if (!msgText) {
    console.log('[Tasks] No text messages found, skipping LLM call');
    return await getContactTasks(instanceId, remoteJid);
  }

  // Get ALL tasks (including recusadas/concluidas) to avoid duplicates
  const allTasksResult = await db.query(`
    SELECT ct.* FROM "ContactTask" ct
    JOIN "ContactKnowledge" ck ON ct."contactKnowledgeId" = ck.id
    WHERE ck."remoteJid" = $1 AND ck."instanceId" = $2
    ORDER BY ct."createdAt" DESC
  `, [remoteJid, instanceId]);
  const allTasks = allTasksResult.rows;
  const activeTasks = allTasks.filter(t => t.status !== 'recusada' && t.status !== 'concluida');
  console.log('[Tasks] All tasks:', allTasks.length, '| Active:', activeTasks.length, '| Recusadas/Concluidas:', allTasks.length - activeTasks.length);

  const existingText = allTasks.length > 0
    ? allTasks.map(t => '- [' + t.status + '] ' + t.title + (t.description ? ' (' + t.description + ')' : '')).join('\n')
    : 'Nenhuma tarefa existente.';

  const prompt = TASK_EXTRACTION_PROMPT
    .replace('{existingTasks}', existingText)
    .replace('{messages}', msgText);

  console.log('[Tasks] Calling OpenAI... prompt length:', prompt.length);
  let result;
  try {
    result = await callOpenAI(prompt);
  } catch (err) {
    console.error('[Tasks] OpenAI error:', err.message);
    throw err;
  }

  console.log('[Tasks] OpenAI response:', JSON.stringify(result));

  if (!result.tasks || !Array.isArray(result.tasks)) {
    console.log('[Tasks] No tasks array in response, returning existing');
    return activeTasks;
  }

  if (result.tasks.length === 0) {
    console.log('[Tasks] LLM returned empty tasks array, no new tasks to add');
    return activeTasks;
  }

  console.log('[Tasks] LLM returned', result.tasks.length, 'tasks:', result.tasks.map(t => '"' + t.title + '"'));

  // Append only truly new tasks (skip if title is too similar to ANY task including recusadas)
  const existingTitles = allTasks.map(t => t.title.toLowerCase().trim());
  let added = 0;
  for (const task of result.tasks.slice(0, 5)) {
    const newTitle = (task.title || '').toLowerCase().trim();
    const isDuplicate = existingTitles.some(et =>
      et === newTitle || et.includes(newTitle) || newTitle.includes(et)
    );
    if (isDuplicate) {
      console.log('[Tasks] SKIP duplicate:', task.title);
      continue;
    }
    if (!newTitle) {
      console.log('[Tasks] SKIP empty title');
      continue;
    }
    await db.query(
      `INSERT INTO "ContactTask" ("contactKnowledgeId", title, description, priority, status, "dueDate")
       VALUES ($1, $2, $3, $4, 'nova', $5)`,
      [contactKnowledgeId, task.title, task.description || '', task.priority || 'media', task.dueDate || null]
    );
    console.log('[Tasks] ADDED:', task.title, '| priority:', task.priority);
    added++;
  }

  console.log('[Tasks] Done. Added', added, 'new tasks for', remoteJid);
  return getContactTasks(instanceId, remoteJid);
}

async function getContactTasks(instanceId, remoteJid) {
  const db = getPool();
  const result = await db.query(`
    SELECT ct.* FROM "ContactTask" ct
    JOIN "ContactKnowledge" ck ON ct."contactKnowledgeId" = ck.id
    WHERE ck."remoteJid" = $1 AND ck."instanceId" = $2
      AND ct.status NOT IN ('recusada', 'concluida')
    ORDER BY
      CASE ct.priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 WHEN 'baixa' THEN 2 ELSE 3 END,
      ct."createdAt" DESC
  `, [remoteJid, instanceId]);
  return result.rows;
}

async function updateTask(taskId, updates) {
  const db = getPool();
  const fields = [];
  const values = [];
  let idx = 1;

  if (updates.status !== undefined) { fields.push('"status" = $' + idx++); values.push(updates.status); }
  if (updates.title !== undefined) { fields.push('title = $' + idx++); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = $' + idx++); values.push(updates.description); }
  if (updates.priority !== undefined) { fields.push('priority = $' + idx++); values.push(updates.priority); }

  if (fields.length === 0) return null;

  fields.push('"updatedAt" = NOW()');
  values.push(taskId);

  const result = await db.query(
    'UPDATE "ContactTask" SET ' + fields.join(', ') + ' WHERE id = $' + idx + ' RETURNING *',
    values
  );
  return result.rows[0] || null;
}

async function deleteTask(taskId) {
  const db = getPool();
  await db.query('DELETE FROM "ContactTask" WHERE id = $1', [taskId]);
  return { deleted: true };
}

// =====================
// RESOLVE INSTANCE ID (from Evolution API)
// =====================
async function resolveInstanceId(instanceName) {
  const instances = await evoRequest('GET', '/instance/fetchInstances');
  if (!Array.isArray(instances)) return null;
  const inst = instances.find(i =>
    (i.instance?.instanceName || i.name) === instanceName
  );
  return inst?.instance?.instanceId || inst?.id || null;
}

// =====================
// ROUTE HANDLER — called from serve.js
// =====================
async function handleRequest(req, res, urlPath, fullApiPath) {
  const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' };

  function json(status, data) {
    res.writeHead(status, HEADERS);
    res.end(JSON.stringify(data));
  }

  function parseQuery(url) {
    const qs = url.split('?')[1] || '';
    const params = {};
    qs.split('&').forEach(pair => {
      const [k, v] = pair.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return params;
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', c => { if (body.length < 65536) body += c; });
      req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    });
  }

  try {
    // Parse: /knowledge/{action}/{instanceName}
    const parts = urlPath.replace(/^\/knowledge\//, '').split('/');
    const action = parts[0];
    const instanceName = decodeURIComponent(parts[1] || '');

    if (!instanceName) return json(400, { error: 'instanceName is required' });

    const instanceId = await resolveInstanceId(instanceName);
    if (!instanceId) return json(400, { error: 'Instance not found: ' + instanceName });

    const query = parseQuery(fullApiPath);

    // GET /knowledge/contacts/:instanceName
    if (req.method === 'GET' && action === 'contacts') {
      const result = await listContacts(instanceId);
      return json(200, result);
    }

    // GET /knowledge/contact/:instanceName?remoteJid=...
    if (req.method === 'GET' && action === 'contact') {
      if (!query.remoteJid) return json(400, { error: 'remoteJid query param required' });
      const result = await getContactKnowledge(instanceId, query.remoteJid);
      return json(200, result);
    }

    // GET /knowledge/entities/:instanceName?remoteJid=...&category=...
    if (req.method === 'GET' && action === 'entities') {
      if (!query.remoteJid || !query.category) return json(400, { error: 'remoteJid and category required' });
      const db = getPool();
      const ck = await db.query(
        'SELECT id FROM "ContactKnowledge" WHERE "remoteJid" = $1 AND "instanceId" = $2',
        [query.remoteJid, instanceId]
      );
      if (ck.rows.length === 0) return json(200, []);
      const entities = await db.query(
        'SELECT * FROM "KnowledgeEntity" WHERE "contactKnowledgeId" = $1 AND category = $2',
        [ck.rows[0].id, query.category.toUpperCase()]
      );
      return json(200, entities.rows);
    }

    // POST /knowledge/extract/:instanceName  body: { remoteJid, messageCount }
    if (req.method === 'POST' && action === 'extract') {
      const body = await readBody(req);
      if (!body.remoteJid) return json(400, { error: 'remoteJid is required in body' });

      const extraction = await extractFromMessages(instanceId, instanceName, body.remoteJid, body.messageCount);
      const result = await getContactKnowledge(instanceId, body.remoteJid);
      return json(200, result);
    }

    // DELETE /knowledge/contact/:instanceName?remoteJid=...
    if (req.method === 'DELETE' && action === 'contact') {
      if (!query.remoteJid) return json(400, { error: 'remoteJid query param required' });
      const result = await deleteContactKnowledge(instanceId, query.remoteJid);
      return json(200, result);
    }

    // GET /knowledge/tasks/:instanceName?remoteJid=...
    if (req.method === 'GET' && action === 'tasks') {
      if (!query.remoteJid) return json(400, { error: 'remoteJid query param required' });
      const tasks = await getContactTasks(instanceId, query.remoteJid);
      return json(200, tasks);
    }

    // POST /knowledge/tasks/extract/:instanceName  body: { remoteJid }
    if (req.method === 'POST' && action === 'tasks') {
      const body = await readBody(req);
      console.log('[Tasks] POST /knowledge/tasks/', instanceName, 'body:', JSON.stringify(body));
      if (!body.remoteJid) return json(400, { error: 'remoteJid is required in body' });
      try {
        const tasks = await extractTasks(instanceId, instanceName, body.remoteJid);
        console.log('[Tasks] Returning', tasks.length, 'tasks');
        return json(200, tasks);
      } catch (err) {
        console.error('[Tasks] extractTasks failed:', err.message, err.stack);
        return json(500, { error: 'Task extraction failed: ' + err.message });
      }
    }

    // PUT /knowledge/task/:instanceName  body: { taskId, status?, title?, priority? }
    if (req.method === 'PUT' && action === 'task') {
      const body = await readBody(req);
      if (!body.taskId) return json(400, { error: 'taskId is required' });
      const task = await updateTask(body.taskId, body);
      return json(200, task);
    }

    // DELETE /knowledge/task/:instanceName?taskId=...
    if (req.method === 'DELETE' && action === 'task') {
      if (!query.taskId) return json(400, { error: 'taskId query param required' });
      const result = await deleteTask(query.taskId);
      return json(200, result);
    }

    return json(404, { error: 'Unknown knowledge route: ' + action });

  } catch (err) {
    console.error('[Knowledge] Error:', err.message);
    json(500, { error: err.message });
  }
}

// =====================
// INIT & EXPORT
// =====================
let initialized = false;

async function init() {
  if (initialized) return;
  if (!DATABASE_URL()) {
    console.log('[Knowledge] DATABASE_URL not set, knowledge graph disabled');
    return;
  }
  try {
    await initTables();
    initialized = true;
  } catch (err) {
    console.error('[Knowledge] Init failed:', err.message);
  }
}

module.exports = { handleRequest, init };
