// =====================
// DASHBOARD - Number Protection & Analytics
// Pulls all data from Evolution API (no local persistence)
// =====================

let dashboardData = null;
let dashLoading = false;

function startDashboard() {
  const el = document.getElementById('dashboardContent');
  if (!el) return;
  if (!currentInstance) {
    renderDashboardEmpty('Selecione uma instancia conectada para ver o dashboard');
    return;
  }
  // Show last data if available, with refresh button
  if (dashboardData && dashboardData._instance === currentInstance) {
    renderDashboard(dashboardData);
  } else {
    loadDashboard();
  }
}

function stopDashboard() {}

async function loadDashboard() {
  if (dashLoading) return;
  if (!currentInstance) {
    renderDashboardEmpty('Selecione uma instancia conectada para ver o dashboard');
    return;
  }

  dashLoading = true;
  const el = document.getElementById('dashboardContent');
  if (!el) { dashLoading = false; return; }

  // Show loading state
  el.innerHTML = '<div class="dash-empty"><div class="spinner"></div><p style="margin-top:16px">Carregando dados da Evolution API...</p></div>';

  const inst = currentInstance;

  try {
    // Fetch all chats and groups in parallel
    const [chatsRes, groupsRes] = await Promise.all([
      api('POST', '/chat/findChats/' + inst, {}),
      api('GET', '/group/fetchAllGroups/' + inst + '?getParticipants=false')
    ]);

    if (currentInstance !== inst) { dashLoading = false; return; }

    const chats = chatsRes.ok && Array.isArray(chatsRes.data) ? chatsRes.data : [];
    const groupsMeta = groupsRes.ok && Array.isArray(groupsRes.data) ? groupsRes.data : [];

    // Build set of group JIDs for quick lookup
    const groupJids = new Set(groupsMeta.map(g => g.id));
    chats.forEach(c => { if (c.remoteJid && c.remoteJid.endsWith('@g.us')) groupJids.add(c.remoteJid); });

    // Get all chat JIDs (filter out status broadcast)
    const chatJids = chats
      .map(c => c.remoteJid)
      .filter(jid => jid && jid !== 'status@broadcast' && jid !== '0@s.whatsapp.net');

    // Fetch messages from all chats (batched)
    const allMessages = [];
    const batchSize = 8;
    for (let i = 0; i < chatJids.length; i += batchSize) {
      const batch = chatJids.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(jid =>
        api('POST', '/chat/findMessages/' + inst, {
          where: { key: { remoteJid: jid } },
          offset: 200,
          page: 1
        }).then(res => {
          const msgs = extractDashMessages(res.ok ? res.data : null);
          return msgs.map(m => ({ ...m, _chatJid: jid, _isGroup: groupJids.has(jid) }));
        }).catch(() => [])
      ));
      results.forEach(msgs => allMessages.push(...msgs));

      if (currentInstance !== inst) { dashLoading = false; return; }
    }

    // Compute metrics from real message data
    const metrics = computeDashMetrics(allMessages, groupsMeta);
    metrics._instance = inst;
    metrics._fetchedAt = Date.now();
    dashboardData = metrics;
    renderDashboard(metrics);

  } catch (e) {
    renderDashboardEmpty('Erro ao carregar dados: ' + (e.message || 'desconhecido'));
  } finally {
    dashLoading = false;
  }
}

// Extract messages from API response (handles different response formats)
function extractDashMessages(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data.messages) {
    if (Array.isArray(data.messages)) return data.messages;
    if (data.messages.records) return data.messages.records;
  }
  if (data.records) return data.records;
  return [];
}

