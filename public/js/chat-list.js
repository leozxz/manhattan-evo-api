// =====================
// CHAT LIST - Loading, filtering, rendering
// =====================

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
    api('GET', '/group/fetchAllGroups/' + currentInstance + '?getParticipants=true')
  ]);

  if (currentInstance !== instanceAtStart) return;

  // Build group metadata map from fetchAllGroups (has subject, size, participants)
  const groupMeta = {};
  if (groupsRes.ok && Array.isArray(groupsRes.data)) {
    groupsRes.data.forEach(g => {
      groupMeta[g.id] = g;
      if (Array.isArray(g.participants)) {
        g._participantNames = g.participants
          .map(p => {
            if (typeof p === 'string') {
              const phone = p.split('@')[0];
              return contactNames[p] || (isRealPhone(phone) ? formatPhone(phone) : '');
            }
            const jid = p.id || '';
            const phoneJid = p.phoneNumber ? String(p.phoneNumber) : '';
            const phone = phoneJid ? phoneJid.split('@')[0] : jid.split('@')[0];
            if (jid.endsWith('@lid') && phoneJid) lidToPhone[jid] = phoneJid;
            const name = p.pushName || p.name || p.notify || p.verifiedName || '';
            if (name && !contactNames[jid]) contactNames[jid] = name;
            if (name && phoneJid && !contactNames[phoneJid]) contactNames[phoneJid] = name;
            return name || contactNames[jid] || contactNames[phoneJid] || (isRealPhone(phone) ? formatPhone(phone) : '');
          })
          .filter(Boolean)
          .slice(0, 5);
      }
    });
  }

  // Process findChats response
  const chatData = chatsRes.ok && Array.isArray(chatsRes.data) ? chatsRes.data : [];

  // Build unified chat list (dedup by phone, filter deleted)
  const chatMap = {};
  const seenPhones = {};
  chatData.forEach(c => {
    const jid = c.remoteJid;
    if (!jid || jid === 'status@broadcast' || jid === '0@s.whatsapp.net') return;
    const lastTs = c.lastMessage?.messageTimestamp || 0;
    const gm = groupMeta[jid];
    const isLid = isLidJid(jid);
    const isPrivate = isPrivateJid(jid) || isLid;
    const isGroup = isGroupJid(jid);

    let resolvedName = c.pushName || '';
    if (!resolvedName && c.lastMessage?.pushName && !c.lastMessage.key?.fromMe) {
      resolvedName = c.lastMessage.pushName;
    }

    const phone = resolvePhoneFromChat(c);

    if (isDeletedChat(jid)) return;

    // Dedup private chats by phone
    if (!isGroup && phone) {
      const pk = phoneKey(phone);
      if (seenPhones[pk]) {
        const existingJid = seenPhones[pk];
        if (isPrivateJid(jid) && !isPrivateJid(existingJid)) {
          delete chatMap[existingJid];
        } else {
          return;
        }
      }
      seenPhones[pk] = jid;
    }

    // Determine unread count
    const lastSeenByPhone = phone ? (chatLastSeen[jid] || Object.keys(chatLastSeen).reduce((best, k) => {
      return k.split('@')[0] && phoneKey(k.split('@')[0]) === phoneKey(phone) ? Math.max(best, chatLastSeen[k]) : best;
    }, 0)) : (chatLastSeen[jid] || 0);
    const msgTs = typeof lastTs === 'string' ? parseInt(lastTs) : lastTs;
    const lastSeen = lastSeenByPhone;
    let unread = 0;
    if (lastSeen >= msgTs) {
      unread = 0;
    } else if (c.unreadCount != null && c.unreadCount > 0) {
      unread = c.unreadCount;
    } else if (msgTs > 0 && !isGroup && c.lastMessage && !c.lastMessage.key?.fromMe) {
      unread = 1;
    }

    // Extract last message preview text
    let lastMsgPreview = '';
    if (c.lastMessage) {
      const lm = c.lastMessage;
      const msg = lm.message || {};
      const inner = msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message || msg;
      const interactive = inner.interactiveMessage;
      if (interactive) {
        lastMsgPreview = interactive.body?.text || '🔘 Mensagem com botoes';
      } else {
        lastMsgPreview = inner.conversation
          || inner.extendedTextMessage?.text
          || (inner.imageMessage ? '📷 Imagem' : '')
          || (inner.videoMessage ? '🎬 Video' : '')
          || (inner.audioMessage ? '🎵 Audio' : '')
          || (inner.documentMessage ? '📄 Documento' : '')
          || (inner.stickerMessage ? '🏷 Sticker' : '')
          || (inner.locationMessage || inner.liveLocationMessage ? '📍 Localizacao' : '')
          || (inner.contactMessage || inner.contactsArrayMessage ? '👤 Contato' : '')
          || '';
      }
      if (lastMsgPreview.length > 80) lastMsgPreview = lastMsgPreview.substring(0, 80) + '...';
    }

    chatMap[jid] = {
      id: jid,
      messageJid: jid,
      isGroup: isGroup,
      subject: gm?.subject || resolvedName || '',
      pushName: resolvedName || '',
      phone: phone,
      size: gm?.size || 0,
      profilePicUrl: c.profilePicUrl || null,
      lastMessageTs: msgTs,
      unreadCount: unread,
      lastMsgPreview: lastMsgPreview,
      lastMsgFromMe: !!c.lastMessage?.key?.fromMe,
      participantNames: gm?._participantNames || []
    };

    if (resolvedName && !contactNames[jid]) contactNames[jid] = resolvedName;
    if (lastTs > (groupLastMsg[jid] || 0)) groupLastMsg[jid] = typeof lastTs === 'string' ? parseInt(lastTs) : lastTs;
  });

  // Ensure all groups from fetchAllGroups are included
  Object.values(groupMeta).forEach(g => {
    if (!chatMap[g.id]) {
      chatMap[g.id] = {
        id: g.id,
        messageJid: g.id,
        isGroup: true,
        subject: g.subject || '',
        pushName: '',
        size: g.size || 0,
        profilePicUrl: null,
        lastMessageTs: groupLastMsg[g.id] || 0,
        unreadCount: 0,
        participantNames: g._participantNames || []
      };
    }
  });

  allChats = Object.values(chatMap);
  groups = allChats.filter(c => c.isGroup);
  rebuildPhoneIndex();

  if (allChats.length === 0) {
    list.innerHTML = '<div class="no-groups"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg><p>' + (chatsRes.ok ? 'Nenhuma conversa encontrada' : 'Erro ao carregar conversas') + '</p></div>';
    return;
  }

  try { localStorage.setItem(cacheKey, JSON.stringify(allChats)); } catch {}
  saveGroupTimestamps();
  renderGroupList();

  // Resolve LID JIDs and fetch missing profile pics in background
  resolveLidPhones();
  fetchMissingProfilePics();
}

