// =====================
// CHAT
// =====================
let groupLastMsg = {}; // chatId -> timestamp of last message
try { groupLastMsg = JSON.parse(localStorage.getItem('groupLastMsg') || '{}'); } catch {}
let showPanel = false;
let chatFilter = 'all'; // 'all', 'groups', 'private'
let allChats = []; // unified list: groups + individual chats

function isGroupJid(jid) { return jid && jid.endsWith('@g.us'); }
function isPrivateJid(jid) { return jid && jid.endsWith('@s.whatsapp.net'); }

function setChatFilter(filter) {
  chatFilter = filter;
  document.querySelectorAll('.chat-filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === filter));
  renderGroupList();
}

async function loadGroups() {
  if (!currentInstance) return;

  const list = document.getElementById('groupList');
  const cacheKey = 'chats_' + currentInstance;
  const instanceAtStart = currentInstance;

  // Show cached data while fetching
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      allChats = JSON.parse(cached);
      groups = allChats.filter(c => isGroupJid(c.id));
      renderGroupList();
    } catch {}
  } else {
    allChats = [];
    groups = [];
    list.innerHTML = '<div style="padding:24px;text-align:center;color:#667781">Carregando conversas...</div>';
  }

  // Fetch all chats (groups + individual) from findChats
  const [chatsRes, groupsRes] = await Promise.all([
    api('POST', '/chat/findChats/' + currentInstance, {}),
    api('GET', '/group/fetchAllGroups/' + currentInstance + '?getParticipants=false')
  ]);

  if (currentInstance !== instanceAtStart) return;

  // Build group metadata map from fetchAllGroups (has subject, size)
  const groupMeta = {};
  if (groupsRes.ok && Array.isArray(groupsRes.data)) {
    groupsRes.data.forEach(g => { groupMeta[g.id] = g; });
  }

  // Process findChats response
  const chatData = chatsRes.ok && Array.isArray(chatsRes.data) ? chatsRes.data : [];

  // Build unified chat list
  const chatMap = {};
  chatData.forEach(c => {
    const jid = c.remoteJid;
    if (!jid || jid === 'status@broadcast' || jid === '0@s.whatsapp.net') return;
    const lastTs = c.lastMessage?.messageTimestamp || 0;
    const gm = groupMeta[jid];

    // For private chats, try to get name from lastMessage.pushName (findChats often has null pushName for private)
    let resolvedName = c.pushName || '';
    if (!resolvedName && c.lastMessage?.pushName && !c.lastMessage.key?.fromMe) {
      resolvedName = c.lastMessage.pushName;
    }

    chatMap[jid] = {
      id: jid,
      isGroup: isGroupJid(jid),
      subject: gm?.subject || resolvedName || '',
      pushName: resolvedName || '',
      size: gm?.size || 0,
      profilePicUrl: c.profilePicUrl || null,
      lastMessageTs: typeof lastTs === 'string' ? parseInt(lastTs) : lastTs,
      unreadCount: c.unreadCount || 0
    };

    // Store contact name
    if (resolvedName && !contactNames[jid]) contactNames[jid] = resolvedName;
    if (lastTs > (groupLastMsg[jid] || 0)) groupLastMsg[jid] = typeof lastTs === 'string' ? parseInt(lastTs) : lastTs;
  });

  // Ensure all groups from fetchAllGroups are included (even if no recent chat)
  Object.values(groupMeta).forEach(g => {
    if (!chatMap[g.id]) {
      chatMap[g.id] = {
        id: g.id,
        isGroup: true,
        subject: g.subject || '',
        pushName: '',
        size: g.size || 0,
        profilePicUrl: null,
        lastMessageTs: groupLastMsg[g.id] || 0,
        unreadCount: 0
      };
    }
  });

  allChats = Object.values(chatMap);
  groups = allChats.filter(c => c.isGroup);

  if (allChats.length === 0) {
    list.innerHTML = '<div class="no-groups"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg><p>' + (chatsRes.ok ? 'Nenhuma conversa encontrada' : 'Erro ao carregar conversas') + '</p></div>';
    return;
  }

  try { localStorage.setItem(cacheKey, JSON.stringify(allChats)); } catch {}
  saveGroupTimestamps();
  renderGroupList();
}

function saveGroupTimestamps() {
  try { localStorage.setItem('groupLastMsg', JSON.stringify(groupLastMsg)); } catch {}
}

async function fetchGroupTimestamps(groupList) {
  // Fetch last message timestamp for each group (in batches to avoid overload)
  const toFetch = groupList.filter(g => !groupLastMsg[g.id]);
  if (toFetch.length === 0) return;

  const batchSize = 5;
  let changed = false;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(g =>
      api('POST', '/chat/findMessages/' + currentInstance, {
        where: { key: { remoteJid: g.id } },
        offset: 1,
        page: 1
      }).then(res => ({ id: g.id, res })).catch(() => ({ id: g.id, res: null }))
    ));

    results.forEach(({ id, res }) => {
      if (!res || !res.ok) return;
      const msgs = extractMessages(res.data);
      if (msgs.length === 0) return;
      // Find the most recent timestamp
      let maxTs = 0;
      msgs.forEach(m => {
        const ts = typeof m.messageTimestamp === 'string' ? parseInt(m.messageTimestamp) : (m.messageTimestamp || 0);
        if (ts > maxTs) maxTs = ts;
      });
      if (maxTs > (groupLastMsg[id] || 0)) {
        groupLastMsg[id] = maxTs;
        changed = true;
      }
    });

    if (changed) {
      saveGroupTimestamps();
      renderGroupList();
    }
  }
}

