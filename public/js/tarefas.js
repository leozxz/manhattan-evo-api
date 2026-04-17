// =====================
// TAREFAS PAGE
// =====================
let tarefasLoading = false;
let tarefasData = [];
let tarefasFilter = 'todas';

async function loadTarefasPage() {
  const el = document.getElementById('tarefasContent');
  if (!el) return;

  if (!currentInstance) {
    el.innerHTML = '<div class="tarefas-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg><p>Conecte uma instancia para ver as tarefas</p></div>';
    return;
  }

  if (tarefasLoading) return;
  tarefasLoading = true;

  el.innerHTML = '<div class="tarefas-empty"><div class="spinner"></div><p>Carregando tarefas...</p></div>';

  try {
    const res = await api('GET', '/knowledge/tasks/' + currentInstance);
    tarefasData = res.ok && Array.isArray(res.data) ? res.data : [];
    renderTarefasPage();
  } catch {
    el.innerHTML = '<div class="tarefas-empty"><p>Erro ao carregar tarefas</p></div>';
  } finally {
    tarefasLoading = false;
  }
}

function renderTarefasPage() {
  const el = document.getElementById('tarefasContent');
  if (!el) return;

  // Count by priority
  const counts = { todas: tarefasData.length, alta: 0, media: 0, baixa: 0 };
  tarefasData.forEach(t => { if (counts[t.priority] !== undefined) counts[t.priority]++; });

  const filtered = tarefasFilter === 'todas'
    ? tarefasData
    : tarefasData.filter(t => t.priority === tarefasFilter);

  let html = '<div class="tarefas-page">';

  // Header with stats
  html += '<div class="tarefas-header">';
  html += '<div class="tarefas-stats">';
  html += renderStatPill('todas', counts.todas, '#6b7280');
  html += renderStatPill('alta', counts.alta, '#ef4444');
  html += renderStatPill('media', counts.media, '#f59e0b');
  html += renderStatPill('baixa', counts.baixa, '#3b82f6');
  html += '</div>';
  html += '<button class="btn btn-secondary btn-sm" onclick="loadTarefasPage()" title="Atualizar"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg></button>';
  html += '</div>';

  if (filtered.length === 0) {
    html += '<div class="tarefas-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg><p>Nenhuma tarefa ' + (tarefasFilter === 'todas' ? 'pendente' : 'com prioridade ' + tarefasFilter) + '</p></div>';
  } else {
    html += '<div class="tarefas-list">';
    filtered.forEach(task => {
      html += renderTarefaCard(task);
    });
    html += '</div>';
  }

  html += '</div>';
  el.innerHTML = html;
}

function renderStatPill(key, count, color) {
  const labels = { todas: 'Todas', alta: 'Urgente', media: 'Media', baixa: 'Baixa' };
  const isActive = tarefasFilter === key;
  return '<button class="tarefas-filter-pill' + (isActive ? ' active' : '') + '" onclick="setTarefasFilter(\'' + key + '\')" style="--pill-color:' + color + '">' +
    '<span class="tarefas-pill-dot" style="background:' + color + '"></span>' +
    labels[key] + '<span class="tarefas-pill-count">' + count + '</span></button>';
}

