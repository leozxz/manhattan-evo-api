// =====================
// REPLY STATE
// =====================
let replyingTo = null;

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
let cachedParticipants = [];
let mentionActiveIndex = 0;

const lidToPhone = {}; // LID JID -> phone number

function resolveContactName(jid) {
  if (!jid) return '';
  if (contactNames[jid]) return contactNames[jid];
  if (jid.endsWith('@lid') && lidToPhone[jid]) {
    return contactNames[lidToPhone[jid]] || formatPhone(lidToPhone[jid].split('@')[0]);
  }
  const raw = jid.split('@')[0];
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
    if (jid.endsWith('@lid') && phoneJid) lidToPhone[jid] = phoneJid;
    const apiName = p.pushName || p.name || p.notify || p.verifiedName || '';
    if (!contactNames[jid] && apiName) contactNames[jid] = apiName;
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
      const p = cachedParticipants.find(pp => pp.number === ref);
      if (p) mentioned.push(p.number);
    }
  }
  return { mentioned, everyOne };
}

function highlightMentions(escapedHtml) {
  return escapedHtml.replace(/@(\S+)/g, (match, ref) => {
    if (ref.toLowerCase() === 'all' || ref.toLowerCase() === 'todos') {
      return '<span class="msg-mention">@todos</span>';
    }
    const p = cachedParticipants.find(pp => pp.number === ref);
    const name = p ? (contactNames[p.id] || p.name || ref) : ref;
    return '<span class="msg-mention">@' + escapeHtml(name) + '</span>';
  });
}

function linkifyText(escapedHtml) {
  return escapedHtml.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="msg-link">$1</a>');
}

// =====================
// MEDIA CACHE & LOADING
// =====================
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

// =====================
// MESSAGE CONTEXT MENU
// =====================
let activeMsgMenu = null;

function showMsgContextMenu(wrapper, msg, msgKey, arrowBtn) {
  closeMsgContextMenu();

  const menu = document.createElement('div');
  menu.className = 'msg-context-menu';
  menu.id = 'msgContextMenu';

  const isOut = wrapper.classList.contains('msg-wrapper-out');

  // Reply option
  const replyItem = document.createElement('div');
  replyItem.className = 'msg-context-item';
  replyItem.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg> Responder';
  replyItem.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMsgContextMenu();
    setReplyTo(msg);
  });
  menu.appendChild(replyItem);

  // React option (opens emoji picker inline)
  const reactItem = document.createElement('div');
  reactItem.className = 'msg-context-item';
  reactItem.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg> Reagir';
  reactItem.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMsgContextMenu();
    showReactionPicker(wrapper, msgKey);
  });
  menu.appendChild(reactItem);

  // Position the menu relative to the message bubble
  const msgDiv = wrapper.querySelector('.msg');
  if (msgDiv) {
    msgDiv.style.position = 'relative';
    menu.style.top = '0';
    if (isOut) {
      menu.style.right = '0';
    } else {
      menu.style.left = '0';
    }
    msgDiv.appendChild(menu);
  }

  activeMsgMenu = menu;

  setTimeout(() => {
    document.addEventListener('click', closeMsgContextMenu, { once: true });
  }, 0);
}

function closeMsgContextMenu() {
  if (activeMsgMenu) {
    activeMsgMenu.remove();
    activeMsgMenu = null;
  }
}

// =====================
// REACTIONS
// =====================
const REACTION_EMOJIS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}', '\u{1F525}', '\u{1F389}'];
let activeReactionPicker = null;

function buildReactionMap(allMessages) {
  const map = {};
  allMessages.forEach(m => {
    if (m.messageType === 'reactionMessage' && m.message?.reactionMessage) {
      const rm = m.message.reactionMessage;
      const targetId = rm.key?.id;
      const emoji = rm.text;
      if (targetId && emoji) {
        if (!map[targetId]) map[targetId] = [];
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
    lastMsgCount = 0;
    fetchAndRenderMessages();
  } else {
    const errMsg = res.data?.response?.message;
    const isConnErr = typeof errMsg === 'string' && errMsg.includes('Connection') || (Array.isArray(errMsg) && errMsg.some(e => String(e).includes('Connection')));
    toast(isConnErr ? 'Conexao instavel, tente novamente' : 'Erro ao enviar reacao', 'error');
  }
}