async function resolveLidPhones() {
  if (!currentInstance) return;
  const lids = allChats.filter(c => !c.isGroup && !c.phone);
  if (lids.length === 0) return;

  const numbers = lids.map(c => c.id);
  try {
    const res = await api('POST', '/chat/whatsappNumbers/' + currentInstance, { numbers });
    if (!res.ok || !Array.isArray(res.data)) return;

    let changed = false;
    res.data.forEach(r => {
      if (!r.jid || !isPrivateJid(r.jid)) return;
      const phone = r.jid.split('@')[0];
      if (!isRealPhone(phone)) return;
      const chat = allChats.find(c => c.id === r.jid || c.id === r.number + '@s.whatsapp.net' || c.id === r.number + '@lid');
      if (chat && !chat.phone) {
        chat.phone = phone;
        changed = true;
      }
    });

    if (changed) {
      renderGroupList();
      try { localStorage.setItem('chats_' + currentInstance, JSON.stringify(allChats)); } catch {}
    }
  } catch {}
}

async function fetchMissingProfilePics() {
  if (!currentInstance) return;
  const missing = allChats.filter(c => !c.profilePicUrl);
  if (missing.length === 0) return;

  let changed = false;
  const batchSize = 3;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(c =>
      api('POST', '/chat/fetchProfilePictureUrl/' + currentInstance, { number: c.id })
        .then(res => ({ id: c.id, url: res.ok && res.data?.profilePictureUrl ? res.data.profilePictureUrl : null }))
        .catch(() => ({ id: c.id, url: null }))
    ));
    results.forEach(r => {
      if (r.url) {
        const chat = allChats.find(c => c.id === r.id);
        if (chat) { chat.profilePicUrl = r.url; changed = true; }
      }
    });
  }
  if (changed) {
    renderGroupList();
    try { localStorage.setItem('chats_' + currentInstance, JSON.stringify(allChats)); } catch {}
  }
}