function computeDashMetrics(allMessages, groupsMeta) {
  const now = Date.now();
  const hourAgo = now - 3600000;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayTs = todayStart.getTime();
  const weekAgo = now - 7 * 86400000;
  const monthAgo = now - 30 * 86400000;

  // Separate sent vs received
  const sent = [];
  const received = [];
  const contacts = new Set();

  allMessages.forEach(m => {
    const key = m.key || {};
    const ts = (typeof m.messageTimestamp === 'string' ? parseInt(m.messageTimestamp) : (m.messageTimestamp || 0)) * 1000;
    if (ts === 0) return;

    const entry = { ts, isGroup: m._isGroup, contact: (m._chatJid || '').split('@')[0] };

    if (key.fromMe) {
      sent.push(entry);
    } else {
      received.push(entry);
    }
    if (entry.contact) contacts.add(entry.contact);
  });

  const sentLastHour = sent.filter(e => e.ts > hourAgo).length;
  const sentToday = sent.filter(e => e.ts > todayTs).length;
  const sentWeek = sent.filter(e => e.ts > weekAgo).length;
  const receivedToday = received.filter(e => e.ts > todayTs).length;
  const receivedWeek = received.filter(e => e.ts > weekAgo).length;

  const groupMsgsSent = sent.filter(e => e.isGroup && e.ts > weekAgo).length;
  const privateMsgsSent = sent.filter(e => !e.isGroup && e.ts > weekAgo).length;

  // Hourly activity for today (sent messages)
  const hourlyActivity = new Array(24).fill(0);
  sent.filter(e => e.ts > todayTs).forEach(e => {
    const h = new Date(e.ts).getHours();
    hourlyActivity[h]++;
  });

  // Groups created: count groups from metadata with creation timestamp
  const gcToday = groupsMeta.filter(g => { const t = (g.creation || 0) * 1000; return t > todayTs; }).length;
  const gcWeek = groupsMeta.filter(g => { const t = (g.creation || 0) * 1000; return t > weekAgo; }).length;
  const gcMonth = groupsMeta.filter(g => { const t = (g.creation || 0) * 1000; return t > monthAgo; }).length;

  // Response rate
  const responseRate = sentWeek > 0 ? Math.min(100, Math.round((receivedWeek / sentWeek) * 100)) : 0;

  // Unique contacts this week
  const weekContacts = new Set();
  [...sent, ...received].filter(e => e.ts > weekAgo && e.contact).forEach(e => weekContacts.add(e.contact));

  return {
    sent: { lastHour: sentLastHour, today: sentToday, week: sentWeek },
    received: { today: receivedToday, week: receivedWeek },
    groupsCreated: { today: gcToday, week: gcWeek, month: gcMonth, total: groupsMeta.length },
    groupMsgsSent,
    privateMsgsSent,
    hourlyActivity,
    responseRate,
    uniqueContacts: weekContacts.size,
    totalMessages: allMessages.length,
    totalChats: contacts.size,
  };
}

function renderDashboardEmpty(msg) {
  const el = document.getElementById('dashboardContent');
  if (!el) return;
  el.innerHTML = '<div class="dash-empty"><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg><p>' + escapeHtml(msg) + '</p></div>';
}

