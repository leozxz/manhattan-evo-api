// =====================
// GROUP PANEL (participants + info)
// =====================
let currentPanelTab = 'participants';

async function togglePanel() {
  showPanel = !showPanel;
  const panel = document.getElementById('groupPanel');
  if (!panel) return;
  panel.style.display = showPanel ? 'flex' : 'none';
  if (showPanel) {
    if (currentPanelTab === 'participants') loadParticipants();
    else loadGroupInfo();
  }
}

function switchPanelTab(tab) {
  currentPanelTab = tab;
  document.querySelectorAll('.gp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  if (tab === 'participants') loadParticipants();
  else loadGroupInfo();
}

// =====================
// KNOWLEDGE PANEL (individual chats)
// =====================
let showKnowledgePanel = false;

const KNOWLEDGE_CATEGORIES = {
  PESSOA: { label: 'Pessoas' },
  FAMILIA: { label: 'Familia' },
  FINANCEIRO: { label: 'Financeiro' },
  SAUDE: { label: 'Saude' },
  MORADIA: { label: 'Moradia' },
  TRABALHO: { label: 'Trabalho' },
  EDUCACAO: { label: 'Educacao' },
  INTERESSE: { label: 'Interesses' },
  EVENTO: { label: 'Eventos' },
  SENTIMENTO: { label: 'Sentimento' },
};

async function toggleKnowledgePanel() {
  // For private chats, panel is always visible — just reload
  const panel = document.getElementById('knowledgePanel');
  if (!panel) return;
  if (panel.style.display === 'flex') {
    loadUnifiedPanel();
  } else {
    showKnowledgePanel = true;
    panel.style.display = 'flex';
    loadUnifiedPanel();
  }
}

async function loadUnifiedPanel() {
  const body = document.getElementById('knowledgePanelBody');
  if (!body) return;
  body.innerHTML = '<div class="spinner" style="margin-top:40px"></div>';

  // Load knowledge + tasks in parallel, also trigger extraction in background
  const jid = encodeURIComponent(selectedGroup);
  const [knowledgeRes, tasksRes] = await Promise.all([
    api('GET', '/knowledge/contact/' + currentInstance + '?remoteJid=' + jid),
    api('GET', '/knowledge/tasks/' + currentInstance + '?remoteJid=' + jid),
  ]);

  // Trigger AI refresh in background (sends existing data, only adds new)
  api('POST', '/knowledge/extract/' + currentInstance, { remoteJid: selectedGroup, messageCount: 50 }).catch(() => {});
  api('POST', '/knowledge/tasks/' + currentInstance, { remoteJid: selectedGroup }).then(() => {
    // Reload tasks section after AI finishes
    api('GET', '/knowledge/tasks/' + currentInstance + '?remoteJid=' + jid).then(r => {
      if (r.ok && Array.isArray(r.data)) renderTasksInPanel(r.data);
    });
  }).catch(() => {});

  body.innerHTML = '';

  // === PROFILE CARD ===
  const data = knowledgeRes.ok ? knowledgeRes.data : null;
  if (data) {
    const entities = data.entities || [];
    const profileEl = document.createElement('div');
    profileEl.className = 'profile-card';

    // Build profile fields from entities
    const profileFields = [];
    const contactName = data.savedName || data.pushName || '';
    if (contactName) profileFields.push({ icon: 'person', label: 'Nome', value: contactName });

    // Map of labels to look for (case-insensitive partial match)
    const fieldMap = [
      { keys: ['idade','nascimento','aniversario'], icon: 'cake', label: 'Idade' },
      { keys: ['patrimonio total','patrimonio'], icon: 'account_balance', label: 'Patrimonio' },
      { keys: ['renda mensal','renda','salario'], icon: 'payments', label: 'Renda' },
      { keys: ['profissao','cargo','empresa','trabalho'], icon: 'work', label: 'Trabalho' },
      { keys: ['estado civil','casado','solteiro'], icon: 'favorite', label: 'Estado Civil' },
      { keys: ['cidade','moradia','endereco','bairro'], icon: 'location_on', label: 'Moradia' },
      { keys: ['perfil investidor','perfil do investidor'], icon: 'trending_up', label: 'Perfil' },
      { keys: ['objetivo financeiro','meta financeira'], icon: 'flag', label: 'Objetivo' },
    ];

    const usedEntityIds = new Set();
    for (const field of fieldMap) {
      const match = entities.find(e =>
        !usedEntityIds.has(e.id) &&
        field.keys.some(k => e.label.toLowerCase().includes(k))
      );
      if (match) {
        usedEntityIds.add(match.id);
        profileFields.push({ icon: field.icon, label: field.label, value: match.value });
      }
    }

    let profileHtml = '';
    if (profileFields.length > 0) {
      profileHtml = '<div class="profile-fields">' +
        profileFields.map(f =>
          '<div class="profile-field">' +
            '<span class="profile-field-label">' + escapeHtml(f.label) + '</span>' +
            '<span class="profile-field-value">' + escapeHtml(f.value) + '</span>' +
          '</div>'
        ).join('') +
        '</div>';
    }

    if (data.summary) {
      profileHtml += '<div class="profile-summary">' + escapeHtml(data.summary) + '</div>';
    }

    if (profileHtml) {
      profileEl.innerHTML = profileHtml;
      body.appendChild(profileEl);
    }
  }

  // === TASKS ===
  const tasksHeader = document.createElement('div');
  tasksHeader.className = 'knowledge-category-header';
  tasksHeader.innerHTML = '<span>Tarefas</span><button class="task-add-btn" onclick="showCreateTaskModal()" title="Criar tarefa">+</button>';
  body.appendChild(tasksHeader);

  const taskContainer = document.createElement('div');
  taskContainer.id = 'taskListContainer';
  body.appendChild(taskContainer);

  const tasks = tasksRes.ok && Array.isArray(tasksRes.data) ? tasksRes.data : [];
  renderTasksInPanel(tasks);
}

function renderTasksInPanel(tasks) {
  _taskCache = tasks;
  const container = document.getElementById('taskListContainer');
  if (!container) return;

  if (tasks.length === 0) {
    container.innerHTML = '<div style="padding:12px 16px;text-align:center;color:var(--text-muted);font-size:12px">Nenhuma tarefa pendente</div>';
    return;
  }

  container.innerHTML = '';
  const taskList = document.createElement('div');
  taskList.className = 'task-list';

  tasks.forEach(task => {
    const priorityColors = { alta: '#ef4444', media: '#f59e0b', baixa: '#3b82f6' };
    const color = priorityColors[task.priority] || '#9ca3af';
    const isNew = task.status === 'nova';

    const card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.taskId = task.id;
    card.onclick = () => openTaskModal(task.id);

    card.innerHTML = '<div class="task-priority-bar" style="background:' + color + '"></div>' +
      '<div class="task-card-body">' +
        '<div class="task-card-row">' +
          '<button class="task-complete-btn" onclick="event.stopPropagation();completeTask(\'' + task.id + '\')" title="Concluir"><span class="task-check-circle"></span></button>' +
          '<div class="task-title">' + escapeHtml(task.title) + '</div>' +
          '<button class="task-x-btn" onclick="event.stopPropagation();rejectTask(\'' + task.id + '\')" title="Remover"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>' +
        '</div>' +
        (isNew ? '<div class="task-new-actions"><button class="task-accept-btn" onclick="event.stopPropagation();acceptTask(\'' + task.id + '\')">Aceitar</button><button class="task-reject-btn" onclick="event.stopPropagation();rejectTask(\'' + task.id + '\')">Recusar</button></div>' : '') +
      '</div>';
    taskList.appendChild(card);
  });

  container.appendChild(taskList);
}

async function forceKnowledgeExtraction() {
  const body = document.getElementById('knowledgePanelBody');
  if (body) body.innerHTML = '<div class="spinner" style="margin-top:40px"></div><p style="text-align:center;color:#888;margin-top:8px;font-size:12px">Analisando mensagens com IA...</p>';

  try {
    await api('POST', '/knowledge/extract/' + currentInstance, { remoteJid: selectedGroup, messageCount: 50 });
    toast('Analise concluida!');
  } catch (err) {
    toast('Erro na analise: ' + err.message, 'error');
  }

  await loadUnifiedPanel();
}

async function forceRefreshPanel() {
  const body = document.getElementById('knowledgePanelBody');
  if (body) body.innerHTML = '<div class="spinner" style="margin-top:40px"></div><p style="text-align:center;color:#888;margin-top:8px;font-size:12px">Analisando com IA...</p>';

  try {
    await Promise.all([
      api('POST', '/knowledge/extract/' + currentInstance, { remoteJid: selectedGroup, messageCount: 50 }),
      api('POST', '/knowledge/tasks/' + currentInstance, { remoteJid: selectedGroup }),
    ]);
    toast('Perfil atualizado!');
  } catch {}

  await loadUnifiedPanel();
}

async function deleteKnowledge() {
  if (!confirm('Remover todos os dados extraidos deste contato?')) return;
  try {
    await api('DELETE', '/knowledge/contact/' + currentInstance + '?remoteJid=' + encodeURIComponent(selectedGroup));
    toast('Dados removidos');
    await loadUnifiedPanel();
  } catch { toast('Erro ao remover', 'error'); }
}

// =====================
// TASKS PANEL
// =====================
let _taskCache = []; // cache for modal access

async function loadTasksPanel() {
  const body = document.getElementById('knowledgePanelBody');
  if (!body) return;
  body.innerHTML = '<div class="spinner" style="margin-top:40px"></div>';

  try {
    const res = await api('GET', '/knowledge/tasks/' + currentInstance + '?remoteJid=' + encodeURIComponent(selectedGroup));

    if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
      _taskCache = [];
      body.innerHTML = `
        <div class="knowledge-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="#ccc"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"/></svg>
          <p>Nenhuma tarefa encontrada.</p>
          <button class="btn btn-primary btn-sm" onclick="extractTasks()">Gerar tarefas com IA</button>
        </div>
      `;
      return;
    }

    _taskCache = res.data;
    body.innerHTML = '';

    const taskList = document.createElement('div');
    taskList.className = 'task-list';

    res.data.forEach(task => {
      const card = document.createElement('div');
      card.className = 'task-card';
      card.dataset.taskId = task.id;
      card.onclick = () => openTaskModal(task.id);

      const priorityColors = { alta: '#ef4444', media: '#f59e0b', baixa: '#3b82f6' };
      const color = priorityColors[task.priority] || '#9ca3af';
      const isNew = task.status === 'nova';

      card.innerHTML = `
        <div class="task-priority-bar" style="background:${color}"></div>
        <div class="task-card-body">
          <div class="task-card-row">
            <button class="task-complete-btn" onclick="event.stopPropagation();completeTask('${task.id}')" title="Concluir">
              <span class="task-check-circle"></span>
            </button>
            <div class="task-title">${escapeHtml(task.title)}</div>
            <button class="task-x-btn" onclick="event.stopPropagation();rejectTask('${task.id}')" title="Remover">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
          ${isNew ? '<div class="task-new-actions"><button class="task-accept-btn" onclick="event.stopPropagation();acceptTask(\'' + task.id + '\')">Aceitar</button><button class="task-reject-btn" onclick="event.stopPropagation();rejectTask(\'' + task.id + '\')">Recusar</button></div>' : ''}
        </div>
      `;
      taskList.appendChild(card);
    });

    body.appendChild(taskList);
  } catch {
    body.innerHTML = '<div class="knowledge-empty"><p>Erro ao carregar tarefas.</p><button class="btn btn-primary btn-sm" onclick="loadTasksPanel()">Tentar novamente</button></div>';
  }
}