async function fetchGroupTimestamps(groupList) {
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

function updateSidebarBadge() {
  let totalGroups = 0, totalPrivate = 0;
  allChats.forEach(c => {
    const u = c.unreadCount || 0;
    if (u > 0) { if (c.isGroup) totalGroups += u; else totalPrivate += u; }
  });
  const total = totalGroups + totalPrivate;

  const badge = document.getElementById('sidebarUnreadBadge');
  if (badge) {
    if (total > 0) { badge.textContent = total > 99 ? '99+' : total; badge.style.display = 'flex'; }
    else { badge.style.display = 'none'; }
  }

  const setTab = (id, count) => { const el = document.getElementById(id); if (el) el.textContent = count > 0 ? (count > 99 ? '99+' : count) : ''; };
  setTab('tabBadgeAll', total);
  setTab('tabBadgeGroups', totalGroups);
  setTab('tabBadgePrivate', totalPrivate);
}

function renderGroupList() {
  updateSidebarBadge();
  const list = document.getElementById('groupList');
  if (!list) return;

  let filtered = allChats;
  if (chatFilter === 'groups') filtered = allChats.filter(c => c.isGroup);
  else if (chatFilter === 'private') filtered = allChats.filter(c => !c.isGroup);

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
    const hasUnread = c.unreadCount > 0;
    item.className = 'chat-item' + (selectedGroup === c.id ? ' active' : '') + (hasUnread ? ' chat-item-unread' : '');
    item.onclick = () => { selectGroup(c, item); };
    const lastTs = groupLastMsg[c.id] || c.lastMessageTs;
    const timeStr = lastTs ? new Date(lastTs < 1e12 ? lastTs * 1000 : lastTs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

    let avatarHtml, displayName, subtitle;
    const groupSvg = '<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>';
    const personSvg = '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

    if (c.isGroup) {
      displayName = c.subject || c.id;
      subtitle = (c.size || '?') + ' participantes';
    } else {
      const phone = c.phone || c.id.split('@')[0];
      const formattedPhone = /^\d{10,15}$/.test(phone) ? formatPhone(phone) : phone;
      const savedName = contactNames[c.id] || c.pushName || '';
      displayName = savedName || formattedPhone;
      subtitle = savedName ? formattedPhone : '';
    }

    if (c.lastMsgPreview) {
      const prefix = c.lastMsgFromMe ? 'Voce: ' : '';
      subtitle = prefix + c.lastMsgPreview;
    }

    if (c.profilePicUrl) {
      avatarHtml = '<img src="' + escapeHtml(c.profilePicUrl) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        '<span class="chat-avatar-fallback" style="display:none">' + (c.isGroup ? groupSvg : personSvg) + '</span>';
    } else {
      avatarHtml = c.isGroup ? groupSvg : personSvg;
    }

    const unreadBadge = c.unreadCount > 0 ? '<span class="chat-unread-badge">' + c.unreadCount + '</span>' : '';

    const chatId = escapeHtml(c.id);
    item.innerHTML = `
      <div class="chat-avatar${c.isGroup ? '' : ' chat-avatar-private'}">
        ${avatarHtml}
      </div>
      <div class="chat-info">
        <div class="chat-name">${escapeHtml(displayName)}</div>
        <div class="chat-preview">${escapeHtml(subtitle)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <div style="display:flex;align-items:center;gap:2px">
          ${timeStr ? '<span class="chat-time" style="font-size:11px;color:#667781">' + timeStr + '</span>' : ''}
          <button class="chat-item-menu-btn" onclick="event.stopPropagation();toggleChatMenu('${chatId}',this)" title="Opcoes">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#667781"><path d="M7 10l5 5 5-5z"/></svg>
          </button>
        </div>
        ${unreadBadge}
      </div>
    `;
    list.appendChild(item);
  });
}

