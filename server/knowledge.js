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

    CREATE INDEX IF NOT EXISTS idx_ke_contact ON "KnowledgeEntity"("contactKnowledgeId");
    CREATE INDEX IF NOT EXISTS idx_ke_category ON "KnowledgeEntity"(category);
    CREATE INDEX IF NOT EXISTS idx_kr_contact ON "KnowledgeRelationship"("contactKnowledgeId");
  `);
  console.log('[Knowledge] Tables initialized');
}

// =====================
// OPENAI LLM
// =====================
const EXTRACTION_PROMPT = `Voce e um analisador de informacoes de clientes. Analise as mensagens do chat e extraia informacoes importantes sobre o cliente.

CATEGORIAS DE ENTIDADES para extrair:
- PESSOA: nomes de familiares, amigos, colegas (label: nome, value: relacao com o contato)
- FAMILIA: informacoes familiares (label: tipo como "estado_civil", "filhos", "conjuge", value: detalhe)
- FINANCEIRO: renda, dividas, investimentos, profissao (label: tipo, value: detalhe)
- SAUDE: condicoes de saude, medicamentos, planos (label: tipo, value: detalhe)
- MORADIA: endereco, tipo de imovel, bairro (label: tipo, value: detalhe)
- TRABALHO: empresa, cargo, area de atuacao (label: tipo, value: detalhe)
- EDUCACAO: formacao, cursos, instituicoes (label: tipo, value: detalhe)
- INTERESSE: hobbies, preferencias, gostos (label: tipo, value: detalhe)
- EVENTO: datas importantes, aniversarios, compromissos (label: tipo, value: detalhe)
- SENTIMENTO: humor atual, satisfacao, reclamacoes (label: tipo, value: detalhe)

REGRAS:
1. Extraia APENAS informacoes explicitamente mencionadas nas mensagens.
2. NAO invente ou infira informacoes que nao estejam claras.
3. Atribua um nivel de confianca (0.0 a 1.0) para cada entidade.
4. Identifique relacionamentos entre entidades quando possivel.
5. Gere um resumo breve do perfil atualizado do cliente.

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

// Resolve a remoteJid to all possible JID variants (LID, phone, etc.)
async function resolveJidVariants(instanceName, remoteJid) {
  const variants = [remoteJid];

  // If it's a LID, try to resolve to phone JID
  if (remoteJid.includes('@lid')) {
    try {
      const res = await evoRequest('POST', '/chat/whatsappNumbers/' + instanceName, {
        numbers: [remoteJid],
      });
      if (Array.isArray(res)) {
        for (const entry of res) {
          if (entry.jid && !variants.includes(entry.jid)) variants.push(entry.jid);
          // Also try the number@s.whatsapp.net format
          if (entry.jid) {
            const num = entry.jid.split('@')[0];
            const phoneJid = num + '@s.whatsapp.net';
            if (!variants.includes(phoneJid)) variants.push(phoneJid);
          }
        }
      }
    } catch {}
  }

  // If it's a phone JID, also check for LID variant in IsOnWhatsapp table
  if (remoteJid.includes('@s.whatsapp.net')) {
    const num = remoteJid.split('@')[0];
    const lidJid = num + '@lid';
    if (!variants.includes(lidJid)) variants.push(lidJid);
  }

  // Also try without the @suffix as a number
  const rawNum = remoteJid.split('@')[0];
  if (rawNum && !variants.includes(rawNum)) variants.push(rawNum);

  return variants;
}

async function extractFromMessages(instanceId, instanceName, remoteJid, messageCount) {
  const db = getPool();
  const limit = messageCount || 50;

  // Try multiple JID variants to find messages
  const jidVariants = await resolveJidVariants(instanceName, remoteJid);
  console.log('[Knowledge] Trying JID variants:', jidVariants);

  let allMessages = [];
  const seenIds = new Set();

  for (const jid of jidVariants) {
    try {
      const msgs = await evoRequest('POST', '/chat/findMessages/' + instanceName, {
        where: { key: { remoteJid: jid } },
        limit,
      });
      if (Array.isArray(msgs)) {
        for (const m of msgs) {
          const mid = m.key?.id || m.id;
          if (mid && !seenIds.has(mid)) {
            seenIds.add(mid);
            allMessages.push(m);
          }
        }
      }
    } catch {}
  }

  console.log('[Knowledge] Found', allMessages.length, 'messages across', jidVariants.length, 'JID variants');

  if (allMessages.length === 0) {
    throw new Error('No messages found for ' + remoteJid + ' (tried variants: ' + jidVariants.join(', ') + ')');
  }

  const messages = allMessages;

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