function openTaskModal(taskId) {
  const task = _taskCache.find(t => t.id === taskId);
  if (!task) return;

  const priorityLabels = { alta: 'Alta', media: 'Media', baixa: 'Baixa' };
  const priorityColors = { alta: '#ef4444', media: '#f59e0b', baixa: '#3b82f6' };
  const statusLabels = { nova: 'Nova', pendente: 'Pendente', aceita: 'Aceita', concluida: 'Concluida', recusada: 'Recusada' };
  const color = priorityColors[task.priority] || '#9ca3af';
  const created = task.createdAt ? new Date(task.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const dueDate = task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'taskModal';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="task-modal" onclick="event.stopPropagation()">
      <div class="task-modal-accent" style="background:${color}"></div>
      <div class="task-modal-header">
        <div class="task-modal-header-left">
          <span class="task-modal-priority-badge" style="background:${color}15;color:${color}">${priorityLabels[task.priority] || task.priority}</span>
          <span class="task-modal-status-badge">${statusLabels[task.status] || task.status}</span>
        </div>
        <button class="task-modal-close" onclick="document.getElementById('taskModal').remove()">&times;</button>
      </div>
      <div class="task-modal-body">
        <div class="task-modal-field">
          <label>Titulo</label>
          <input type="text" id="taskModalTitle" value="${escapeHtml(task.title)}">
        </div>
        <div class="task-modal-field">
          <label>Descricao</label>
          <textarea id="taskModalDesc" rows="3" placeholder="Adicionar detalhes...">${escapeHtml(task.description || '')}</textarea>
        </div>
        <div class="task-modal-row">
          <div class="task-modal-field" style="flex:1">
            <label>Prioridade</label>
            <select id="taskModalPriority">
              <option value="baixa" ${task.priority === 'baixa' ? 'selected' : ''}>Baixa</option>
              <option value="media" ${task.priority === 'media' ? 'selected' : ''}>Media</option>
              <option value="alta" ${task.priority === 'alta' ? 'selected' : ''}>Alta</option>
            </select>
          </div>
          <div class="task-modal-field" style="flex:1">
            <label>Data limite</label>
            <input type="date" id="taskModalDueDate" value="${dueDate}">
          </div>
        </div>
        ${created ? '<div class="task-modal-meta">Criada em ' + created + '</div>' : ''}
      </div>
      <div class="task-modal-footer">
        <button class="task-modal-btn-danger" onclick="rejectTask('${task.id}');document.getElementById('taskModal').remove()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          Excluir
        </button>
        <div style="display:flex;gap:8px;margin-left:auto">
          <button class="task-modal-btn-secondary" onclick="completeTask('${task.id}')">Concluir</button>
          <button class="task-modal-btn-primary" onclick="saveTaskModal('${task.id}')">Salvar</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

async function saveTaskModal(taskId) {
  const title = document.getElementById('taskModalTitle').value.trim();
  const description = document.getElementById('taskModalDesc').value.trim();
  const priority = document.getElementById('taskModalPriority').value;
  const dueDate = document.getElementById('taskModalDueDate')?.value || null;
  if (!title) return toast('Titulo obrigatorio', 'error');

  try {
    await api('PUT', '/knowledge/task/' + currentInstance, { taskId, title, description, priority, dueDate });
    toast('Tarefa atualizada');
    const modal = document.getElementById('taskModal');
    if (modal) modal.remove();
    await loadUnifiedPanel();
  } catch { toast('Erro ao salvar', 'error'); }
}

async function acceptTask(taskId) {
  try {
    await api('PUT', '/knowledge/task/' + currentInstance, { taskId, status: 'aceita' });
    await loadUnifiedPanel();
  } catch { toast('Erro ao aceitar tarefa', 'error'); }
}

async function rejectTask(taskId) {
  try {
    await api('PUT', '/knowledge/task/' + currentInstance, { taskId, status: 'recusada' });
    const card = document.querySelector('.task-card[data-task-id="' + taskId + '"]');
    if (card) { card.style.opacity = '0'; card.style.transform = 'translateX(20px)'; setTimeout(() => { card.remove(); }, 200); }
  } catch { toast('Erro ao recusar tarefa', 'error'); }
}

async function completeTask(taskId) {
  try {
    await api('PUT', '/knowledge/task/' + currentInstance, { taskId, status: 'concluida' });
    toast('Tarefa concluida!');
    const modal = document.getElementById('taskModal');
    if (modal) modal.remove();
    await loadUnifiedPanel();
  } catch { toast('Erro ao concluir tarefa', 'error'); }
}

async function extractTasks() {
  const body = document.getElementById('knowledgePanelBody');
  if (body) body.innerHTML = '<div class="spinner" style="margin-top:40px"></div><p style="text-align:center;color:#888;margin-top:8px;font-size:12px">Analisando conversa...</p>';

  try {
    const res = await api('POST', '/knowledge/tasks/' + currentInstance, { remoteJid: selectedGroup });
    if (res.ok) toast('Tarefas atualizadas!');
    else toast('Falha ao gerar tarefas', 'error');
  } catch (err) { toast('Erro: ' + err.message, 'error'); }

  await loadUnifiedPanel();
}

function showCreateTaskModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'createTaskModal';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="task-modal" onclick="event.stopPropagation()">
      <div class="task-modal-accent" style="background:var(--accent)"></div>
      <div class="task-modal-header">
        <div class="task-modal-header-left">
          <span class="task-modal-priority-badge" style="background:rgba(0,209,102,0.1);color:var(--accent)">Nova tarefa</span>
        </div>
        <button class="task-modal-close" onclick="document.getElementById('createTaskModal').remove()">&times;</button>
      </div>
      <div class="task-modal-body">
        <div class="task-modal-field">
          <label>Titulo</label>
          <input type="text" id="newTaskTitle" placeholder="Ex: Enviar proposta comercial">
        </div>
        <div class="task-modal-field">
          <label>Descricao</label>
          <textarea id="newTaskDesc" rows="3" placeholder="Detalhes e contexto..."></textarea>
        </div>
        <div class="task-modal-row">
          <div class="task-modal-field" style="flex:1">
            <label>Prioridade</label>
            <select id="newTaskPriority">
              <option value="alta">Alta</option>
              <option value="media" selected>Media</option>
              <option value="baixa">Baixa</option>
            </select>
          </div>
          <div class="task-modal-field" style="flex:1">
            <label>Data limite</label>
            <input type="date" id="newTaskDueDate">
          </div>
        </div>
      </div>
      <div class="task-modal-footer">
        <div style="margin-left:auto">
          <button class="task-modal-btn-primary" onclick="submitCreateTask()">Criar tarefa</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('newTaskTitle').focus();
}

async function submitCreateTask() {
  const title = document.getElementById('newTaskTitle').value.trim();
  if (!title) return toast('Titulo e obrigatorio', 'error');

  const body = {
    remoteJid: selectedGroup,
    title,
    description: document.getElementById('newTaskDesc').value.trim() || undefined,
    priority: document.getElementById('newTaskPriority').value,
    dueDate: document.getElementById('newTaskDueDate').value || undefined,
  };

  try {
    const res = await api('POST', '/knowledge/task/' + currentInstance, body);
    if (res.ok) {
      toast('Tarefa criada!');
      document.getElementById('createTaskModal').remove();
      await loadUnifiedPanel();
    } else {
      toast('Erro ao criar tarefa', 'error');
    }
  } catch { toast('Erro ao criar tarefa', 'error'); }
}

// =====================
// SAVE CONTACT
// =====================
function openSaveContactModal() {
  if (!selectedGroup || !selectedGroupData) return;

  const phone = selectedGroupData.phone || selectedGroup.split('@')[0];
  const pushName = selectedGroupData.pushName || contactNames[selectedGroup] || '';

  // Split pushName into first/last name as suggestion
  const parts = pushName.trim().split(/\s+/);
  const suggestFirst = parts[0] || '';
  const suggestLast = parts.slice(1).join(' ') || '';

  // Check if already saved
  const savedName = contactNames[selectedGroup] || '';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'saveContactModal';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="modal-box" style="width:360px" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h3 style="font-size:15px;font-weight:700">Salvar Contato</h3>
        <button onclick="document.getElementById('saveContactModal').remove()" style="border:none;background:none;font-size:20px;cursor:pointer;color:#999">&times;</button>
      </div>
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:13px;color:var(--text-muted)">${escapeHtml(formatPhone(phone))}</div>
      </div>
      <div class="form-group">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted)">Nome</label>
        <input type="text" id="contactFirstName" value="${escapeHtml(suggestFirst)}" placeholder="Nome" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px">
      </div>
      <div class="form-group" style="margin-top:10px">
        <label style="font-size:11px;font-weight:600;color:var(--text-muted)">Sobrenome</label>
        <input type="text" id="contactLastName" value="${escapeHtml(suggestLast)}" placeholder="Sobrenome" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px">
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button onclick="document.getElementById('saveContactModal').remove()" class="btn btn-secondary btn-sm" style="flex:1">Cancelar</button>
        <button onclick="saveContact()" class="btn btn-primary btn-sm" style="flex:1">Salvar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.getElementById('contactFirstName').focus();
}

