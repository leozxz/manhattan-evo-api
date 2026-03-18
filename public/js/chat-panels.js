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
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
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
  showKnowledgePanel = !showKnowledgePanel;
  const panel = document.getElementById('knowledgePanel');
  if (!panel) return;
  panel.style.display = showKnowledgePanel ? 'flex' : 'none';
  if (showKnowledgePanel) loadKnowledgePanel();
}

async function loadKnowledgePanel() {
  const body = document.getElementById('knowledgePanelBody');
  if (!body) return;
  body.innerHTML = '<div class="spinner" style="margin-top:40px"></div>';

  try {
    const res = await api('GET', '/knowledge/contact/' + currentInstance + '?remoteJid=' + encodeURIComponent(selectedGroup));
    console.log('[Knowledge] GET contact response:', res.status, JSON.stringify(res.data));

    if (!res.ok || !res.data) {
      body.innerHTML = `
        <div class="knowledge-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="#ccc"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          <p>Nenhuma informacao extraida ainda.</p>
          <button class="btn btn-primary btn-sm" onclick="forceKnowledgeExtraction()">Analisar mensagens</button>
        </div>
      `;
      return;
    }

    const data = res.data;
    body.innerHTML = '';

    if (data.summary) {
      const summaryEl = document.createElement('div');
      summaryEl.className = 'knowledge-section';
      summaryEl.innerHTML = `
        <div class="knowledge-summary">${escapeHtml(data.summary)}</div>
      `;
      body.appendChild(summaryEl);
    }

    const grouped = {};
    (data.entities || []).forEach(e => {
      if (!grouped[e.category]) grouped[e.category] = [];
      grouped[e.category].push(e);
    });

    for (const [cat, entities] of Object.entries(grouped)) {
      const catInfo = KNOWLEDGE_CATEGORIES[cat] || { label: cat };
      const section = document.createElement('div');
      section.className = 'knowledge-section';
      section.innerHTML = `
        <div class="knowledge-category-header">
          <span>${catInfo.label}</span>
        </div>
        <div class="knowledge-entities">
          ${entities.map(e => `
            <div class="knowledge-entity">
              <span class="knowledge-entity-label">${escapeHtml(e.label)}</span>
              <span class="knowledge-entity-value">${escapeHtml(e.value || '')}</span>
            </div>
          `).join('')}
        </div>
      `;
      body.appendChild(section);
    }

    if (data.relationships && data.relationships.length > 0) {
      const relSection = document.createElement('div');
      relSection.className = 'knowledge-section';
      relSection.innerHTML = `
        <div class="knowledge-category-header">
          <span>Relacionamentos</span>
        </div>
        <div class="knowledge-entities">
          ${data.relationships.map(r => `
            <div class="knowledge-entity">
              <span class="knowledge-entity-label">${escapeHtml(r.fromEntity?.label || '?')} → ${escapeHtml(r.toEntity?.label || '?')}</span>
              <span class="knowledge-entity-value">${escapeHtml(r.type)}${r.description ? ' - ' + escapeHtml(r.description) : ''}</span>
            </div>
          `).join('')}
        </div>
      `;
      body.appendChild(relSection);
    }

    const actions = document.createElement('div');
    actions.className = 'knowledge-actions';
    actions.innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="forceKnowledgeExtraction()" style="width:100%">Reanalisar mensagens</button>
      <button class="btn btn-secondary btn-sm" onclick="deleteKnowledge()" style="width:100%;margin-top:6px">Limpar dados</button>
    `;
    body.appendChild(actions);
  } catch (err) {
    body.innerHTML = `
      <div class="knowledge-empty">
        <p>Erro ao carregar dados.</p>
        <button class="btn btn-primary btn-sm" onclick="loadKnowledgePanel()">Tentar novamente</button>
      </div>
    `;
  }
}

async function forceKnowledgeExtraction() {
  const body = document.getElementById('knowledgePanelBody');
  if (body) body.innerHTML = '<div class="spinner" style="margin-top:40px"></div><p style="text-align:center;color:#888;margin-top:8px;font-size:12px">Analisando mensagens com IA...</p>';

  try {
    const res = await api('POST', '/knowledge/extract/' + currentInstance, {
      remoteJid: selectedGroup,
      messageCount: 50
    });

    console.log('[Knowledge] Extract response:', res.status, JSON.stringify(res.data));

    if (res.ok) {
      toast('Analise concluida!', 'success');
    } else {
      console.error('[Knowledge] Extract failed:', res.status, res.data);
      toast('Falha na analise (HTTP ' + res.status + '): ' + (res.data?.error || res.data?.message || JSON.stringify(res.data)), 'error');
    }
  } catch (err) {
    console.error('[Knowledge] Extract error:', err);
    toast('Erro na analise: ' + err.message, 'error');
  }

  await loadKnowledgePanel();
}

async function deleteKnowledge() {
  if (!confirm('Remover todos os dados extraidos deste contato?')) return;

  try {
    await api('DELETE', '/knowledge/contact/' + currentInstance + '?remoteJid=' + encodeURIComponent(selectedGroup));
    toast('Dados removidos', 'success');
    await loadKnowledgePanel();
  } catch {
    toast('Erro ao remover', 'error');
  }
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
  descSection.className = 'panel-info-section';
  descSection.innerHTML = `
    <div class="panel-info-label">Descricao do grupo</div>
    <textarea id="groupDescInput" class="panel-info-textarea" placeholder="Sem descricao">${escapeHtml(desc)}</textarea>
    <button class="btn btn-primary btn-sm panel-info-save" onclick="saveGroupDescription()">Salvar descricao</button>
  `;
  body.appendChild(descSection);

  const pinSection = document.createElement('div');
  pinSection.className = 'panel-info-section';
  pinSection.innerHTML = `
    <div class="panel-info-label">Mensagem fixada</div>
    <textarea id="pinnedMsgInput" class="panel-info-textarea" placeholder="Nenhuma mensagem fixada">${escapeHtml(pinned)}</textarea>
    <div class="panel-info-actions">
      <button class="btn btn-primary btn-sm" onclick="savePinnedMessage()">Fixar</button>
      <button class="btn btn-secondary btn-sm" onclick="clearPinnedMessage()">Remover</button>
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

  const header = document.createElement('div');
  header.className = 'panel-fixed-header';
  header.innerHTML = `
    <div class="panel-header-top">
      <span class="panel-member-count">${participants.length} membro${participants.length !== 1 ? 's' : ''}</span>
      <div class="panel-add-row">
        <input type="text" id="panelAddInput" placeholder="5511999999999" onkeydown="if(event.key==='Enter'){event.preventDefault();addMember()}">
        <button class="btn btn-primary btn-sm" onclick="addMember()">Add</button>
      </div>
    </div>
    <input type="text" id="panelSearchInput" class="panel-search-input" placeholder="Buscar participante..." oninput="filterParticipants()">
  `;
  body.appendChild(header);

  if (participants.length === 0) {
    body.innerHTML += '<div style="padding:20px;text-align:center;color:#667781;font-size:13px">Nao foi possivel carregar participantes. Tente novamente.</div>';
    return;
  }

  const list = document.createElement('div');
  list.id = 'panelMemberList';
  list.className = 'panel-member-list';

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

    const el = document.createElement('div');
    el.className = 'panel-member';
    el.dataset.search = (displayName + ' ' + phoneFormatted + ' ' + phoneRaw).toLowerCase();
    el.innerHTML = `
      <div class="panel-member-avatar" style="background:${isSuperAdmin ? '#128c7e' : isAdmin ? '#25d366' : '#dfe5e7'}">
        <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
      </div>
      <div class="panel-member-info">
        <div class="panel-member-name">${escapeHtml(displayName || phoneFormatted)}${isSuperAdmin ? ' <span class="panel-badge badge-owner">Criador</span>' : isAdmin ? ' <span class="panel-badge badge-admin">Admin</span>' : ''}</div>
        <div class="panel-member-role">${displayName ? escapeHtml(phoneFormatted) : 'Membro'}</div>
      </div>
      ${!isSuperAdmin ? '<button class="panel-member-remove" onclick="removeMember(\'' + escapeHtml(phoneRaw) + '\')" title="Remover">&times;</button>' : ''}
    `;
    list.appendChild(el);
  });
  body.appendChild(list);
}

function filterParticipants() {
  const query = (document.getElementById('panelSearchInput')?.value || '').toLowerCase().trim();
  const members = document.querySelectorAll('#panelMemberList .panel-member');
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