function renderTarefaCard(task) {
  const priorityColors = { alta: '#ef4444', media: '#f59e0b', baixa: '#3b82f6' };
  const priorityLabels = { alta: 'Urgente', media: 'Media', baixa: 'Baixa' };
  const color = priorityColors[task.priority] || '#9ca3af';

  const contactName = task.savedName || task.pushName || '';
  const phone = task.remoteJid ? task.remoteJid.split('@')[0] : '';
  const displayName = contactName || (phone ? formatPhone(phone) : 'Desconhecido');

  const created = task.createdAt ? timeAgo(new Date(task.createdAt)) : '';
  const dueDate = task.dueDate ? formatDueDate(task.dueDate) : '';
  const isNew = task.status === 'nova';

  const jid = task.remoteJid || '';

  return '<div class="tarefa-card" onclick="openTarefaChat(\'' + escapeAttr(jid) + '\')" style="cursor:pointer" title="Abrir conversa">' +
    '<div class="tarefa-priority-bar" style="background:' + color + '"></div>' +
    '<div class="tarefa-body">' +
      '<div class="tarefa-top">' +
        '<div class="tarefa-title">' + escapeHtml(task.title) + '</div>' +
        '<span class="tarefa-priority-badge" style="background:' + color + '15;color:' + color + '">' + (priorityLabels[task.priority] || task.priority) + '</span>' +
      '</div>' +
      '<div class="tarefa-meta">' +
        '<span class="tarefa-contact" title="' + escapeHtml(phone) + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg> ' + escapeHtml(displayName) + '</span>' +
        (created ? '<span class="tarefa-date"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg> ' + created + '</span>' : '') +
        (dueDate ? '<span class="tarefa-due">' + dueDate + '</span>' : '') +
      '</div>' +
      (isNew ? '<div class="tarefa-new-actions"><button class="btn btn-primary btn-sm" onclick="event.stopPropagation();tarefaAccept(\'' + task.id + '\')">Aceitar</button><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();tarefaReject(\'' + task.id + '\')">Recusar</button></div>' : '') +
    '</div>' +
    '<div class="tarefa-actions">' +
      '<button class="tarefa-done-btn" onclick="event.stopPropagation();tarefaDone(\'' + task.id + '\')" title="Concluir"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg></button>' +
      '<button class="tarefa-dismiss-btn" onclick="event.stopPropagation();tarefaReject(\'' + task.id + '\')" title="Remover"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>' +
    '</div>' +
  '</div>';
}

function setTarefasFilter(filter) {
  tarefasFilter = filter;
  renderTarefasPage();
}

async function tarefaDone(taskId) {
  try {
    await api('PUT', '/knowledge/task/' + currentInstance, { taskId, status: 'concluida' });
    tarefasData = tarefasData.filter(t => t.id !== taskId);
    const card = document.querySelector('.tarefa-card [onclick*="' + taskId + '"]')?.closest('.tarefa-card');
    if (card) {
      card.style.transition = 'all 0.3s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(20px)';
      setTimeout(() => renderTarefasPage(), 300);
    } else {
      renderTarefasPage();
    }
    toast('Tarefa concluida!');
  } catch { toast('Erro ao concluir', 'error'); }
}

async function tarefaAccept(taskId) {
  try {
    await api('PUT', '/knowledge/task/' + currentInstance, { taskId, status: 'aceita' });
    const task = tarefasData.find(t => t.id === taskId);
    if (task) task.status = 'aceita';
    renderTarefasPage();
  } catch { toast('Erro ao aceitar', 'error'); }
}

async function tarefaReject(taskId) {
  try {
    await api('PUT', '/knowledge/task/' + currentInstance, { taskId, status: 'recusada' });
    tarefasData = tarefasData.filter(t => t.id !== taskId);
    const card = document.querySelector('.tarefa-card [onclick*="' + taskId + '"]')?.closest('.tarefa-card');
    if (card) {
      card.style.transition = 'all 0.3s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(-20px)';
      setTimeout(() => renderTarefasPage(), 300);
    } else {
      renderTarefasPage();
    }
  } catch { toast('Erro ao remover', 'error'); }
}

function timeAgo(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return Math.floor(diff / 60) + 'min';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function openTarefaChat(jid) {
  if (!jid) return toast('Contato sem JID', 'error');
  const phone = jid.split('@')[0];
  let chat = allChats.find(c => c.id === jid || c.phone === phone);
  if (!chat) {
    chat = {
      id: jid,
      messageJid: jid,
      isGroup: false,
      subject: '',
      pushName: '',
      phone: phone,
      size: 0,
      profilePicUrl: null,
      lastMessageTs: 0,
      unreadCount: 0
    };
    allChats.push(chat);
    renderGroupList();
  }
  showPage('chat');
  setTimeout(() => { selectGroup(chat, null); }, 100);
}

function formatDueDate(dateStr) {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((d - now) / 86400000);
    const formatted = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    if (diffDays < 0) return '<span style="color:#ef4444">Atrasada ' + formatted + '</span>';
    if (diffDays === 0) return '<span style="color:#f59e0b">Hoje</span>';
    if (diffDays === 1) return '<span style="color:#f59e0b">Amanha</span>';
    return formatted;
  } catch { return dateStr; }
}