async function saveContact() {
  const firstName = (document.getElementById('contactFirstName').value || '').trim();
  const lastName = (document.getElementById('contactLastName').value || '').trim();

  if (!firstName) return toast('Nome obrigatorio', 'error');

  const fullName = lastName ? firstName + ' ' + lastName : firstName;

  // Save locally in contactNames
  contactNames[selectedGroup] = fullName;
  if (selectedGroupData) selectedGroupData.pushName = fullName;

  // Update header — show name as title, phone as subtitle
  const nameEl = document.querySelector('.chat-messages-header .chat-name');
  const subtitleEl = document.getElementById('chatHeaderSubtitle');
  if (nameEl) nameEl.textContent = fullName;
  if (subtitleEl) {
    const phone = selectedGroupData?.phone || selectedGroup.split('@')[0];
    subtitleEl.textContent = /^\d{10,15}$/.test(phone) ? formatPhone(phone) : phone;
  }

  // Update chat list item
  const chatRef = allChats.find(c => c.id === selectedGroup);
  if (chatRef) { chatRef.pushName = fullName; renderGroupList(); }

  // Close modal
  const modal = document.getElementById('saveContactModal');
  if (modal) modal.remove();

  toast('Contato salvo: ' + fullName);

  // Persist to database
  api('PUT', '/knowledge/contact-name/' + currentInstance, {
    remoteJid: selectedGroup,
    name: fullName
  }).catch(() => {});
}

