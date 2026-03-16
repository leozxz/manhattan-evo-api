// =====================
// DASHBOARD - Number Protection & Analytics
// =====================

let dashboardInterval = null;
let dashboardData = null;

function startDashboard() {
  fixWebhooks();
  loadDashboard();
  if (dashboardInterval) clearInterval(dashboardInterval);
  dashboardInterval = setInterval(loadDashboard, 15000); // refresh every 15s
}

// Ensure all instances have MESSAGES_UPSERT webhook configured
function fixWebhooks() {
  const connected = instances.filter(i => i.state === 'open').map(i => i.name);
  if (connected.length > 0) {
    api('POST', '/api/fix-webhooks', { instances: connected });
  }
}

function stopDashboard() {
  if (dashboardInterval) { clearInterval(dashboardInterval); dashboardInterval = null; }
}

async function loadDashboard() {
  if (!currentInstance) {
    renderDashboardEmpty('Selecione uma instancia conectada para ver o dashboard');
    return;
  }
  const res = await api('GET', '/api/metrics/' + encodeURIComponent(currentInstance));
  if (!res.ok) {
    renderDashboardEmpty('Erro ao carregar metricas');
    return;
  }
  dashboardData = res.data;
  renderDashboard(dashboardData);
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

  el.innerHTML = `
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
        ${renderRiskFactors(d, risk)}
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
      <!-- Messages by Type -->
      <div class="dash-card">
        <div class="dash-card-title">Mensagens por Tipo</div>
        <div class="dash-donut-container">
          ${renderDonut(d.groupMsgsSent || 0, d.privateMsgsSent || 0)}
          <div class="dash-donut-legend">
            <div class="dash-legend-item"><span class="dash-legend-dot" style="background:var(--accent)"></span>Grupos: ${d.groupMsgsSent || 0}</div>
            <div class="dash-legend-item"><span class="dash-legend-dot" style="background:#6366f1"></span>Individual: ${d.privateMsgsSent || 0}</div>
          </div>
        </div>
      </div>

      <!-- Groups Created -->
      <div class="dash-card">
        <div class="dash-card-title">Grupos Criados</div>
        <div class="dash-stat-grid">
          <div class="dash-stat-item">
            <div class="dash-stat-number">${groups.today || 0}</div>
            <div class="dash-stat-label">Hoje</div>
          </div>
          <div class="dash-stat-item">
            <div class="dash-stat-number">${groups.week || 0}</div>
            <div class="dash-stat-label">Semana</div>
          </div>
          <div class="dash-stat-item">
            <div class="dash-stat-number">${groups.month || 0}</div>
            <div class="dash-stat-label">Mes</div>
          </div>
          <div class="dash-stat-item">
            <div class="dash-stat-number">${groups.total || 0}</div>
            <div class="dash-stat-label">Total</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Hourly Activity -->
    <div class="dash-card">
      <div class="dash-card-title">Atividade por Hora (Hoje)</div>
      <div class="dash-bar-chart">
        ${renderHourlyBars(d.hourlyActivity || [])}
      </div>
      <div class="dash-bar-labels">
        ${Array.from({length:24}, (_,i) => `<span>${String(i).padStart(2,'0')}</span>`).join('')}
      </div>
    </div>

    <!-- Additional Metrics -->
    <div class="dash-charts-row">
      <!-- Connection Stability -->
      <div class="dash-card">
        <div class="dash-card-title">Estabilidade da Conexao</div>
        <div class="dash-stat-grid">
          <div class="dash-stat-item">
            <div class="dash-stat-number">${d.disconnections || 0}</div>
            <div class="dash-stat-label">Desconexoes (7d)</div>
          </div>
          <div class="dash-stat-item">
            <div class="dash-stat-number">${d.uptime || '--'}%</div>
            <div class="dash-stat-label">Uptime</div>
          </div>
        </div>
      </div>

      <!-- Engagement -->
      <div class="dash-card">
        <div class="dash-card-title">Engajamento</div>
        <div class="dash-stat-grid">
          <div class="dash-stat-item">
            <div class="dash-stat-number">${d.responseRate || 0}%</div>
            <div class="dash-stat-label">Taxa de Resposta</div>
          </div>
          <div class="dash-stat-item">
            <div class="dash-stat-number">${d.uniqueContacts || 0}</div>
            <div class="dash-stat-label">Contatos Unicos (7d)</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Alerts -->
    ${renderAlerts(d)}
  `;
}