function renderGroupList() {
  const list = document.getElementById('groupList');
  if (!list) return;

  // Filter based on active tab
  let filtered = allChats;
  if (chatFilter === 'groups') filtered = allChats.filter(c => c.isGroup);
  else if (chatFilter === 'private') filtered = allChats.filter(c => !c.isGroup);

  // Sort: ones with recent messages first, then by name
  const sorted = [...filtered].sort((a, b) => {
    const tsA = groupLastMsg[a.id] || a.lastMessageTs || 0;
    const tsB = groupLastMsg[b.id] || b.lastMessageTs || 0;
    if (tsB !== tsA) return tsB - tsA;
    const nameA = a.subject || a.pushName || a.id;
    const nameB = b.subject || b.pushName || b.id;
    return nameA.localeCompare(nameB);
  });

  list.innerHTML = '';
  if (sorted.length === 0) {
    const labels = { all: 'Nenhuma conversa', groups: 'Nenhum grupo', private: 'Nenhuma conversa individual' };
    list.innerHTML = '<div style="padding:24px;text-align:center;color:#667781;font-size:13px">' + labels[chatFilter] + '</div>';
    return;
  }

  sorted.forEach(c => {
    const item = document.createElement('div');
    item.className = 'chat-item' + (selectedGroup === c.id ? ' active' : '');
    item.onclick = () => { selectGroup(c, item); };
    const lastTs = groupLastMsg[c.id] || c.lastMessageTs;
    const timeStr = lastTs ? new Date(lastTs < 1e12 ? lastTs * 1000 : lastTs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

    // Different avatar and info for groups vs individual
    let avatarSvg, displayName, subtitle;
    if (c.isGroup) {
      avatarSvg = '<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>';
      displayName = c.subject || c.id;
      subtitle = (c.size || '?') + ' participantes';
    } else {
      avatarSvg = '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
      const phone = c.id.split('@')[0];
      displayName = c.pushName || contactNames[c.id] || formatPhone(phone);
      subtitle = c.pushName ? formatPhone(phone) : '';
    }

    const unreadBadge = c.unreadCount > 0 ? '<span class="chat-unread-badge">' + c.unreadCount + '</span>' : '';

    item.innerHTML = `
      <div class="chat-avatar${c.isGroup ? '' : ' chat-avatar-private'}">
        ${avatarSvg}
      </div>
      <div class="chat-info">
        <div class="chat-name">${escapeHtml(displayName)}</div>
        <div class="chat-preview">${escapeHtml(subtitle)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        ${timeStr ? '<span style="font-size:11px;color:#667781">' + timeStr + '</span>' : ''}
        ${unreadBadge}
      </div>
    `;
    list.appendChild(item);
  });
}

async function selectGroup(chat, el) {
  selectedGroup = chat.id;
  selectedGroupData = chat;
  showPanel = false;
  mediaCacheClear();
  cancelReply();
  closeMentionDropdown();

  const isGroup = isGroupJid(chat.id);

  document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');

  // Mobile: open chat view
  const layout = document.querySelector('.chat-layout');
  if (layout) layout.classList.add('chat-open');

  // Resolve display name for individual chats
  let displayName;
  let avatarSvg;
  if (isGroup) {
    displayName = chat.subject || chat.id;
    avatarSvg = '<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3z"/></svg>';
  } else {
    const phone = chat.id.split('@')[0];
    displayName = chat.pushName || contactNames[chat.id] || formatPhone(phone);
    avatarSvg = '<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  }

  const panelBtn = isGroup ? `
          <button class="btn btn-secondary btn-sm" onclick="togglePanel()" title="Ver participantes" style="margin-left:8px">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#54656f"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
          </button>` : '';

  const area = document.getElementById('chatArea');
  area.innerHTML = `
    <div class="chat-with-panel">
      <div class="chat-main">
        <div class="chat-messages-header">
          <button class="mobile-back-btn" onclick="closeMobileChat()" title="Voltar">
            <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
          </button>
          <div class="chat-avatar${isGroup ? '' : ' chat-avatar-private'}" style="width:36px;height:36px">
            ${avatarSvg}
          </div>
          <div class="chat-name" style="cursor:pointer" ${isGroup ? 'onclick="togglePanel()"' : ''}>${escapeHtml(displayName)}</div>
          <div class="header-spacer"></div>
          <div class="polling-indicator"><div class="polling-dot"></div> ao vivo</div>
          ${panelBtn}
        </div>
        <div class="chat-messages" id="msgContainer">
          <div class="spinner" style="margin:auto"></div>
        </div>
        <div class="chat-input">
          <div class="mention-dropdown" id="mentionDropdown"></div>
          <div class="attach-menu" id="attachMenu">
            <button class="attach-item" onclick="pickMedia('image')">
              <svg viewBox="0 0 24 24" fill="#25d366"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
              Imagem
            </button>
            <button class="attach-item" onclick="pickMedia('video')">
              <svg viewBox="0 0 24 24" fill="#7c3aed"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              Video
            </button>
            <button class="attach-item" onclick="pickMedia('document')">
              <svg viewBox="0 0 24 24" fill="#ea580c"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
              Documento
            </button>
            <button class="attach-item" onclick="pickMedia('audio')">
              <svg viewBox="0 0 24 24" fill="#0891b2"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
              Audio
            </button>
            <button class="attach-item" onclick="showLocationModal()">
              <svg viewBox="0 0 24 24" fill="#dc2626"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
              Localizacao
            </button>
          </div>
          <div class="audio-panel" id="audioPanel"></div>
          <input type="file" id="mediaFileInput" style="display:none" onchange="handleMediaFile(this)">
          <button class="btn btn-secondary" onclick="toggleAttachMenu()" style="border-radius:50%;width:40px;height:40px;padding:0;flex-shrink:0" title="Anexar arquivo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#54656f"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
          </button>
          <button class="btn btn-secondary" onclick="toggleAudioPanel()" style="border-radius:50%;width:40px;height:40px;padding:0;flex-shrink:0" title="Audios salvos">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#54656f"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-6 11c-1.66 0-3-1.34-3-3V5c0-1.66 1.34-3 3-3s3 1.34 3 3v5c0 1.66-1.34 3-3 3zm4.3-3c0 2.5-2.12 4.26-4.3 4.26S9.7 12.5 9.7 10H8.4c0 2.86 2.28 5.21 5.1 5.63V19h1v-3.37c2.82-.42 5.1-2.77 5.1-5.63H18.3z"/></svg>
          </button>
          <input type="text" id="msgInput" placeholder="Digite uma mensagem... (@mencionar)" onkeydown="handleMsgKeydown(event)" oninput="handleMentionInput(this)">
          <div class="recording-bar" id="recordingBar" style="display:none">
            <div class="recording-dot"></div>
            <span class="recording-timer" id="recordingTimer">0:00</span>
            <button class="recording-cancel" onclick="cancelRecording()">Cancelar</button>
          </div>
          <button class="record-btn" id="recordBtn" onclick="toggleRecording()" title="Gravar audio">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#54656f"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
          </button>
          <button class="btn btn-primary" id="sendBtn" onclick="sendMsg()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>
      ${isGroup ? `<div class="group-panel" id="groupPanel" style="display:none">
        <div class="group-panel-header">
          <div class="panel-tabs">
            <button class="panel-tab active" data-tab="participants" onclick="switchPanelTab('participants')">Participantes</button>
            <button class="panel-tab" data-tab="info" onclick="switchPanelTab('info')">Info</button>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="togglePanel()">&times;</button>
        </div>
        <div class="group-panel-body" id="panelBody">
          <div class="spinner" style="margin-top:40px"></div>
        </div>
      </div>` : ''}
    </div>
  `;

  await fetchAndRenderMessages();
  if (isGroup) loadCachedParticipants();
  renderPinnedBanner();
  startMsgPolling();
}

function closeMobileChat() {
  const layout = document.querySelector('.chat-layout');
  if (layout) layout.classList.remove('chat-open');
}

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

  // Load pinned message from localStorage
  const pinKey = 'pin_' + selectedGroup;
  const pinned = localStorage.getItem(pinKey) || '';

  body.innerHTML = '';

  // Description section
  const descSection = document.createElement('div');
  descSection.className = 'panel-info-section';
  descSection.innerHTML = `
    <div class="panel-info-label">Descricao do grupo</div>
    <textarea id="groupDescInput" class="panel-info-textarea" placeholder="Sem descricao">${escapeHtml(desc)}</textarea>
    <button class="btn btn-primary btn-sm panel-info-save" onclick="saveGroupDescription()">Salvar descricao</button>
  `;
  body.appendChild(descSection);

  // Pinned message section
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

  // Show pinned banner in chat if exists
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
  // Remove existing banner
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

async function fetchParticipants() {
  if (!selectedGroup || !currentInstance) return [];
  let res = await api('GET', '/group/participants/' + currentInstance + '?groupJid=' + encodeURIComponent(selectedGroup));

  // Retry once on failure
  if (!res.ok) {
    await new Promise(r => setTimeout(r, 1500));
    res = await api('GET', '/group/participants/' + currentInstance + '?groupJid=' + encodeURIComponent(selectedGroup));
  }

  const rd = res.ok ? res.data : null;
  let participants = Array.isArray(rd) ? rd : (rd?.participants || []);

  // Fallback: try fetching group info with participants if direct endpoint returned empty
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

  // Fixed header with count, search, and add member
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

  // Sort: superadmin first, then admins, then members
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

  // First check if number is on WhatsApp and get the real JID
  toast('Verificando numero...');
  const check = await api('POST', '/chat/whatsappNumbers/' + currentInstance, { numbers: [num] });
  let jidToAdd = num;
  if (check.ok && Array.isArray(check.data)) {
    const found = check.data.find(n => n.exists === true || n.exists === 'true');
    if (!found) {
      toast('Numero ' + num + ' nao esta no WhatsApp', 'error');
      return;
    }
    // Use the real JID returned by WhatsApp (ensures correct number format)
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
      // 408 = privacy settings block direct add, try sending invite link instead
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

function extractMessages(res) {
  // API returns { messages: { total, pages, currentPage, records: [...] } }
  if (res && res.messages && Array.isArray(res.messages.records)) {
    return res.messages.records;
  }
  // Fallback: maybe it returns an array directly
  if (Array.isArray(res)) return res;
  return [];
}

function getMessageText(m) {
  const msg = m.message;
  if (!msg) return '';
  return msg.conversation
    || msg.extendedTextMessage?.text
    || msg.buttonsResponseMessage?.selectedDisplayText
    || msg.listResponseMessage?.title
    || msg.templateButtonReplyMessage?.selectedDisplayText
    || '';
}

function getMediaType(m) {
  const msg = m.message;
  if (!msg) return null;
  if (msg.imageMessage) return 'image';
  if (msg.videoMessage) return 'video';
  if (msg.audioMessage) return 'audio';
  if (msg.documentMessage) return 'document';
  if (msg.stickerMessage) return 'sticker';
  if (msg.locationMessage || msg.liveLocationMessage) return 'location';
  return null;
}

function getMediaCaption(m) {
  const msg = m.message;
  if (!msg) return '';
  return msg.imageMessage?.caption || msg.videoMessage?.caption || msg.documentMessage?.caption || '';
}

function getContextInfo(m) {
  // Evolution API stores contextInfo at top-level of the message record
  if (m.contextInfo && (m.contextInfo.quotedMessage || m.contextInfo.stanzaId)) return m.contextInfo;
  // Fallback: check inside the message proto (standard WhatsApp format)
  const msg = m.message;
  if (!msg) return null;
  return msg.extendedTextMessage?.contextInfo
    || msg.imageMessage?.contextInfo
    || msg.videoMessage?.contextInfo
    || msg.audioMessage?.contextInfo
    || msg.documentMessage?.contextInfo
    || msg.stickerMessage?.contextInfo
    || null;
}

function getQuotedText(qm) {
  if (!qm) return '';
  if (qm.conversation) return qm.conversation;
  if (qm.extendedTextMessage?.text) return qm.extendedTextMessage.text;
  if (qm.imageMessage) return qm.imageMessage.caption || 'Imagem';
  if (qm.videoMessage) return qm.videoMessage.caption || 'Video';
  if (qm.audioMessage) return 'Audio';
  if (qm.documentMessage) return qm.documentMessage.fileName || 'Documento';
  if (qm.stickerMessage) return 'Sticker';
  if (qm.locationMessage) return 'Localizacao';
  return '';
}

// =====================
// REPLY STATE
// =====================
let replyingTo = null; // full message object being replied to

function setReplyTo(m) {
  replyingTo = m;
  renderReplyPreview();
  document.getElementById('msgInput').focus();
}

function cancelReply() {
  replyingTo = null;
  const preview = document.getElementById('replyPreview');
  if (preview) preview.remove();
}

function renderReplyPreview() {
  // Remove existing preview without clearing replyingTo
  const old = document.getElementById('replyPreview');
  if (old) old.remove();
  if (!replyingTo) return;

  const text = getMessageText(replyingTo) || getMediaCaption(replyingTo) || (getMediaType(replyingTo) ? 'Midia' : '');
  const sender = replyingTo.key?.fromMe ? 'Voce' : (replyingTo.pushName || resolveContactName(replyingTo.key?.participant) || '');

  const preview = document.createElement('div');
  preview.className = 'reply-preview';
  preview.id = 'replyPreview';
  preview.innerHTML =
    '<div class="reply-preview-content">' +
      '<div class="reply-preview-sender">' + escapeHtml(sender) + '</div>' +
      '<div class="reply-preview-text">' + escapeHtml(text) + '</div>' +
    '</div>';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'reply-preview-close';
  closeBtn.textContent = '\u00D7';
  closeBtn.addEventListener('click', cancelReply);
  preview.appendChild(closeBtn);

  const chatInput = document.querySelector('.chat-input');
  if (chatInput) chatInput.parentNode.insertBefore(preview, chatInput);
}

// =====================
// MENTIONS
// =====================
let cachedParticipants = []; // [{id: 'jid', number: '551199...', name: '...'}]
let mentionActiveIndex = 0;

const lidToPhone = {}; // LID JID -> phone number

function resolveContactName(jid) {
  if (!jid) return '';
  if (contactNames[jid]) return contactNames[jid];
  // If LID format, try to resolve via cached participant phone
  if (jid.endsWith('@lid') && lidToPhone[jid]) {
    return contactNames[lidToPhone[jid]] || formatPhone(lidToPhone[jid].split('@')[0]);
  }
  const raw = jid.split('@')[0];
  // Only format as phone if it looks like a real number (not LID)
  if (/^\d{10,15}$/.test(raw)) return formatPhone(raw);
  return '';
}

async function loadCachedParticipants() {
  if (!selectedGroup || !currentInstance) return;
  const list = await fetchParticipants();
  cachedParticipants = list.map(p => {
    const jid = p.id || String(p);
    const phoneJid = p.phoneNumber ? String(p.phoneNumber) : '';
    const phone = phoneJid ? phoneJid.split('@')[0] : jid.split('@')[0];
    // Map LID → phone JID for name resolution
    if (jid.endsWith('@lid') && phoneJid) lidToPhone[jid] = phoneJid;
    // Use existing contactName or fall back to API fields
    const apiName = p.pushName || p.name || p.notify || p.verifiedName || '';
    if (!contactNames[jid] && apiName) contactNames[jid] = apiName;
    // Also store name under phone JID for cross-reference
    if (phoneJid && !contactNames[phoneJid] && apiName) contactNames[phoneJid] = apiName;
    return { id: jid, number: phone, name: contactNames[jid] || '' };
  });
}

function handleMsgKeydown(e) {
  const dropdown = document.getElementById('mentionDropdown');
  if (dropdown && dropdown.classList.contains('show')) {
    const items = dropdown.querySelectorAll('.mention-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mentionActiveIndex = Math.min(mentionActiveIndex + 1, items.length - 1);
      updateMentionActive(items);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      mentionActiveIndex = Math.max(mentionActiveIndex - 1, 0);
      updateMentionActive(items);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (items[mentionActiveIndex]) items[mentionActiveIndex].click();
      return;
    }
    if (e.key === 'Escape') {
      closeMentionDropdown();
      return;
    }
  }
  if (e.key === 'Enter') sendMsg();
}

function handleMentionInput(input) {
  const val = input.value;
  const cursor = input.selectionStart;
  // Find @ before cursor
  const before = val.substring(0, cursor);
  const atIdx = before.lastIndexOf('@');
  if (atIdx === -1 || (atIdx > 0 && before[atIdx - 1] !== ' ' && before[atIdx - 1] !== '\n')) {
    closeMentionDropdown();
    return;
  }
  const query = before.substring(atIdx + 1).toLowerCase();
  showMentionDropdown(query, atIdx);
}

function showMentionDropdown(query, atIdx) {
  const dropdown = document.getElementById('mentionDropdown');
  if (!dropdown) return;
  dropdown.innerHTML = '';
  mentionActiveIndex = 0;

  const results = [];

  // "Todos" option
  if ('todos'.startsWith(query) || 'all'.startsWith(query) || query === '') {
    results.push({ type: 'all', label: 'Todos', sub: 'Mencionar todos do grupo' });
  }

  cachedParticipants.forEach(p => {
    const displayName = contactNames[p.id] || p.name || '';
    if (p.number.includes(query) || displayName.toLowerCase().includes(query)) {
      results.push({ type: 'user', id: p.id, number: p.number, name: displayName });
    }
  });

  if (results.length === 0) { closeMentionDropdown(); return; }

  results.slice(0, 15).forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'mention-item' + (r.type === 'all' ? ' mention-item-all' : '') + (i === 0 ? ' active' : '');
    const displayLabel = r.type === 'all' ? r.label : (r.name || r.number);
    const subLabel = r.type === 'all' ? r.sub : (r.name ? r.number : '');
    item.innerHTML =
      '<div class="mention-item-icon"><svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></div>' +
      '<div><div class="mention-item-name">' + escapeHtml(displayLabel) + '</div>' +
      (subLabel ? '<div class="mention-item-number">' + escapeHtml(subLabel) + '</div>' : '') +
      '</div>';
    item.addEventListener('click', () => {
      const input = document.getElementById('msgInput');
      const val = input.value;
      const insertText = r.type === 'all' ? '@all' : '@' + r.number;
      input.value = val.substring(0, atIdx) + insertText + ' ' + val.substring(input.selectionStart);
      input.focus();
      const newPos = atIdx + insertText.length + 1;
      input.setSelectionRange(newPos, newPos);
      closeMentionDropdown();
    });
    dropdown.appendChild(item);
  });

  dropdown.classList.add('show');
}

function updateMentionActive(items) {
  items.forEach((it, i) => it.classList.toggle('active', i === mentionActiveIndex));
  if (items[mentionActiveIndex]) items[mentionActiveIndex].scrollIntoView({ block: 'nearest' });
}

function closeMentionDropdown() {
  const dropdown = document.getElementById('mentionDropdown');
  if (dropdown) dropdown.classList.remove('show');
}

function parseMentions(text) {
  const mentioned = [];
  let everyOne = false;
  const regex = /@(\S+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const ref = match[1];
    if (ref.toLowerCase() === 'all' || ref.toLowerCase() === 'todos') {
      everyOne = true;
    } else {
      // Find participant by number, send just the number (API expects numeric strings)
      const p = cachedParticipants.find(pp => pp.number === ref);
      if (p) mentioned.push(p.number);
    }
  }
  return { mentioned, everyOne };
}

// LRU cache for fetched media base64 (max 50 entries)
const MEDIA_CACHE_LIMIT = 50;
const mediaCacheKeys = [];
const mediaCache = {};

function mediaCacheSet(key, value) {
  if (mediaCache[key]) return;
  if (mediaCacheKeys.length >= MEDIA_CACHE_LIMIT) {
    const oldest = mediaCacheKeys.shift();
    delete mediaCache[oldest];
  }
  mediaCacheKeys.push(key);
  mediaCache[key] = value;
}

function mediaCacheClear() {
  mediaCacheKeys.length = 0;
  for (const k in mediaCache) delete mediaCache[k];
}

async function fetchMediaBase64(msgKey) {
  const cacheKey = msgKey.id;
  if (mediaCache[cacheKey]) return mediaCache[cacheKey];

  try {
    const res = await api('POST', '/chat/getBase64FromMediaMessage/' + currentInstance, {
      message: { key: msgKey },
      convertToMp4: false
    });
    if (res.ok && res.data && res.data.base64) {
      const mime = res.data.mimetype || 'application/octet-stream';
      const dataUrl = 'data:' + mime + ';base64,' + res.data.base64;
      mediaCacheSet(cacheKey, dataUrl);
      return dataUrl;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function renderMediaPlaceholder(msgId) {
  return '<div class="msg-media-loading" id="media-' + msgId + '"><div class="spinner"></div></div>';
}

async function loadMediaForMsg(m) {
  const key = m.key;
  if (!key || !key.id) return;
  const mediaType = getMediaType(m);
  if (!mediaType || mediaType === 'location') return;

  const el = document.getElementById('media-' + key.id);
  if (!el) return;

  const dataUrl = await fetchMediaBase64(key);
  if (!dataUrl || !el.parentElement) return;

  const msg = m.message;
  if (mediaType === 'image' || mediaType === 'sticker') {
    el.outerHTML = '<img src="' + dataUrl + '" onclick="previewImage(this.src)" title="Clique para ampliar">';
  } else if (mediaType === 'video') {
    el.outerHTML = '<video src="' + dataUrl + '" controls preload="metadata"></video>';
  } else if (mediaType === 'audio') {
    el.outerHTML = '<audio src="' + dataUrl + '" controls preload="metadata"></audio>';
  } else if (mediaType === 'document') {
    const fileName = msg.documentMessage?.fileName || 'documento';
    el.outerHTML = '<a class="msg-doc" href="' + dataUrl + '" download="' + escapeHtml(fileName) + '">' +
      '<div class="msg-doc-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg></div>' +
      '<div class="msg-doc-info"><div class="msg-doc-name">' + escapeHtml(fileName) + '</div></div></a>';
  }
}

function appendSystemMessage(text) {
  if (!selectedGroup) return;
  const ts = Math.floor(Date.now() / 1000);
  saveSystemEvent(selectedGroup, { text, ts });

  const container = document.getElementById('msgContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'msg-system';
  el.innerHTML = '<span>' + escapeHtml(text) + '</span>';
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function getSystemEvents(groupJid) {
  try { return JSON.parse(localStorage.getItem('sysevt_' + groupJid) || '[]'); } catch { return []; }
}

function saveSystemEvent(groupJid, evt) {
  const events = getSystemEvents(groupJid);
  events.push(evt);
  // Keep max 200 events per group
  if (events.length > 200) events.splice(0, events.length - 200);
  try { localStorage.setItem('sysevt_' + groupJid, JSON.stringify(events)); } catch {}
}

function previewImage(src) {
  const overlay = document.createElement('div');
  overlay.className = 'img-preview-overlay';
  overlay.onclick = () => overlay.remove();
  overlay.innerHTML = '<img src="' + src + '">';
  document.body.appendChild(overlay);
}

async function fetchAndRenderMessages() {
  if (!selectedGroup || !currentInstance) return;

  const res = await api('POST', '/chat/findMessages/' + currentInstance, {
    where: { key: { remoteJid: selectedGroup } },
    offset: 100,
    page: 1
  });

  const container = document.getElementById('msgContainer');
  if (!container) return;

  const rd = res.ok ? res.data : null;
  const msgs = extractMessages(rd);
  const sysEvents = getSystemEvents(selectedGroup);
  const total = (rd?.messages?.total || msgs.length) + sysEvents.length;

  // Only re-render if count changed
  if (total === lastMsgCount && total > 0) return;
  lastMsgCount = total;

  const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;

  if (msgs.length > 0 || sysEvents.length > 0) {
    // Merge regular messages with system events into a unified sorted list
    const allItems = msgs.map(m => ({ type: 'msg', data: m, ts: typeof m.messageTimestamp === 'string' ? parseInt(m.messageTimestamp) : (m.messageTimestamp || 0) }));
    sysEvents.forEach(evt => { allItems.push({ type: 'sys', data: evt, ts: evt.ts || 0 }); });
    allItems.sort((a, b) => a.ts - b.ts);

    // Extract only regular msgs for reaction map and contact names
    const sorted = allItems.filter(i => i.type === 'msg').map(i => i.data);

    // Track last message timestamp for group ordering
    if (sorted.length > 0 && selectedGroup) {
      const lastMsg = sorted[sorted.length - 1];
      const lastTs = typeof lastMsg.messageTimestamp === 'string' ? parseInt(lastMsg.messageTimestamp) : (lastMsg.messageTimestamp || 0);
      const prevTs = groupLastMsg[selectedGroup] || 0;
      if (lastTs > prevTs) {
        groupLastMsg[selectedGroup] = lastTs;
        saveGroupTimestamps();
        renderGroupList();
      }
    }

    // Build reaction map and contact names from all messages (before filtering)
    const reactionMap = buildReactionMap(sorted);
    sorted.forEach(m => {
      const participant = m.key?.participant || m.key?.remoteJid;
      if (participant && m.pushName) contactNames[participant] = m.pushName;
    });

    container.innerHTML = '';
    const mediaToLoad = [];
    let prevDate = '';
    let prevSenderJid = '';
    let prevTimestamp = 0;
    allItems.forEach(item => {
      // Render system events
      if (item.type === 'sys') {
        const sysTs = item.ts;
        // Day separator for system events too
        if (sysTs) {
          const ms = sysTs < 1e12 ? sysTs * 1000 : sysTs;
          const d = new Date(ms);
          const sysDate = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
          if (sysDate && sysDate !== prevDate) {
            const sep = document.createElement('div');
            sep.className = 'msg-day-separator';
            const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            let label = sysDate;
            if (sysDate === today) label = 'Hoje';
            else if (sysDate === yesterday) label = 'Ontem';
            sep.innerHTML = '<span>' + label + '</span>';
            container.appendChild(sep);
            prevDate = sysDate;
          }
        }
        const el = document.createElement('div');
        el.className = 'msg-system';
        el.innerHTML = '<span>' + escapeHtml(item.data.text) + '</span>';
        container.appendChild(el);
        prevSenderJid = '';
        prevTimestamp = 0;
        return;
      }

      const m = item.data;
      // Skip reaction messages (they are shown as badges on target msgs)
      if (m.messageType === 'reactionMessage') return;

      const key = m.key || {};
      const isOut = key.fromMe === true;
      const text = getMessageText(m);
      const mediaType = getMediaType(m);
      const caption = getMediaCaption(m);

      // Skip messages with no text and no media
      if (!text && !mediaType) return;

      const ts = m.messageTimestamp;
      let time = '';
      let msgDate = '';
      let msgTs = 0;
      if (ts) {
        const num = typeof ts === 'string' ? parseInt(ts) : ts;
        const ms = num < 1e12 ? num * 1000 : num;
        msgTs = num;
        const d = new Date(ms);
        time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        msgDate = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      }

      // Day separator
      if (msgDate && msgDate !== prevDate) {
        const sep = document.createElement('div');
        sep.className = 'msg-day-separator';
        const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        let label = msgDate;
        if (msgDate === today) label = 'Hoje';
        else if (msgDate === yesterday) label = 'Ontem';
        sep.innerHTML = '<span>' + label + '</span>';
        container.appendChild(sep);
        prevDate = msgDate;
        prevSenderJid = '';
        prevTimestamp = 0;
      }

      const participantJid = key.participant || key.remoteJid;
      const currentSenderKey = isOut ? '__me__' : (participantJid || '');
      const isPrivateChat = isPrivateJid(selectedGroup);
      // In private chats, don't show sender name (it's always the same person)
      const sender = (!isOut && !isPrivateChat) ? (m.pushName || resolveContactName(participantJid)) : '';

      // Grouping: same sender within 5 minutes
      const isGrouped = currentSenderKey && currentSenderKey === prevSenderJid && msgTs && (msgTs - prevTimestamp) < 300;
      prevSenderJid = currentSenderKey;
      prevTimestamp = msgTs;

      // Build message bubble
      const wrapper = document.createElement('div');
      wrapper.className = 'msg-wrapper' + (isOut ? ' msg-wrapper-out' : '') + (isGrouped ? ' msg-grouped' : '');

      const div = document.createElement('div');
      div.className = 'msg ' + (isOut ? 'msg-out' : 'msg-in');

      // Hover actions (reply + react)
      const hoverActions = document.createElement('div');
      hoverActions.className = 'msg-hover-actions';

      const replyBtn = document.createElement('button');
      replyBtn.textContent = '\u{21A9}\u{FE0F}';
      replyBtn.title = 'Responder';
      replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setReplyTo(m);
      });
      hoverActions.appendChild(replyBtn);

      const reactBtn = document.createElement('button');
      reactBtn.textContent = '\u{1F600}';
      reactBtn.title = 'Reagir';
      reactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showReactionPicker(wrapper, key);
      });
      hoverActions.appendChild(reactBtn);

      wrapper.appendChild(hoverActions);

      let mediaHtml = '';
      if (mediaType) {
        if (mediaType === 'location') {
          const loc = m.message.locationMessage || m.message.liveLocationMessage || {};
          const lat = loc.degreesLatitude || 0;
          const lng = loc.degreesLongitude || 0;
          const locName = loc.name || loc.address || '';
          const mapUrl = 'https://maps.google.com/maps?q=' + lat + ',' + lng;
          mediaHtml = '<div class="msg-media"><a class="msg-location" href="' + mapUrl + '" target="_blank" rel="noopener noreferrer">' +
            '<div style="width:280px;height:120px;background:#e8f5e9;border-radius:6px;display:flex;align-items:center;justify-content:center;gap:8px;color:#1a7f37;font-size:13px">' +
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="#1a7f37"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>' +
            lat.toFixed(5) + ', ' + lng.toFixed(5) +
            '</div>' +
            (locName ? '<div class="msg-location-label">' + escapeHtml(locName) + '</div>' : '') +
            '</a></div>';
        } else if (mediaCache[key.id]) {
          const dataUrl = mediaCache[key.id];
          if (mediaType === 'image' || mediaType === 'sticker') {
            mediaHtml = '<div class="msg-media"><img src="' + dataUrl + '" onclick="previewImage(this.src)" title="Clique para ampliar"></div>';
          } else if (mediaType === 'video') {
            mediaHtml = '<div class="msg-media"><video src="' + dataUrl + '" controls preload="metadata"></video></div>';
          } else if (mediaType === 'audio') {
            mediaHtml = '<div class="msg-media"><audio src="' + dataUrl + '" controls preload="metadata"></audio></div>';
          } else if (mediaType === 'document') {
            const fileName = m.message.documentMessage?.fileName || 'documento';
            mediaHtml = '<div class="msg-media"><a class="msg-doc" href="' + dataUrl + '" download="' + escapeHtml(fileName) + '">' +
              '<div class="msg-doc-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg></div>' +
              '<div class="msg-doc-info"><div class="msg-doc-name">' + escapeHtml(fileName) + '</div></div></a></div>';
          }
        } else {
          mediaHtml = '<div class="msg-media">' + renderMediaPlaceholder(key.id) + '</div>';
          mediaToLoad.push(m);
        }
      }

      // Build quoted message block if this is a reply
      let quotedHtml = '';
      const ctxInfo = getContextInfo(m);
      if (ctxInfo && ctxInfo.quotedMessage) {
        const qSender = ctxInfo.participant ? resolveContactName(ctxInfo.participant) : '';
        const qText = getQuotedText(ctxInfo.quotedMessage);
        quotedHtml = '<div class="msg-quoted">' +
          (qSender ? '<div class="msg-quoted-sender">' + escapeHtml(qSender) + '</div>' : '') +
          '<div class="msg-quoted-text">' + escapeHtml(qText || 'Midia') + '</div></div>';
      }

      div.innerHTML =
        quotedHtml +
        (sender ? '<div class="msg-sender">' + escapeHtml(sender) + '</div>' : '') +
        mediaHtml +
        (caption ? '<div class="msg-caption">' + escapeHtml(caption) + '</div>' : '') +
        (text ? highlightMentions(escapeHtml(text)) : '') +
        '<span class="msg-time">' + time + '</span>';
      wrapper.appendChild(div);

      // Show existing reactions from reaction map
      const reactions = getReactionsForMsg(reactionMap, key.id);
      if (reactions.length > 0) {
        const reactionsDiv = document.createElement('div');
        reactionsDiv.className = 'msg-reactions';
        // Group by emoji and count
        const emojiCounts = {};
        reactions.forEach(r => {
          emojiCounts[r.emoji] = (emojiCounts[r.emoji] || 0) + 1;
        });
        Object.entries(emojiCounts).forEach(([emoji, count]) => {
          const badge = document.createElement('span');
          badge.className = 'msg-reaction-badge';
          badge.textContent = emoji + (count > 1 ? ' ' + count : '');
          badge.title = 'Reagir com ' + emoji;
          badge.addEventListener('click', () => sendReaction(key, emoji));
          reactionsDiv.appendChild(badge);
        });
        wrapper.appendChild(reactionsDiv);
      }

      container.appendChild(wrapper);
    });

    if (wasAtBottom || lastMsgCount <= total) container.scrollTop = container.scrollHeight;

    // Lazy-load media (don't block rendering)
    mediaToLoad.forEach(m => loadMediaForMsg(m));
  } else {
    container.innerHTML = '<div style="text-align:center;color:#667781;padding:40px">Nenhuma mensagem ainda</div>';
  }
}

// =====================
// REACTIONS
// =====================
const REACTION_EMOJIS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}', '\u{1F525}', '\u{1F389}'];
let activeReactionPicker = null;

// Build a map of targetMsgId -> [{emoji, sender}] from reaction messages
function buildReactionMap(allMessages) {
  const map = {};
  allMessages.forEach(m => {
    if (m.messageType === 'reactionMessage' && m.message?.reactionMessage) {
      const rm = m.message.reactionMessage;
      const targetId = rm.key?.id;
      const emoji = rm.text;
      if (targetId && emoji) {
        if (!map[targetId]) map[targetId] = [];
        // Keep only latest reaction per sender (overwrite)
        const senderId = m.key?.participant || m.key?.remoteJid || 'unknown';
        const existing = map[targetId].findIndex(r => r.sender === senderId);
        if (existing >= 0) map[targetId][existing] = { emoji, sender: senderId };
        else map[targetId].push({ emoji, sender: senderId });
      }
    }
  });
  return map;
}

function getReactionsForMsg(reactionMap, msgId) {
  return (reactionMap[msgId] || []).filter(r => r.emoji);
}

function showReactionPicker(wrapper, msgKey) {
  closeReactionPicker();

  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.id = 'reactionPicker';

  REACTION_EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendReaction(msgKey, emoji);
      closeReactionPicker();
    });
    picker.appendChild(btn);
  });

  // Position: above the react button
  const isOut = wrapper.classList.contains('msg-wrapper-out');
  picker.style.bottom = '100%';
  picker.style.marginBottom = '4px';
  if (isOut) {
    picker.style.right = '0';
  } else {
    picker.style.left = '0';
  }

  wrapper.style.position = 'relative';
  wrapper.appendChild(picker);
  activeReactionPicker = picker;

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', closeReactionPicker, { once: true });
  }, 0);
}