// =====================
// GROUP INFO & PINNED MESSAGES
// =====================
async function loadGroupInfo() {
  const body = document.getElementById('panelBody');
  if (!body) return;
  body.innerHTML = '<div class="spinner" style="margin-top:40px"></div>';

  let desc = '';
  try {
    const res = await api('GET', '/group/findGroupInfos/' + currentInstance + '?groupJid=' + encodeURIComponent(selectedGroup));
    if (res.ok && res.data) {
      desc = res.data.desc || '';
    }
  } catch {}

  const pinKey = 'pin_' + selectedGroup;
  const pinned = localStorage.getItem(pinKey) || '';

  body.innerHTML = '';

  const descSection = document.createElement('div');
  descSection.className = 'gp-info-section';
  descSection.innerHTML = `
    <div class="gp-info-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      <span>Descricao</span>
    </div>
    <textarea id="groupDescInput" class="gp-textarea" placeholder="Sem descricao">${escapeHtml(desc)}</textarea>
    <button class="gp-save-btn" onclick="saveGroupDescription()">Salvar</button>
  `;
  body.appendChild(descSection);

  const pinSection = document.createElement('div');
  pinSection.className = 'gp-info-section';
  pinSection.innerHTML = `
    <div class="gp-info-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2"><path d="M12 2L12 22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      <span>Mensagem fixada</span>
    </div>
    <textarea id="pinnedMsgInput" class="gp-textarea" placeholder="Nenhuma mensagem fixada">${escapeHtml(pinned)}</textarea>
    <div class="gp-info-btns">
      <button class="gp-save-btn" onclick="savePinnedMessage()">Fixar</button>
      <button class="gp-secondary-btn" onclick="clearPinnedMessage()">Remover</button>
    </div>
  `;
  body.appendChild(pinSection);

  renderPinnedBanner();
}

