// =====================
// CHAT CORE - Global state & helpers
// =====================
let groupLastMsg = {}; // chatId -> timestamp of last message
try { groupLastMsg = JSON.parse(localStorage.getItem('groupLastMsg') || '{}'); } catch {}
let chatLastSeen = {}; // chatId -> timestamp when user last opened the chat
try { chatLastSeen = JSON.parse(localStorage.getItem('chatLastSeen') || '{}'); } catch {}
let deletedChats = {}; // chatId -> timestamp (persisted, auto-expires after 7 days)
try {
  const raw = JSON.parse(localStorage.getItem('deletedChats') || '{}');
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  for (const k in raw) {
    if (typeof raw[k] === 'number' && now - raw[k] < SEVEN_DAYS) deletedChats[k] = raw[k];
  }
  localStorage.setItem('deletedChats', JSON.stringify(deletedChats));
} catch {}
// phoneIndex: phone (last 8 digits) -> chatId (for dedup)
let phoneIndex = {};
let showPanel = false;
let chatFilter = 'all'; // 'all', 'groups', 'private'
let allChats = []; // unified list: groups + individual chats

// JID helpers (isGroupJid, isPrivateJid, isRealPhone, phoneKey) -> jid-utils.js

async function getSendNumber() {
  if (!selectedGroup) return '';
  if (isGroupJid(selectedGroup)) return selectedGroup;

  const phone = selectedGroupData?.phone || '';
  if (isRealPhone(phone)) return phone;

  const mJid = selectedGroupData?.messageJid || selectedGroup;
  if (isPrivateJid(mJid)) return mJid.split('@')[0];

  const chatId = selectedGroup;
  if (isPrivateJid(chatId)) return chatId.split('@')[0];

  // LID: try to resolve via whatsappNumbers
  try {
    const res = await api('POST', '/chat/whatsappNumbers/' + currentInstance, { numbers: [mJid] });
    if (res.ok && Array.isArray(res.data)) {
      const found = res.data[0];
      if (found?.jid && isPrivateJid(found.jid)) {
        const realPhone = found.jid.split('@')[0];
        if (selectedGroupData) { selectedGroupData.phone = realPhone; rebuildPhoneIndex(); }
        return realPhone;
      }
    }
  } catch {}

  return mJid;
}

function rebuildPhoneIndex() {
  phoneIndex = {};
  allChats.forEach(c => { if (c.phone) phoneIndex[phoneKey(c.phone)] = c.id; });
}

function findChatByPhone(phone) {
  if (!phone) return null;
  const key = phoneKey(phone);
  const id = phoneIndex[key];
  return id ? allChats.find(c => c.id === id) : null;
}

function isDeletedChat(jid) {
  return !!deletedChats[jid];
}

function saveGroupTimestamps() {
  try { localStorage.setItem('groupLastMsg', JSON.stringify(groupLastMsg)); } catch {}
}

// =====================
// MESSAGE UTILITIES
// =====================
function extractMessages(res) {
  if (res && res.messages && Array.isArray(res.messages.records)) {
    return res.messages.records;
  }
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
  if (m.contextInfo && (m.contextInfo.quotedMessage || m.contextInfo.stanzaId)) return m.contextInfo;
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
// SYSTEM EVENTS
// =====================
function getSystemEvents(groupJid) {
  try { return JSON.parse(localStorage.getItem('sysevt_' + groupJid) || '[]'); } catch { return []; }
}

function saveSystemEvent(groupJid, evt) {
  const events = getSystemEvents(groupJid);
  events.push(evt);
  if (events.length > 200) events.splice(0, events.length - 200);
  try { localStorage.setItem('sysevt_' + groupJid, JSON.stringify(events)); } catch {}
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

function previewImage(src) {
  const overlay = document.createElement('div');
  overlay.className = 'img-preview-overlay';
  overlay.onclick = () => overlay.remove();
  overlay.innerHTML = '<img src="' + src + '">';
  document.body.appendChild(overlay);
}