function closeReactionPicker() {
  if (activeReactionPicker) {
    activeReactionPicker.remove();
    activeReactionPicker = null;
  }
}

async function sendReaction(msgKey, emoji) {
  if (!currentInstance || !msgKey) return;
  if (!ensureConnected()) return;

  const reactionKey = {
    id: msgKey.id,
    remoteJid: msgKey.remoteJid,
    fromMe: msgKey.fromMe === true
  };
  if (msgKey.participant) reactionKey.participant = msgKey.participant;

  const res = await api('POST', '/message/sendReaction/' + currentInstance, {
    key: reactionKey,
    reaction: emoji
  });

  if (res.ok) {
    toast('Reacao ' + emoji + ' enviada!');
    lastMsgCount = 0; // force refresh
    fetchAndRenderMessages();
  } else {
    const errMsg = res.data?.response?.message;
    const isConnErr = typeof errMsg === 'string' && errMsg.includes('Connection') || (Array.isArray(errMsg) && errMsg.some(e => String(e).includes('Connection')));
    toast(isConnErr ? 'Conexao instavel, tente novamente' : 'Erro ao enviar reacao', 'error');
  }
}

function highlightMentions(escapedHtml) {
  return escapedHtml.replace(/@(\S+)/g, (match, ref) => {
    if (ref.toLowerCase() === 'all' || ref.toLowerCase() === 'todos') {
      return '<span class="msg-mention">@todos</span>';
    }
    // Try to resolve number to name
    const p = cachedParticipants.find(pp => pp.number === ref);
    const name = p ? (contactNames[p.id] || p.name || ref) : ref;
    return '<span class="msg-mention">@' + escapeHtml(name) + '</span>';
  });
}

