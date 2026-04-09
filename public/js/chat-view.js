// =====================
// CHAT VIEW - Selection, layout, message rendering
// =====================

async function selectGroup(chat, el) {
  selectedGroup = chat.id;
  selectedGroupData = chat;
  showPanel = false;
  mediaCacheClear();
  cancelReply();
  closeMentionDropdown();

  const isGroup = chat.isGroup !== undefined ? chat.isGroup : isGroupJid(chat.id);

  // Mark as read
  const chatRef = allChats.find(c => c.id === chat.id) || chat;
  chatRef.unreadCount = 0;
  chatLastSeen[chat.id] = Math.floor(Date.now() / 1000);
  try { localStorage.setItem('chatLastSeen', JSON.stringify(chatLastSeen)); } catch {}
  renderGroupList();

  document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');

  // Mobile: open chat view
  const layout = document.querySelector('.chat-layout');
  if (layout) layout.classList.add('chat-open');

  // Resolve display name
  let displayName;
  let avatarHtml;
  const headerGroupSvg = '<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3z"/></svg>';
  const headerPersonSvg = '<svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  if (isGroup) {
    displayName = chat.subject || chat.id;
  } else {
    const phone = chat.phone || chat.id.split('@')[0];
    const formattedPhone = /^\d{10,15}$/.test(phone) ? formatPhone(phone) : phone;
    const savedName = contactNames[chat.id] || chat.pushName || '';
    displayName = savedName || formattedPhone;
  }
  if (chat.profilePicUrl) {
    avatarHtml = '<img src="' + escapeHtml(chat.profilePicUrl) + '" class="chat-avatar-img" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
      '<span class="chat-avatar-fallback" style="display:none">' + (isGroup ? headerGroupSvg : headerPersonSvg) + '</span>';
  } else {
    avatarHtml = isGroup ? headerGroupSvg : headerPersonSvg;
  }

  // Panel button only for groups (knowledge panel always open for private)
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
            ${avatarHtml}
          </div>
          <div class="chat-header-info" ${isGroup ? 'onclick="togglePanel()"' : 'onclick="openSaveContactModal()"'} style="cursor:pointer">
            <div class="chat-name">${escapeHtml(displayName)}</div>
            <div class="chat-header-subtitle" id="chatHeaderSubtitle"></div>
          </div>
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
          <input type="file" id="mediaFileInput" style="display:none" onchange="handleMediaFile(this)">
          <button class="btn btn-secondary" onclick="toggleAttachMenu()" style="border-radius:50%;width:40px;height:40px;padding:0;flex-shrink:0" title="Anexar arquivo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#54656f"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
          </button>
          <button class="ai-suggest-btn" id="aiSuggestBtn" onclick="requestAiSuggestion()" title="Sugestao IA">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#54656f"><path d="M10 2L8.6 6.6 4 8l4.6 1.4L10 14l1.4-4.6L16 8l-4.6-1.4L10 2zm8 6l-1 3-3 1 3 1 1 3 1-3 3-1-3-1-1-3zm-4 8l-1.5 4.5L8 22l-1.5-1.5L2 19l4.5-1.5L8 13l1.5 4.5z"/></svg>
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
      </div>` : `<div class="group-panel knowledge-panel" id="knowledgePanel" style="display:flex">
        <div class="group-panel-header">
          <span style="font-size:13px;font-weight:700">Perfil do Cliente</span>
          <div class="header-spacer"></div>
          <div class="polling-indicator"><div class="polling-dot"></div> ao vivo</div>
          <button class="btn btn-secondary btn-sm" onclick="forceRefreshPanel()" title="Atualizar perfil">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#54656f"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="openKnowledgeGraph()" title="Visualizar grafo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#54656f"><circle cx="5" cy="12" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="19" cy="18" r="2.5"/><line x1="7.5" y1="12" x2="16.5" y2="6" stroke="#54656f" stroke-width="1.5"/><line x1="7.5" y1="12" x2="16.5" y2="18" stroke="#54656f" stroke-width="1.5"/></svg>
          </button>
        </div>
        <div class="group-panel-body" id="knowledgePanelBody">
          <div class="spinner" style="margin-top:40px"></div>
        </div>
      </div>`}
    </div>
  `;

  // Populate header subtitle
  const subtitleEl = document.getElementById('chatHeaderSubtitle');
  if (subtitleEl && isGroup) {
    if (chat.participantNames && chat.participantNames.length > 0) {
      let membersText = chat.participantNames.join(', ');
      if (chat.size > chat.participantNames.length) membersText += ', +' + (chat.size - chat.participantNames.length);
      subtitleEl.textContent = membersText;
    } else {
      subtitleEl.textContent = (chat.size || '') + (chat.size ? ' participantes' : '');
    }
  } else if (subtitleEl && !isGroup) {
    const savedName = contactNames[chat.id] || chat.pushName || '';
    const phone = chat.phone || chat.id.split('@')[0];
    if (savedName) {
      // Name is title, phone is subtitle
      subtitleEl.textContent = /^\d{10,15}$/.test(phone) ? formatPhone(phone) : phone;
    } else {
      subtitleEl.textContent = '';
    }
  }

  await fetchAndRenderMessages();
  if (isGroup) loadCachedParticipants();
  else {
    // Auto-open panel for private chats
    showKnowledgePanel = true;
    const kp = document.getElementById('knowledgePanel');
    if (kp) kp.style.display = 'flex';
    loadUnifiedPanel();
  }
  renderPinnedBanner();
  startMsgPolling();
}

