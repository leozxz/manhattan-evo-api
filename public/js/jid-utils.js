// =====================
// JID UTILS - Centralized JID normalization & lookup
// =====================

// JID type checks
function isGroupJid(jid) { return jid && jid.endsWith('@g.us'); }
function isPrivateJid(jid) { return jid && jid.endsWith('@s.whatsapp.net'); }
function isLidJid(jid) { return jid && jid.endsWith('@lid'); }
function isRealPhone(num) {
  if (!num || num.length > 15) return false;
  return /^\d{10,13}$/.test(num);
}

// Extract phone number from any JID format
function extractPhoneFromJid(jid) {
  if (!jid) return '';
  if (isPrivateJid(jid)) return jid.split('@')[0];
  return '';
}

// Last 8 digits key for dedup (handles BR 8/9 digit difference)
function phoneKey(phone) { return phone ? phone.slice(-8) : ''; }

// Normalize a JID to its canonical @s.whatsapp.net form when possible
function normalizeJid(jid) {
  if (!jid) return '';
  if (isGroupJid(jid)) return jid;
  if (isPrivateJid(jid)) return jid;
  // LID or unknown — return as-is (needs resolution via API)
  return jid;
}

// Generate all JID variants for a given JID + optional phone
// Handles BR phone number 9th digit ambiguity
function jidVariants(jid, phone) {
  const variants = [];
  if (!jid && !phone) return variants;

  if (jid) variants.push(jid);

  // Determine the phone number to work with
  const p = phone || extractPhoneFromJid(jid);

  if (p && isRealPhone(p)) {
    const pJid = p + '@s.whatsapp.net';
    if (!variants.includes(pJid)) variants.push(pJid);

    // BR numbers: 55 + 2-digit DDD + 8 or 9 digit number
    // With 9th digit: 55 + DD + 9XXXX-XXXX = 13 chars
    // Without 9th digit: 55 + DD + XXXX-XXXX = 12 chars
    if (p.startsWith('55')) {
      if (p.length === 13) {
        // Has 9th digit -> generate variant without it
        const without9 = p.slice(0, 4) + p.slice(5);
        const altJid = without9 + '@s.whatsapp.net';
        if (!variants.includes(altJid)) variants.push(altJid);
      } else if (p.length === 12) {
        // Missing 9th digit -> generate variant with it
        const with9 = p.slice(0, 4) + '9' + p.slice(4);
        const altJid = with9 + '@s.whatsapp.net';
        if (!variants.includes(altJid)) variants.push(altJid);
      }
    }
  }

  return variants;
}

// Extract phone from a chat's lastMessage alt fields (LID resolution)
function extractPhoneFromMessage(lastMessage) {
  if (!lastMessage?.key) return '';
  const remoteAlt = lastMessage.key.remoteJidAlt || '';
  const partAlt = lastMessage.key.participantAlt || '';
  const alt = remoteAlt || partAlt;
  if (alt && isPrivateJid(alt)) return alt.split('@')[0];
  return '';
}

// Resolve phone from a chat object (tries all sources)
function resolvePhoneFromChat(chat) {
  if (!chat) return '';
  const jid = chat.id || chat.remoteJid || '';

  // Direct phone from @s.whatsapp.net JID
  if (isPrivateJid(jid)) return jid.split('@')[0];

  // Stored phone
  if (chat.phone && isRealPhone(chat.phone)) return chat.phone;

  // LID: try alt fields in lastMessage
  if (isLidJid(jid) && chat.lastMessage) {
    return extractPhoneFromMessage(chat.lastMessage);
  }

  return '';
}

// Find a chat in allChats by JID, checking all variants
// Returns the chat object or null
function findChatByJid(jid, phone) {
  const variants = jidVariants(jid, phone);
  if (variants.length === 0) return null;

  // Try exact match on id or messageJid
  for (const v of variants) {
    const chat = allChats.find(c => c.id === v || c.messageJid === v);
    if (chat) return chat;
  }

  // Try phone-based match
  const phones = variants.map(v => extractPhoneFromJid(v)).filter(Boolean);
  for (const ph of phones) {
    const chat = findChatByPhone(ph);
    if (chat) return chat;
  }

  return null;
}

// Check if any variant of a JID matches a target JID/phone
function jidMatches(jid1, jid2) {
  if (!jid1 || !jid2) return false;
  if (jid1 === jid2) return true;

  const phone1 = extractPhoneFromJid(jid1);
  const phone2 = extractPhoneFromJid(jid2);
  if (phone1 && phone2 && phoneKey(phone1) === phoneKey(phone2)) return true;

  return false;
}