// =====================
// NEW CHAT
// =====================
function showNewChatModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'newChatModal';
  overlay.innerHTML = `
    <div class="modal-box">
      <h3>Nova conversa</h3>
      <div class="form-group">
        <label>Numero (com DDI + DDD)</label>
        <input type="text" id="newChatNumber" placeholder="5511999999999" autofocus>
      </div>
      <div class="form-group" id="newChatStatus" style="display:none"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="document.getElementById('newChatModal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="newChatBtn" onclick="startNewChat()">Iniciar conversa</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('newChatNumber').addEventListener('keydown', (e) => { if (e.key === 'Enter') startNewChat(); });
}

async function startNewChat() {
  if (!ensureConnected()) return;
  const input = document.getElementById('newChatNumber');
  const status = document.getElementById('newChatStatus');
  const btn = document.getElementById('newChatBtn');
  const num = input.value.trim().replace(/[^0-9]/g, '');

  if (!num || num.length < 10) {
    status.style.display = 'block';
    status.innerHTML = '<span style="color:var(--danger);font-size:13px">Numero invalido (use DDI+DDD+numero)</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verificando...';
  status.style.display = 'block';
  status.innerHTML = '<span style="color:var(--text-secondary);font-size:13px">Verificando numero no WhatsApp...</span>';

  const check = await api('POST', '/chat/whatsappNumbers/' + currentInstance, { numbers: [num] });
  if (!check.ok || !Array.isArray(check.data)) {
    status.innerHTML = '<span style="color:var(--danger);font-size:13px">Erro ao verificar numero</span>';
    btn.disabled = false; btn.textContent = 'Iniciar conversa';
    return;
  }

  const found = check.data.find(n => n.exists === true || n.exists === 'true');
  if (!found) {
    status.innerHTML = '<span style="color:var(--danger);font-size:13px">Numero nao esta no WhatsApp</span>';
    btn.disabled = false; btn.textContent = 'Iniciar conversa';
    return;
  }

  document.getElementById('newChatModal').remove();

  const jid = found.jid || (num + '@s.whatsapp.net');
  const phone = jid.split('@')[0];

  let chat = allChats.find(c => c.id === jid || c.phone === phone);
  if (!chat) {
    chat = {
      id: jid,
      messageJid: jid,
      isGroup: false,
      subject: '',
      pushName: found.name || '',
      phone: phone,
      size: 0,
      profilePicUrl: null,
      lastMessageTs: 0,
      unreadCount: 0
    };
    allChats.push(chat);
    if (found.name) contactNames[jid] = found.name;
    renderGroupList();
  }

  selectGroup(chat, null);
  setChatFilter('private');
}

// =====================
// CHAT ITEM MENU
// =====================
let activeChatMenu = null;

function toggleChatMenu(chatId, btn) {
  closeChatMenu();
  const chat = allChats.find(c => c.id === chatId);
  if (!chat) return;

  const menu = document.createElement('div');
  menu.className = 'chat-item-menu';
  menu.id = 'chatItemMenu';

  const unreadLabel = chat.unreadCount > 0 ? 'Marcar como lida' : 'Marcar como nao lida';
  menu.innerHTML = `
    <button onclick="event.stopPropagation();markChatUnread('${escapeHtml(chatId)}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
      ${unreadLabel}
    </button>
    <button class="chat-menu-danger" onclick="event.stopPropagation();deleteChat('${escapeHtml(chatId)}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      Deletar conversa
    </button>
  `;

  const rect = btn.getBoundingClientRect();
  menu.style.top = rect.bottom + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  document.body.appendChild(menu);
  activeChatMenu = menu;

  setTimeout(() => document.addEventListener('click', closeChatMenu, { once: true }), 0);
}

function closeChatMenu() {
  if (activeChatMenu) { activeChatMenu.remove(); activeChatMenu = null; }
}

function markChatUnread(chatId) {
  closeChatMenu();
  const chat = allChats.find(c => c.id === chatId);
  if (!chat) return;

  if (chat.unreadCount > 0) {
    chat.unreadCount = 0;
    chatLastSeen[chatId] = Math.floor(Date.now() / 1000);
    try { localStorage.setItem('chatLastSeen', JSON.stringify(chatLastSeen)); } catch {}
  } else {
    chat.unreadCount = 1;
    delete chatLastSeen[chatId];
    try { localStorage.setItem('chatLastSeen', JSON.stringify(chatLastSeen)); } catch {}
  }
  renderGroupList();
}

function deleteChat(chatId) {
  closeChatMenu();
  if (!confirm('Deletar esta conversa do painel?')) return;

  deletedChats[chatId] = Date.now();
  try { localStorage.setItem('deletedChats', JSON.stringify(deletedChats)); } catch {}

  const idx = allChats.findIndex(c => c.id === chatId);
  if (idx >= 0) allChats.splice(idx, 1);
  const gIdx = groups.findIndex(c => c.id === chatId);
  if (gIdx >= 0) groups.splice(gIdx, 1);
  rebuildPhoneIndex();

  delete groupLastMsg[chatId];
  delete chatLastSeen[chatId];
  saveGroupTimestamps();
  try { localStorage.setItem('chatLastSeen', JSON.stringify(chatLastSeen)); } catch {}
  try { localStorage.setItem('chats_' + currentInstance, JSON.stringify(allChats)); } catch {}

  if (selectedGroup === chatId) {
    selectedGroup = null;
    selectedGroupData = null;
    stopMsgPolling();
    const area = document.getElementById('chatArea');
    if (area) area.innerHTML = '<div class="empty-chat"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>Selecione uma conversa para ver as mensagens</div>';
  }

  renderGroupList();
  toast('Conversa removida do painel');
}