function startMsgPolling() {
  stopMsgPolling();
  if (!selectedGroup) return;
  document.getElementById('pollingIndicator')?.style.setProperty('display', 'flex');
  msgPollInterval = setInterval(fetchAndRenderMessages, 3000);
}

function stopMsgPolling() {
  if (msgPollInterval) { clearInterval(msgPollInterval); msgPollInterval = null; }
  lastMsgCount = 0;
  document.getElementById('pollingIndicator')?.style.setProperty('display', 'none');
}

// CHAT SEARCH
let searchTimeout = null;

function handleChatSearch(query) {
  clearTimeout(searchTimeout);
  const groupListEl = document.getElementById('groupList');
  const searchResultsEl = document.getElementById('searchResults');

  if (!query || query.trim().length < 2) {
    groupListEl.style.display = '';
    searchResultsEl.style.display = 'none';
    searchResultsEl.innerHTML = '';
    return;
  }

  searchTimeout = setTimeout(() => searchMessages(query.trim()), 400);
}

async function searchMessages(query) {
  if (!currentInstance || allChats.length === 0) return;

  const groupListEl = document.getElementById('groupList');
  const searchResultsEl = document.getElementById('searchResults');

  groupListEl.style.display = 'none';
  searchResultsEl.style.display = '';
  searchResultsEl.innerHTML = '<div class="search-status"><div class="spinner" style="margin-bottom:8px"></div>Buscando em ' + allChats.length + ' conversas...</div>';

  const results = [];
  const queryLower = query.toLowerCase();

  // Search in all chats in parallel (batches of 5 to avoid overload)
  const batchSize = 5;
  for (let i = 0; i < allChats.length; i += batchSize) {
    const batch = allChats.slice(i, i + batchSize);
    const promises = batch.map(async (chat) => {
      try {
        const res = await api('POST', '/chat/findMessages/' + currentInstance, {
          where: { key: { remoteJid: chat.id } },
          offset: 100,
          page: 1
        });
        const msgs = extractMessages(res.ok ? res.data : null);
        const matches = [];
        msgs.forEach(m => {
          const text = getMessageText(m) || getMediaCaption(m);
          if (text && text.toLowerCase().includes(queryLower)) {
            matches.push({ text, sender: m.pushName || '', timestamp: m.messageTimestamp });
          }
        });
        if (matches.length > 0) {
          results.push({ group: chat, matches });
        }
      } catch (e) { /* skip chat on error */ }
    });
    await Promise.all(promises);
  }

  renderSearchResults(results, query);
}