function calcRisk(d) {
  let risk = 0;
  const sent = d.sent || {};

  // High hourly volume
  if ((sent.lastHour || 0) > 30) risk += 25;
  else if ((sent.lastHour || 0) > 15) risk += 10;

  // High daily volume
  if ((sent.today || 0) > 500) risk += 20;
  else if ((sent.today || 0) > 200) risk += 10;

  // Too many groups created
  const gc = d.groupsCreated || {};
  if ((gc.today || 0) > 10) risk += 15;
  else if ((gc.today || 0) > 5) risk += 8;

  // Low engagement (sending much more than receiving)
  const totalSent = sent.today || 0;
  const totalReceived = (d.received || {}).today || 0;
  if (totalSent > 20 && totalReceived === 0) risk += 15;
  else if (totalSent > 50 && totalReceived < totalSent * 0.1) risk += 10;

  // Connection instability
  if ((d.disconnections || 0) > 5) risk += 10;
  else if ((d.disconnections || 0) > 2) risk += 5;

  // Night activity (messages between 00-06)
  const hourly = d.hourlyActivity || [];
  const nightMsgs = hourly.slice(0, 6).reduce((a, b) => a + b, 0);
  if (nightMsgs > 20) risk += 10;
  else if (nightMsgs > 5) risk += 5;

  return Math.min(100, Math.round(risk));
}

function renderRiskFactors(d, risk) {
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

  if ((d.disconnections || 0) > 5) factors.push({ level: 'danger', text: 'Conexao instavel: ' + d.disconnections + ' quedas em 7 dias' });

  if (factors.length === 0 || (factors.length === 1 && factors[0].level === 'ok')) {
    factors.push({ level: 'ok', text: 'Nenhum fator de risco detectado' });
  }

  return factors.map(f => {
    const icon = f.level === 'ok' ? '&#10003;' : f.level === 'warning' ? '&#9888;' : '&#10007;';
    return `<div class="dash-factor dash-factor-${f.level}"><span class="dash-factor-icon">${icon}</span>${escapeHtml(f.text)}</div>`;
  }).join('');
}

function kpiCard(title, value, status, subtitle) {
  const statusClass = status === 'danger' ? 'dash-kpi-danger' : status === 'warning' ? 'dash-kpi-warning' : '';
  return `<div class="dash-kpi ${statusClass}">
    <div class="dash-kpi-value">${value}</div>
    <div class="dash-kpi-title">${escapeHtml(title)}</div>
    ${subtitle ? '<div class="dash-kpi-sub">' + escapeHtml(subtitle) + '</div>' : ''}
  </div>`;
}

function limitLabel(current, limit, suffix) {
  if (current > limit) return 'ACIMA do limite seguro de ' + limit + suffix;
  if (current > limit * 0.6) return 'Proximo do limite de ' + limit + suffix;
  return '';
}

function renderDonut(groupVal, privateVal) {
  const total = groupVal + privateVal;
  if (total === 0) {
    return '<div class="dash-donut-empty">Sem dados</div>';
  }
  const groupPct = (groupVal / total) * 100;
  const privatePct = (privateVal / total) * 100;
  // CSS conic-gradient donut
  return `<div class="dash-donut" style="background:conic-gradient(var(--accent) 0% ${groupPct}%, #6366f1 ${groupPct}% 100%)">
    <div class="dash-donut-hole">
      <div class="dash-donut-total">${total}</div>
      <div class="dash-donut-total-label">total</div>
    </div>
  </div>`;
}

function renderHourlyBars(hourly) {
  const max = Math.max(...hourly, 1);
  return hourly.map((val, i) => {
    const h = Math.round((val / max) * 100);
    const isNight = i < 6;
    const cls = isNight && val > 0 ? 'dash-bar-night' : val > 30 ? 'dash-bar-danger' : val > 15 ? 'dash-bar-warning' : '';
    return `<div class="dash-bar ${cls}" style="height:${Math.max(h, 2)}%" title="${String(i).padStart(2,'0')}h: ${val} msgs"></div>`;
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
  if ((d.disconnections || 0) > 3) {
    alerts.push({ type: 'warning', msg: 'Sua conexao caiu ' + d.disconnections + ' vezes nos ultimos 7 dias. Conexoes instáveis aumentam o risco de ban.' });
  }

  const totalSent = sent.today || 0;
  const totalReceived = (d.received || {}).today || 0;
  if (totalSent > 50 && totalReceived < totalSent * 0.1) {
    alerts.push({ type: 'warning', msg: 'Sua taxa de resposta esta muito baixa (' + d.responseRate + '%). Numeros que so enviam e nao recebem parecem bots.' });
  }

  if (alerts.length === 0) return '';

  return '<div class="dash-alerts">' + alerts.map(a =>
    `<div class="dash-alert dash-alert-${a.type}">
      <span class="dash-alert-icon">${a.type === 'danger' ? '&#9888;' : '&#9432;'}</span>
      <span>${escapeHtml(a.msg)}</span>
    </div>`
  ).join('') + '</div>';
}