async function saveGroupDescription() {
  const desc = document.getElementById('groupDescInput')?.value || '';
  toast('Salvando descricao...');
  const res = await api('POST', '/group/updateGroupDescription/' + currentInstance, {
    groupJid: selectedGroup,
    description: desc
  });
  if (res.ok) toast('Descricao atualizada!');
  else toast('Erro ao atualizar descricao', 'error');
}

function savePinnedMessage() {
  const text = document.getElementById('pinnedMsgInput')?.value || '';
  if (!text.trim()) return toast('Digite uma mensagem para fixar', 'error');
  localStorage.setItem('pin_' + selectedGroup, text);
  toast('Mensagem fixada!');
  renderPinnedBanner();
}

function clearPinnedMessage() {
  localStorage.removeItem('pin_' + selectedGroup);
  document.getElementById('pinnedMsgInput').value = '';
  toast('Mensagem removida');
  renderPinnedBanner();
}

function renderPinnedBanner() {
  document.getElementById('pinnedBanner')?.remove();
  const pinned = localStorage.getItem('pin_' + selectedGroup);
  if (!pinned) return;

  const container = document.querySelector('.chat-messages-area');
  const msgContainer = document.getElementById('msgContainer');
  if (!container || !msgContainer) return;

  const banner = document.createElement('div');
  banner.id = 'pinnedBanner';
  banner.className = 'pinned-banner';
  banner.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#54656f"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6h2v-6h5v-2z"/></svg><span>' + escapeHtml(pinned) + '</span><button onclick="clearPinnedMessage()" title="Remover">&times;</button>';
  container.insertBefore(banner, msgContainer);
}