function renderDashboard(d) {
  const el = document.getElementById('dashboardContent');
  if (!el) return;

  const risk = calcRisk(d);
  const riskColor = risk < 30 ? 'var(--accent)' : risk < 60 ? 'var(--warning)' : 'var(--danger)';
  const riskLabel = risk < 30 ? 'Baixo' : risk < 60 ? 'Moderado' : risk < 80 ? 'Alto' : 'Critico';

  const sent = d.sent || {};
  const received = d.received || {};
  const groups = d.groupsCreated || {};

  const fetchedAt = d._fetchedAt ? new Date(d._fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';

  el.innerHTML = `
    <!-- Refresh Bar -->
    <div class="dash-refresh-bar">
      <span class="dash-refresh-info">Atualizado as ${fetchedAt} &mdash; ${d.totalMessages || 0} mensagens analisadas em ${d.totalChats || 0} conversas</span>
      <button class="btn btn-primary btn-sm dash-refresh-btn" onclick="loadDashboard()" ${dashLoading ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" width="14" height="14" style="fill:currentColor;margin-right:6px"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        Atualizar
      </button>
    </div>

    <!-- Risk Gauge -->
    <div class="dash-risk-card">
      <div class="dash-risk-gauge">
        <svg viewBox="0 0 120 70" class="dash-gauge-svg">
          <path d="M10 65 A50 50 0 0 1 110 65" fill="none" stroke="var(--border)" stroke-width="10" stroke-linecap="round"/>
          <path d="M10 65 A50 50 0 0 1 110 65" fill="none" stroke="${riskColor}" stroke-width="10" stroke-linecap="round"
            stroke-dasharray="${risk * 1.57} 157" class="dash-gauge-fill"/>
        </svg>
        <div class="dash-risk-value" style="color:${riskColor}">${risk}%</div>
        <div class="dash-risk-label">Risco de Ban: <strong style="color:${riskColor}">${riskLabel}</strong></div>
      </div>
      <div class="dash-risk-factors">
        <div class="dash-risk-title">Fatores de Risco</div>
        ${renderRiskFactors(d)}
      </div>
    </div>

    <!-- KPI Cards Row -->
    <div class="dash-kpi-row">
      ${kpiCard('Enviadas / Hora', sent.lastHour || 0, sent.lastHour > 30 ? 'danger' : sent.lastHour > 15 ? 'warning' : 'ok', limitLabel(sent.lastHour || 0, 30, '/h'))}
      ${kpiCard('Enviadas / Dia', sent.today || 0, sent.today > 500 ? 'danger' : sent.today > 200 ? 'warning' : 'ok', limitLabel(sent.today || 0, 500, '/dia'))}
      ${kpiCard('Enviadas / Semana', sent.week || 0, sent.week > 2000 ? 'danger' : sent.week > 1000 ? 'warning' : 'ok', '')}
      ${kpiCard('Recebidas / Dia', received.today || 0, 'ok', '')}
    </div>

    <!-- Charts Row -->
    <div class="dash-charts-row">
      <div class="dash-card">
        <div class="dash-card-title">Mensagens Enviadas por Tipo (7 dias)</div>
        <div class="dash-donut-container">
          ${renderDonut(d.groupMsgsSent || 0, d.privateMsgsSent || 0)}
          <div class="dash-donut-legend">
            <div class="dash-legend-item"><span class="dash-legend-dot" style="background:var(--accent)"></span>Grupos: ${d.groupMsgsSent || 0}</div>
            <div class="dash-legend-item"><span class="dash-legend-dot" style="background:#6366f1"></span>Individual: ${d.privateMsgsSent || 0}</div>
          </div>
        </div>
      </div>

      <div class="dash-card">
        <div class="dash-card-title">Grupos</div>
        <div class="dash-stat-grid">
          <div class="dash-stat-item">
            <div class="dash-stat-number">${groups.today || 0}</div>
            <div class="dash-stat-label">Criados Hoje</div>
          </div>
          <div class="dash-stat-item">
            <div class="dash-stat-number">${groups.week || 0}</div>
            <div class="dash-stat-label">Criados na Semana</div>
          </div>
          <div class="dash-stat-item">
            <div class="dash-stat-number">${groups.month || 0}</div>
            <div class="dash-stat-label">Criados no Mes</div>
          </div>
          <div class="dash-stat-item">
            <div class="dash-stat-number">${groups.total || 0}</div>
            <div class="dash-stat-label">Total de Grupos</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Hourly Activity -->
    <div class="dash-card">
      <div class="dash-card-title">Mensagens Enviadas por Hora (Hoje)</div>
      <div class="dash-bar-chart">
        ${renderHourlyBars(d.hourlyActivity || [])}
      </div>
      <div class="dash-bar-labels">
        ${Array.from({length: 24}, (_, i) => '<span>' + String(i).padStart(2, '0') + '</span>').join('')}
      </div>
    </div>

    <!-- Engagement -->
    <div class="dash-charts-row">
      <div class="dash-card">
        <div class="dash-card-title">Engajamento (7 dias)</div>
        <div class="dash-stat-grid">
          <div class="dash-stat-item">
            <div class="dash-stat-number">${d.responseRate || 0}%</div>
            <div class="dash-stat-label">Recebidas / Enviadas</div>
          </div>
          <div class="dash-stat-item">
            <div class="dash-stat-number">${d.uniqueContacts || 0}</div>
            <div class="dash-stat-label">Conversas Ativas</div>
          </div>
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-title">Volume Semanal</div>
        <div class="dash-stat-grid">
          <div class="dash-stat-item">
            <div class="dash-stat-number">${sent.week || 0}</div>
            <div class="dash-stat-label">Enviadas</div>
          </div>
          <div class="dash-stat-item">
            <div class="dash-stat-number">${(received.week || 0)}</div>
            <div class="dash-stat-label">Recebidas</div>
          </div>
        </div>
      </div>
    </div>

    ${renderAlerts(d)}
  `;
}

function calcRisk(d) {
  let risk = 0;
  const sent = d.sent || {};

  if ((sent.lastHour || 0) > 30) risk += 25;
  else if ((sent.lastHour || 0) > 15) risk += 10;

  if ((sent.today || 0) > 500) risk += 20;
  else if ((sent.today || 0) > 200) risk += 10;

  const gc = d.groupsCreated || {};
  if ((gc.today || 0) > 10) risk += 15;
  else if ((gc.today || 0) > 5) risk += 8;

  const totalSent = sent.today || 0;
  const totalReceived = (d.received || {}).today || 0;
  if (totalSent > 20 && totalReceived === 0) risk += 15;
  else if (totalSent > 50 && totalReceived < totalSent * 0.1) risk += 10;

  const hourly = d.hourlyActivity || [];
  const nightMsgs = hourly.slice(0, 6).reduce((a, b) => a + b, 0);
  if (nightMsgs > 20) risk += 10;
  else if (nightMsgs > 5) risk += 5;

  return Math.min(100, Math.round(risk));
}

function renderRiskFactors(d) {
  const factors = [];
  const sent = d.sent || {};
  const gc = d.groupsCreated || {};
  const hourly = d.hourlyActivity || [];
  const nightMsgs = hourly.slice(0, 6).reduce((a, b) => a + b, 0);

  if ((sent.lastHour || 0) > 30) factors.push({ level: 'danger', text: 'Volume muito alto por hora: ' + sent.lastHour + ' msgs' });
  else if ((sent.lastHour || 0) > 15) factors.push({ level: 'warning', text: 'Volume alto por hora: ' + sent.lastHour + ' msgs' });
  else factors.push({ level: 'ok', text: 'Volume por hora normal' });

  if ((gc.today || 0) > 10) factors.push({ level: 'danger', text: 'Muitos grupos criados hoje: ' + gc.today });
  else if ((gc.today || 0) > 5) factors.push({ level: 'warning', text: 'Grupos criados acima do ideal: ' + gc.today });

  const totalSent = sent.today || 0;
  const totalReceived = (d.received || {}).today || 0;
  if (totalSent > 20 && totalReceived === 0) factors.push({ level: 'danger', text: 'Sem mensagens recebidas - parece bot' });
  else if (totalSent > 50 && totalReceived < totalSent * 0.1) factors.push({ level: 'warning', text: 'Taxa de resposta muito baixa' });

  if (nightMsgs > 20) factors.push({ level: 'danger', text: 'Atividade excessiva de madrugada' });
  else if (nightMsgs > 5) factors.push({ level: 'warning', text: 'Atividade de madrugada detectada' });

  if (factors.length === 0 || (factors.length === 1 && factors[0].level === 'ok')) {
    factors.push({ level: 'ok', text: 'Nenhum fator de risco detectado' });
  }

  return factors.map(f => {
    const icon = f.level === 'ok' ? '&#10003;' : f.level === 'warning' ? '&#9888;' : '&#10007;';
    return '<div class="dash-factor dash-factor-' + f.level + '"><span class="dash-factor-icon">' + icon + '</span>' + escapeHtml(f.text) + '</div>';
  }).join('');
}

function kpiCard(title, value, status, subtitle) {
  const statusClass = status === 'danger' ? 'dash-kpi-danger' : status === 'warning' ? 'dash-kpi-warning' : '';
  return '<div class="dash-kpi ' + statusClass + '">' +
    '<div class="dash-kpi-value">' + value + '</div>' +
    '<div class="dash-kpi-title">' + escapeHtml(title) + '</div>' +
    (subtitle ? '<div class="dash-kpi-sub">' + escapeHtml(subtitle) + '</div>' : '') +
    '</div>';
}

function limitLabel(current, limit, suffix) {
  if (current > limit) return 'ACIMA do limite seguro de ' + limit + suffix;
  if (current > limit * 0.6) return 'Proximo do limite de ' + limit + suffix;
  return '';
}

function renderDonut(groupVal, privateVal) {
  const total = groupVal + privateVal;
  if (total === 0) return '<div class="dash-donut-empty">Sem dados</div>';
  const groupPct = (groupVal / total) * 100;
  return '<div class="dash-donut" style="background:conic-gradient(var(--accent) 0% ' + groupPct + '%, #6366f1 ' + groupPct + '% 100%)">' +
    '<div class="dash-donut-hole"><div class="dash-donut-total">' + total + '</div><div class="dash-donut-total-label">total</div></div></div>';
}

function renderHourlyBars(hourly) {
  const max = Math.max(...hourly, 1);
  return hourly.map(function(val, i) {
    const h = Math.round((val / max) * 100);
    const isNight = i < 6;
    const cls = isNight && val > 0 ? 'dash-bar-night' : val > 30 ? 'dash-bar-danger' : val > 15 ? 'dash-bar-warning' : '';
    return '<div class="dash-bar ' + cls + '" style="height:' + Math.max(h, 2) + '%" title="' + String(i).padStart(2, '0') + 'h: ' + val + ' msgs"></div>';
  }).join('');
}

function renderAlerts(d) {
  const alerts = [];
  const sent = d.sent || {};
  const gc = d.groupsCreated || {};

  if ((sent.lastHour || 0) > 30) {
    alerts.push({ type: 'danger', msg: 'Reduza o ritmo de envio! Voce esta enviando ' + sent.lastHour + ' mensagens por hora. O limite seguro e ~30/h.' });
  }
  if ((gc.today || 0) > 10) {
    alerts.push({ type: 'danger', msg: 'Voce criou ' + gc.today + ' grupos hoje. O WhatsApp pode bloquear numeros que criam muitos grupos rapidamente.' });
  }
  const totalSent = sent.today || 0;
  const totalReceived = (d.received || {}).today || 0;
  if (totalSent > 50 && totalReceived < totalSent * 0.1) {
    alerts.push({ type: 'warning', msg: 'Sua taxa de resposta esta muito baixa (' + (d.responseRate || 0) + '%). Numeros que so enviam e nao recebem parecem bots.' });
  }

  if (alerts.length === 0) return '';

  return '<div class="dash-alerts">' + alerts.map(function(a) {
    return '<div class="dash-alert dash-alert-' + a.type + '">' +
      '<span class="dash-alert-icon">' + (a.type === 'danger' ? '&#9888;' : '&#9432;') + '</span>' +
      '<span>' + escapeHtml(a.msg) + '</span></div>';
  }).join('') + '</div>';
}