function renderSearchResults(results, query) {
  const searchResultsEl = document.getElementById('searchResults');
  if (results.length === 0) {
    searchResultsEl.innerHTML = '<div class="search-status">Nenhum resultado encontrado</div>';
    return;
  }

  // Sort by most matches first
  results.sort((a, b) => b.matches.length - a.matches.length);
  const queryLower = query.toLowerCase();

  searchResultsEl.innerHTML = '';
  results.forEach(r => {
    // Show the most recent match as preview
    const sorted = [...r.matches].sort((a, b) => {
      const tsA = typeof a.timestamp === 'string' ? parseInt(a.timestamp) : (a.timestamp || 0);
      const tsB = typeof b.timestamp === 'string' ? parseInt(b.timestamp) : (b.timestamp || 0);
      return tsB - tsA;
    });

    sorted.forEach(match => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.onclick = () => {
        // Clear search and open the group
        document.getElementById('chatSearchInput').value = '';
        handleChatSearch('');
        const g = r.group;
        selectGroup(g, null);
      };

      // Highlight the query in the preview text
      const preview = highlightSearchTerm(match.text, queryLower);
      const sender = match.sender ? escapeHtml(match.sender) + ': ' : '';

      const chatLabel = r.group.subject || r.group.pushName || contactNames[r.group.id] || formatPhone(r.group.id.split('@')[0]);
      item.innerHTML = `
        <div class="search-result-group">${escapeHtml(chatLabel)}</div>
        <div class="search-result-preview">${sender}${preview}</div>
      `;
      searchResultsEl.appendChild(item);
    });
  });
}