// =====================
// PARTICIPANTS
// =====================
async function fetchParticipants() {
  if (!selectedGroup || !currentInstance) return [];
  let res = await api('GET', '/group/participants/' + currentInstance + '?groupJid=' + encodeURIComponent(selectedGroup));

  if (!res.ok) {
    await new Promise(r => setTimeout(r, 1500));
    res = await api('GET', '/group/participants/' + currentInstance + '?groupJid=' + encodeURIComponent(selectedGroup));
  }

  const rd = res.ok ? res.data : null;
  let participants = Array.isArray(rd) ? rd : (rd?.participants || []);

  if (participants.length === 0 && res.ok) {
    const fallback = await api('GET', '/group/fetchAllGroups/' + currentInstance + '?getParticipants=true');
    if (fallback.ok && Array.isArray(fallback.data)) {
      const thisGroup = fallback.data.find(g => g.id === selectedGroup);
      if (thisGroup && Array.isArray(thisGroup.participants)) {
        participants = thisGroup.participants;
      }
    }
  }

  return participants;
}

async function loadParticipants() {
  if (!selectedGroup || !currentInstance) return;
  const body = document.getElementById('panelBody');
  if (!body) return;
  body.innerHTML = '<div class="spinner" style="margin-top:40px"></div>';

  const participants = await fetchParticipants();

  body.innerHTML = '';

  // Count badge
  const countBadge = document.createElement('div');
  countBadge.className = 'gp-count';
  countBadge.innerHTML = `
    <span>${participants.length} membro${participants.length !== 1 ? 's' : ''}</span>
  `;
  body.appendChild(countBadge);

  // Search
  const search = document.createElement('div');
  search.className = 'gp-search-wrap';
  search.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input type="text" id="panelSearchInput" placeholder="Buscar..." oninput="filterParticipants()">
  `;
  body.appendChild(search);

  // Add member row
  const addRow = document.createElement('div');
  addRow.className = 'gp-add-row';
  addRow.innerHTML = `
    <input type="text" id="panelAddInput" placeholder="5511999999999" onkeydown="if(event.key==='Enter'){event.preventDefault();addMember()}">
    <button class="gp-add-btn" onclick="addMember()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
    </button>
  `;
  body.appendChild(addRow);

  if (participants.length === 0) {
    body.innerHTML += '<div style="padding:20px;text-align:center;color:#667781;font-size:13px">Nao foi possivel carregar participantes.</div>';
    return;
  }

  const list = document.createElement('div');
  list.id = 'panelMemberList';
  list.className = 'gp-members';

  const sortedP = [...participants].sort((a, b) => {
    const order = { superadmin: 0, admin: 1 };
    return (order[a.admin] ?? 2) - (order[b.admin] ?? 2);
  });

  sortedP.forEach(p => {
    const jid = p.id || String(p);
    const phoneRaw = p.phoneNumber ? String(p.phoneNumber).split('@')[0] : String(jid).split('@')[0];
    const phoneFormatted = formatPhone(phoneRaw);
    const apiName = p.pushName || p.name || p.notify || p.verifiedName || '';
    if (apiName && !contactNames[String(jid)]) contactNames[String(jid)] = apiName;
    const displayName = contactNames[String(jid)] || '';

    const isAdmin = p.admin === 'admin' || p.admin === 'superadmin';
    const isSuperAdmin = p.admin === 'superadmin';
    const initials = (displayName || phoneRaw).charAt(0).toUpperCase();
    const avatarColor = isSuperAdmin ? '#6366f1' : isAdmin ? '#10b981' : '#94a3b8';

    const el = document.createElement('div');
    el.className = 'gp-member';
    el.dataset.search = (displayName + ' ' + phoneFormatted + ' ' + phoneRaw).toLowerCase();
    el.innerHTML = `
      <div class="gp-member-avatar" style="background:${avatarColor}">${initials}</div>
      <div class="gp-member-info">
        <div class="gp-member-name">
          ${escapeHtml(displayName || phoneFormatted)}
          ${isSuperAdmin ? '<span class="gp-badge gp-badge-owner">Criador</span>' : isAdmin ? '<span class="gp-badge gp-badge-admin">Admin</span>' : ''}
        </div>
        <div class="gp-member-phone">${displayName ? escapeHtml(phoneFormatted) : 'Membro'}</div>
      </div>
      <div class="gp-member-actions">
        <button class="gp-member-btn gp-btn-graph" title="Ver perfil" onclick="event.stopPropagation(); openParticipantGraph('${escapeHtml(jid)}', '${escapeHtml(displayName || phoneFormatted)}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2L8.6 6.6 4 8l4.6 1.4L10 14l1.4-4.6L16 8l-4.6-1.4L10 2z"/></svg>
        </button>
        ${!isSuperAdmin ? '<button class="gp-member-btn gp-btn-remove" onclick="event.stopPropagation(); removeMember(\'' + escapeHtml(phoneRaw) + '\')" title="Remover"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' : ''}
      </div>
    `;
    el.style.cursor = 'pointer';
    el.onclick = (e) => {
      if (e.target.closest('.gp-member-btn')) return;
      openParticipantGraph(jid, displayName || phoneFormatted);
    };
    list.appendChild(el);
  });
  body.appendChild(list);
}

function filterParticipants() {
  const query = (document.getElementById('panelSearchInput')?.value || '').toLowerCase().trim();
  const members = document.querySelectorAll('#panelMemberList .gp-member');
  members.forEach(el => {
    el.style.display = !query || el.dataset.search.includes(query) ? '' : 'none';
  });
}

async function addMember() {
  const input = document.getElementById('panelAddInput');
  const num = input.value.trim().replace(/[^0-9+]/g, '').replace(/^\+/, '');
  if (!num || num.length < 10) return toast('Numero invalido (use DDI+DDD+numero, ex: 5511999999999)', 'error');
  input.value = '';

  toast('Verificando numero...');
  const check = await api('POST', '/chat/whatsappNumbers/' + currentInstance, { numbers: [num] });
  let jidToAdd = num;
  if (check.ok && Array.isArray(check.data)) {
    const found = check.data.find(n => n.exists === true || n.exists === 'true');
    if (!found) {
      toast('Numero ' + num + ' nao esta no WhatsApp', 'error');
      return;
    }
    if (found.jid) jidToAdd = found.jid;
  }

  toast('Adicionando...');
  const res = await api('POST', '/group/updateParticipant/' + currentInstance, {
    groupJid: selectedGroup,
    action: 'add',
    participants: [jidToAdd]
  });

  if (res.ok) {
    const results = res.data?.updateParticipants || res.data || [];
    const failed = Array.isArray(results) ? results.filter(r => r.status && String(r.status) !== '200') : [];
    if (failed.length > 0) {
      const needsInvite = failed.some(r => String(r.status) === '408' || String(r.status) === '403');
      if (needsInvite) {
        toast('Privacidade nao permite add direto. Enviando convite...');
        const invRes = await api('POST', '/group/sendInvite/' + currentInstance, {
          groupJid: selectedGroup,
          description: 'Convite para o grupo',
          numbers: [num]
        });
        if (invRes.ok) {
          toast('Convite enviado por mensagem!');
        } else {
          toast('Erro ao enviar convite', 'error');
        }
      } else {
        const statusCodes = { '409': 'ja esta no grupo', '500': 'erro interno' };
        const statusInfo = failed.map(r => statusCodes[String(r.status)] || 'erro ' + r.status).join(', ');
        toast('Nao foi possivel adicionar: ' + statusInfo, 'error');
      }
    } else {
      toast('Participante adicionado!');
    }
    loadParticipants();
  } else {
    const errMsg = res.data?.response?.message?.[0] || res.data?.message || 'Erro ao adicionar';
    toast(String(errMsg), 'error');
  }
}

async function removeMember(number) {
  toast('Removendo...');
  const res = await api('POST', '/group/updateParticipant/' + currentInstance, {
    groupJid: selectedGroup,
    action: 'remove',
    participants: [number]
  });

  if (res.ok) {
    toast('Participante removido!');
    loadParticipants();
  } else {
    toast('Erro ao remover', 'error');
  }
}