function closeMobileChat() {
  const layout = document.querySelector('.chat-layout');
  if (layout) layout.classList.remove('chat-open');
}

// =====================
// MESSAGE RENDERING
// =====================
async function fetchAndRenderMessages() {
  if (!selectedGroup || !currentInstance) return;

  const messageJid = selectedGroupData?.messageJid || selectedGroup;
  const phone = selectedGroupData?.phone || '';

  // Build list of JIDs to try (centralized in jid-utils.js)
  const jidsToTry = jidVariants(messageJid, phone);

  // Query ALL JIDs and merge results
  const dedupIds = new Set();
  let allMsgs = [];
  for (const jid of jidsToTry) {
    const r = await api('POST', '/chat/findMessages/' + currentInstance, {
      where: { key: { remoteJid: jid } }, offset: 100, page: 1
    });
    const msgs = extractMessages(r.ok ? r.data : null);
    msgs.forEach(m => {
      const mid = m.key?.id || m.id;
      if (mid && !dedupIds.has(mid)) { dedupIds.add(mid); allMsgs.push(m); }
    });
  }

  const res = { ok: true, data: { messages: { total: allMsgs.length, records: allMsgs } } };

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
    // Merge regular messages with system events
    const allItems = msgs.map(m => ({ type: 'msg', data: m, ts: typeof m.messageTimestamp === 'string' ? parseInt(m.messageTimestamp) : (m.messageTimestamp || 0) }));
    sysEvents.forEach(evt => { allItems.push({ type: 'sys', data: evt, ts: evt.ts || 0 }); });
    allItems.sort((a, b) => a.ts - b.ts);

    const sorted = allItems.filter(i => i.type === 'msg').map(i => i.data);

    // Track last message timestamp
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

    // Build reaction map and contact names
    const reactionMap = buildReactionMap(sorted);
    sorted.forEach(m => {
      if (m.key?.fromMe) return;
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
      if (m.messageType === 'reactionMessage') return;

      const key = m.key || {};
      const isOut = key.fromMe === true;
      const text = getMessageText(m);
      const mediaType = getMediaType(m);
      const caption = getMediaCaption(m);

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
      const isPrivateChat = selectedGroupData && !selectedGroupData.isGroup;
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

      // Hover actions
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

      // Quoted message block
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

      // Reactions
      const reactions = getReactionsForMsg(reactionMap, key.id);
      if (reactions.length > 0) {
        const reactionsDiv = document.createElement('div');
        reactionsDiv.className = 'msg-reactions';
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

    if (wasAtBottom || lastMsgCount <= total) {
      container.scrollTop = container.scrollHeight;
      requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
    }

    // Lazy-load media
    mediaToLoad.forEach(m => loadMediaForMsg(m));
  } else {
    container.innerHTML = '<div style="text-align:center;color:#667781;padding:40px">Nenhuma mensagem ainda</div>';
  }
}

// =====================
// MESSAGE POLLING
// =====================
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