function highlightSearchTerm(text, queryLower) {
  const escaped = escapeHtml(text);
  const idx = escaped.toLowerCase().indexOf(queryLower);
  if (idx === -1) return escaped;
  // Show context around the match
  const start = Math.max(0, idx - 30);
  const end = Math.min(escaped.length, idx + queryLower.length + 30);
  let snippet = (start > 0 ? '...' : '') + escaped.substring(start, end) + (end < escaped.length ? '...' : '');
  // Highlight
  const re = new RegExp('(' + queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return snippet.replace(re, '<mark>$1</mark>');
}

async function sendMsg() {
  if (!ensureConnected()) return;
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text || !selectedGroup) return;
  input.value = '';

  // Capture reply state before clearing
  const replyMsg = replyingTo;
  cancelReply();

  // Optimistic UI
  const container = document.getElementById('msgContainer');
  const wrapper = document.createElement('div');
  wrapper.className = 'msg-wrapper msg-wrapper-out';
  const div = document.createElement('div');
  div.className = 'msg msg-out';
  const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  let quotedHtml = '';
  if (replyMsg) {
    const qSender = replyMsg.key?.fromMe ? 'Voce' : (replyMsg.pushName || resolveContactName(replyMsg.key?.participant) || '');
    const qText = getMessageText(replyMsg) || getMediaCaption(replyMsg) || 'Midia';
    quotedHtml = '<div class="msg-quoted"><div class="msg-quoted-sender">' + escapeHtml(qSender) + '</div>' +
      '<div class="msg-quoted-text">' + escapeHtml(qText) + '</div></div>';
  }

  div.innerHTML = quotedHtml + highlightMentions(escapeHtml(text)) + '<span class="msg-time">' + now + '</span>';
  wrapper.appendChild(div);
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
  lastMsgCount++;

  // Build body with mentions
  const { mentioned, everyOne } = parseMentions(text);
  const body = { number: selectedGroup, text };

  if (mentioned.length > 0) body.mentioned = mentioned;
  if (everyOne) body.everyOne = true;
  if (replyMsg && replyMsg.key) {
    body.quoted = {
      key: {
        id: replyMsg.key.id,
        remoteJid: replyMsg.key.remoteJid,
        fromMe: replyMsg.key.fromMe === true
      },
      message: replyMsg.message
    };
    if (replyMsg.key.participant) body.quoted.key.participant = replyMsg.key.participant;
  }

  const res = await api('POST', '/message/sendText/' + currentInstance, body);
  if (!res.ok || !res.data || !res.data.key) {
    const errMsg = res.data?.response?.message;
    const isConnErr = typeof errMsg === 'string' && errMsg.includes('Connection') || (Array.isArray(errMsg) && errMsg.some(e => String(e).includes('Connection')));
    toast(isConnErr ? 'Conexao instavel, tente novamente' : 'Erro ao enviar mensagem', 'error');
  }
}

// =====================
// MEDIA SEND
// =====================
let pendingMediaType = null;

function toggleAttachMenu() {
  const menu = document.getElementById('attachMenu');
  if (menu) menu.classList.toggle('show');
}

function pickMedia(type) {
  toggleAttachMenu();
  pendingMediaType = type;
  const input = document.getElementById('mediaFileInput');
  if (type === 'image') input.accept = 'image/*';
  else if (type === 'video') input.accept = 'video/*';
  else if (type === 'audio') input.accept = 'audio/*';
  else input.accept = '*/*';
  input.value = '';
  input.click();
}

function handleMediaFile(input) {
  if (!ensureConnected()) return;
  const file = input.files[0];
  if (!file || !selectedGroup) return;
  if (file.size > MAX_MEDIA_SIZE) return toast('Arquivo muito grande (max 16MB)', 'error');

  // Capture reply state before clearing
  const replyMsg = replyingTo;
  cancelReply();

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64Full = e.target.result;
    const base64Data = base64Full.split(',')[1];
    const mediatype = pendingMediaType || 'document';

    // Optimistic UI
    const container = document.getElementById('msgContainer');
    const div = document.createElement('div');
    div.className = 'msg msg-out';
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    let preview = '';
    if (mediatype === 'image') {
      preview = '<div class="msg-media"><img src="' + base64Full + '" style="max-width:200px;max-height:200px;border-radius:6px"></div>';
    } else if (mediatype === 'video') {
      preview = '<div class="msg-media"><video src="' + base64Full + '" style="max-width:200px" controls></video></div>';
    } else if (mediatype === 'audio') {
      preview = '<div class="msg-media"><audio src="' + base64Full + '" controls></audio></div>';
    } else {
      preview = '<div class="msg-media"><div class="msg-doc"><div class="msg-doc-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg></div><div class="msg-doc-info"><div class="msg-doc-name">' + escapeHtml(file.name) + '</div></div></div></div>';
    }

    div.innerHTML = preview + '<span class="msg-time">' + now + ' enviando...</span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    lastMsgCount++;

    toast('Enviando ' + mediatype + '...');
    const body = {
      number: selectedGroup,
      mediatype: mediatype,
      media: base64Data,
      mimetype: file.type || undefined,
      fileName: file.name
    };
    if (replyMsg && replyMsg.key) {
      body.quoted = {
        key: {
          id: replyMsg.key.id,
          remoteJid: replyMsg.key.remoteJid,
          fromMe: replyMsg.key.fromMe === true
        },
        message: replyMsg.message
      };
      if (replyMsg.key.participant) body.quoted.key.participant = replyMsg.key.participant;
    }

    const res = await api('POST', '/message/sendMedia/' + currentInstance, body);
    if (res.ok && res.data && res.data.key) {
      div.querySelector('.msg-time').textContent = now;
      toast('Midia enviada!');
    } else {
      div.querySelector('.msg-time').innerHTML = now + ' <span style="color:#ea0038">erro</span>';
      toast('Erro ao enviar midia', 'error');
    }
  };
  reader.readAsDataURL(file);
}

function showLocationModal() {
  toggleAttachMenu();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'locationModal';
  overlay.innerHTML = `
    <div class="modal-box">
      <h3>Enviar localizacao</h3>
      <div class="form-group">
        <label>Latitude</label>
        <input type="text" id="locLat" placeholder="-15.7801">
      </div>
      <div class="form-group">
        <label>Longitude</label>
        <input type="text" id="locLng" placeholder="-47.9292">
      </div>
      <div class="form-group">
        <label>Nome do local (opcional)</label>
        <input type="text" id="locName" placeholder="Ex: Praca dos Tres Poderes">
      </div>
      <div class="form-group">
        <label>Endereco (opcional)</label>
        <input type="text" id="locAddr" placeholder="Ex: Brasilia, DF">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="document.getElementById('locationModal').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="sendLocation()">Enviar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function sendLocation() {
  if (!ensureConnected()) return;
  const lat = parseFloat(document.getElementById('locLat').value);
  const lng = parseFloat(document.getElementById('locLng').value);
  const name = document.getElementById('locName').value.trim();
  const addr = document.getElementById('locAddr').value.trim();

  if (isNaN(lat) || isNaN(lng)) return toast('Latitude e longitude invalidas', 'error');

  document.getElementById('locationModal').remove();

  toast('Enviando localizacao...');
  const body = {
    number: selectedGroup,
    name: name || undefined,
    address: addr || undefined,
    latitude: lat,
    longitude: lng
  };

  const res = await api('POST', '/message/sendLocation/' + currentInstance, body);
  if (res.ok && res.data && res.data.key) {
    toast('Localizacao enviada!');
    lastMsgCount = 0; // force refresh
    fetchAndRenderMessages();
  } else {
    toast('Erro ao enviar localizacao', 'error');
  }
}

// =====================
// QUICK AUDIOS
// =====================
let audioList = [];
let previewAudio = null;

async function loadAudioList() {
  try {
    const res = await fetch('audios/list.json');
    audioList = await res.json();
  } catch { audioList = []; }
}
loadAudioList();

function toggleAudioPanel() {
  const panel = document.getElementById('audioPanel');
  if (!panel) return;
  // Close attach menu if open
  const menu = document.getElementById('attachMenu');
  if (menu) menu.classList.remove('show');

  panel.classList.toggle('show');
  if (panel.classList.contains('show')) renderAudioPanel();
}

function renderAudioPanel() {
  const panel = document.getElementById('audioPanel');
  if (!panel) return;

  if (audioList.length === 0) {
    panel.innerHTML = '<div class="audio-empty">Nenhum audio encontrado.<br><span style="font-size:11px">Coloque arquivos em <b>audios/</b> e atualize <b>list.json</b></span></div>';
    return;
  }

  let html = '<div class="audio-panel-title">Audios rapidos</div>';
  audioList.forEach((a, i) => {
    html += '<div class="audio-item">' +
      '<button class="audio-item-play" onclick="event.stopPropagation();previewQuickAudio(' + i + ')" title="Ouvir">' +
        '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' +
      '</button>' +
      '<span class="audio-item-name" onclick="sendQuickAudio(' + i + ')">' + escapeHtml(a.name) + '</span>' +
      '<svg viewBox="0 0 24 24" onclick="sendQuickAudio(' + i + ')" style="cursor:pointer" title="Enviar"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
    '</div>';
  });
  panel.innerHTML = html;
}

function previewQuickAudio(index) {
  const a = audioList[index];
  if (!a) return;
  if (previewAudio) { previewAudio.pause(); previewAudio = null; }
  previewAudio = new Audio('audios/' + a.file);
  previewAudio.play().catch(() => toast('Erro ao reproduzir audio', 'error'));
}

async function sendQuickAudio(index) {
  if (!ensureConnected()) return;
  const a = audioList[index];
  if (!a || !selectedGroup) return;

  // Close panel
  const panel = document.getElementById('audioPanel');
  if (panel) panel.classList.remove('show');
  if (previewAudio) { previewAudio.pause(); previewAudio = null; }

  toast('Enviando audio "' + a.name + '"...');

  try {
    // Fetch the audio file and convert to base64
    const res = await fetch('audios/' + a.file);
    const blob = await res.blob();
    if (blob.size > MAX_MEDIA_SIZE) return toast('Audio muito grande (max 16MB)', 'error');
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });

    const sendRes = await api('POST', '/message/sendMedia/' + currentInstance, {
      number: selectedGroup,
      mediatype: 'audio',
      media: base64,
      mimetype: blob.type || 'audio/mpeg',
      fileName: a.file
    });

    if (sendRes.ok && sendRes.data && sendRes.data.key) {
      toast('Audio "' + a.name + '" enviado!');
      lastMsgCount = 0;
      fetchAndRenderMessages();
    } else {
      toast('Erro ao enviar audio', 'error');
    }
  } catch (err) {
    toast('Erro ao carregar audio: ' + err.message, 'error');
  }
}

// =====================
// AUDIO RECORDING
// =====================
let mediaRecorder = null;
let recordedChunks = [];
let recordingTimerInterval = null;
let recordingStartTime = 0;

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // Stop recording and send
    mediaRecorder.stop();
    return;
  }
  // Start recording
  if (!ensureConnected()) return;
  if (!selectedGroup) return toast('Selecione uma conversa primeiro', 'error');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];

    // Use opus/webm for best compatibility with WhatsApp
    const mimeType = MediaRecorder.isTypeSupported('audio/ogg; codecs=opus')
      ? 'audio/ogg; codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm; codecs=opus')
        ? 'audio/webm; codecs=opus'
        : 'audio/webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      // Stop all tracks
      stream.getTracks().forEach(t => t.stop());
      stopRecordingUI();

      if (recordedChunks.length === 0) return;

      const blob = new Blob(recordedChunks, { type: mimeType });
      if (blob.size > MAX_MEDIA_SIZE) return toast('Audio muito grande (max 16MB)', 'error');
      if (blob.size < 1000) return; // too short, probably cancelled

      toast('Enviando audio gravado...');
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });

      const sendRes = await api('POST', '/message/sendWhatsAppAudio/' + currentInstance, {
        number: selectedGroup,
        audio: base64
      });

      if (sendRes.ok && sendRes.data && sendRes.data.key) {
        toast('Audio enviado!');
        lastMsgCount = 0;
        fetchAndRenderMessages();
      } else {
        toast('Erro ao enviar audio gravado', 'error');
      }
    };

    mediaRecorder.start(250); // collect data every 250ms
    startRecordingUI();
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      toast('Permissao de microfone negada', 'error');
    } else {
      toast('Erro ao iniciar gravacao: ' + err.message, 'error');
    }
  }
}

function startRecordingUI() {
  const msgInput = document.getElementById('msgInput');
  const recordBar = document.getElementById('recordingBar');
  const recordBtn = document.getElementById('recordBtn');
  const sendBtn = document.getElementById('sendBtn');

  if (msgInput) msgInput.style.display = 'none';
  if (recordBar) recordBar.style.display = 'flex';
  if (recordBtn) recordBtn.classList.add('recording');
  if (sendBtn) {
    sendBtn.onclick = () => { if (mediaRecorder) mediaRecorder.stop(); };
    sendBtn.title = 'Enviar audio';
  }

  recordingStartTime = Date.now();
  recordingTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = String(elapsed % 60).padStart(2, '0');
    const timerEl = document.getElementById('recordingTimer');
    if (timerEl) timerEl.textContent = min + ':' + sec;
  }, 500);
}

function stopRecordingUI() {
  const msgInput = document.getElementById('msgInput');
  const recordBar = document.getElementById('recordingBar');
  const recordBtn = document.getElementById('recordBtn');
  const sendBtn = document.getElementById('sendBtn');

  if (msgInput) msgInput.style.display = '';
  if (recordBar) recordBar.style.display = 'none';
  if (recordBtn) recordBtn.classList.remove('recording');
  if (sendBtn) {
    sendBtn.onclick = () => sendMsg();
    sendBtn.title = '';
  }

  if (recordingTimerInterval) {
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
  }
  const timerEl = document.getElementById('recordingTimer');
  if (timerEl) timerEl.textContent = '0:00';
}

function cancelRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    recordedChunks = []; // clear so onstop won't send
    mediaRecorder.stop();
  }
  stopRecordingUI();
  toast('Gravacao cancelada');
}

// Close menus when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('attachMenu');
  if (menu && !e.target.closest('.attach-menu') && !e.target.closest('[onclick="toggleAttachMenu()"]')) {
    menu.classList.remove('show');
  }
  const panel = document.getElementById('audioPanel');
  if (panel && !e.target.closest('.audio-panel') && !e.target.closest('[onclick="toggleAudioPanel()"]')) {
    panel.classList.remove('show');
  }
});

// =====================
// INIT
// =====================
async function init() {
  // Fetch all instances from API
  const res = await api('GET', '/instance/fetchInstances');
  const rd = res.ok ? res.data : null;
  if (rd && Array.isArray(rd)) {
    const apiInstances = rd.map(r => {
      const name = String(r.instance?.instanceName || r.instanceName || r.name || '');
      const status = r.instance?.status || r.connectionStatus || 'close';
      let state = status === 'open' ? 'open' : 'closed';
      // Mark revoked sessions distinctly
      if (r.disconnectionReasonCode === 401) state = 'closed';
      return { name, state, ownerJid: r.ownerJid || '' };
    }).filter(i => i.name);

    // Detect duplicate numbers
    const jidMap = {};
    apiInstances.forEach(ai => {
      if (ai.ownerJid && ai.state === 'open') {
        if (!jidMap[ai.ownerJid]) jidMap[ai.ownerJid] = [];
        jidMap[ai.ownerJid].push(ai.name);
      }
    });
    for (const jid in jidMap) {
      if (jidMap[jid].length > 1) {
        toast('Atencao: numero duplicado em ' + jidMap[jid].join(', ') + '. Manter ambas causa conflitos!', 'error');
      }
    }

    // Warn about revoked sessions
    rd.forEach(r => {
      if (r.disconnectionReasonCode === 401) {
        const n = r.instance?.instanceName || r.instanceName || r.name || '';
        if (n) toast('"' + n + '" teve sessao revogada. Reconecte ou remova.', 'error');
      }
    });

    // Merge: keep API as source of truth for state
    const merged = [];
    const seen = new Set();
    apiInstances.forEach(ai => {
      seen.add(ai.name);
      merged.push({ name: ai.name, state: ai.state });
    });
    instances.forEach(li => {
      if (!seen.has(li.name)) merged.push({ ...li, state: 'closed' });
    });
    instances = merged;

    // Enable alwaysOnline and configure webhooks for connected instances
    const cfgRes = await api('GET', '/config');
    const webhookUrl = cfgRes.ok ? cfgRes.data?.webhookUrl : null;
    for (const inst of instances) {
      if (inst.state !== 'open') continue;
      // Set alwaysOnline
      api('PUT', '/instance/update/' + inst.name, { alwaysOnline: true }).catch(() => {});
      // Configure webhook
      if (webhookUrl) {
        api('POST', '/webhook/set/' + inst.name, {
          webhook: { enabled: true, url: webhookUrl, byEvents: false, events: ['CONNECTION_UPDATE', 'GROUP_PARTICIPANTS_UPDATE'] }
        }).catch(() => {});
      }
    }
  }

  if (instances.length > 0 && !currentInstance) currentInstance = instances[0].name;
  saveInstances();
  renderInstances();

  // Start SSE connection for real-time events
  startSSE();
}

function startSSE() {
  if (typeof EventSource === 'undefined') return;
  const evtSource = new EventSource('/events');

  evtSource.addEventListener('connected', () => {
    sseConnected = true;
  });

  // Group participant events (join/leave/remove/promote/demote)
  evtSource.addEventListener('group-participants.update', (e) => {
    try {
      const payload = JSON.parse(e.data);
      const d = payload.data || payload;
      const groupJid = d.id;
      if (!groupJid || groupJid !== selectedGroup) return;

      const action = d.action; // add, remove, promote, demote
      const rawParticipants = d.participants || [];

      // participants can be strings OR objects {id, phoneNumber, admin}
      const names = rawParticipants.map(p => {
        if (typeof p === 'string') {
          const phone = p.split('@')[0];
          return contactNames[p] || formatPhone(phone);
        }
        // Object format from Evolution API
        const phoneJid = typeof p.phoneNumber === 'string' ? p.phoneNumber : '';
        const phone = phoneJid.split('@')[0] || (typeof p.id === 'string' ? p.id.split('@')[0] : '');
        return contactNames[p.id] || (phone && /^\d{10,15}$/.test(phone) ? formatPhone(phone) : phone);
      });

      const actionLabels = { add: 'entrou no grupo', remove: 'saiu do grupo', promote: 'agora e admin', demote: 'nao e mais admin' };
      const label = actionLabels[action] || action;

      names.forEach(name => {
        if (name) appendSystemMessage(name + ' ' + label);
      });

      // Refresh participants panel if open
      if (showPanel) loadParticipants();
    } catch (err) { console.error('SSE group event error:', err); }
  });

  evtSource.addEventListener('CONNECTION_UPDATE', (e) => {
    try {
      const data = JSON.parse(e.data);
      const instName = data.instance || data.data?.instance;
      const state = data.data?.state || data.state;
      if (!instName) return;

      const inst = instances.find(i => i.name === instName);
      if (!inst) return;

      if (state === 'open' && inst.state !== 'open') {
        updateCardStatus(instName, 'open');
        toast('"' + instName + '" conectado!');
      } else if (state === 'close' && inst.state === 'open') {
        // Try auto-restart via SSE event
        attemptAutoRestart(instName);
      }
    } catch {}
  });

  evtSource.onerror = () => {
    sseConnected = false;
    // EventSource auto-reconnects, but if closed permanently, restart after 5s
    if (evtSource.readyState === EventSource.CLOSED) {
      setTimeout(startSSE, 5000);
    }
  };
}

init();
