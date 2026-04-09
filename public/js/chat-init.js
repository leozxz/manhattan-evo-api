// =====================
// WEBHOOK CONFIG
// =====================
let _webhookUrl = null;

async function resolveWebhookUrl() {
  const cfgRes = await api('GET', '/config');
  _webhookUrl = cfgRes.ok ? cfgRes.data?.webhookUrl : null;
  if (_webhookUrl && _webhookUrl.includes('localhost') && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    _webhookUrl = location.origin + '/webhook/internal';
  }
  console.log('[Webhook URL]', _webhookUrl);
}

function configureWebhook(instName) {
  if (!_webhookUrl) return;
  console.log('[Webhook] configuring for', instName, '->', _webhookUrl);
  api('POST', '/webhook/set/' + instName, {
    webhook: {
      enabled: true,
      url: _webhookUrl,
      byEvents: false,
      events: [
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'CONNECTION_UPDATE',
        'GROUP_PARTICIPANTS_UPDATE',
        'CHATS_UPDATE',
        'CHATS_UPSERT',
        'PRESENCE_UPDATE'
      ]
    }
  }).catch(() => {});
}

// =====================
// INIT
// =====================
async function init() {
  await loadCurrentUser();
  const res = await api('GET', '/instance/fetchInstances');
  const rd = res.ok ? res.data : null;
  if (rd && Array.isArray(rd)) {
    const apiInstances = rd.map(r => {
      const name = String(r.instance?.instanceName || r.instanceName || r.name || '');
      const status = r.instance?.status || r.connectionStatus || 'close';
      let state = status === 'open' ? 'open' : 'closed';
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

    // Merge: keep API as source of truth for state, preserve local fields (role)
    const merged = [];
    const seen = new Set();
    const localMap = {};
    instances.forEach(li => { localMap[li.name] = li; });
    apiInstances.forEach(ai => {
      seen.add(ai.name);
      const local = localMap[ai.name] || {};
      merged.push({ name: ai.name, state: ai.state, role: local.role || 'conversacional' });
    });
    instances.forEach(li => {
      if (!seen.has(li.name)) merged.push({ ...li, state: 'closed', role: li.role || 'conversacional' });
    });
    instances = merged;

    // Enable alwaysOnline and configure webhooks for connected instances
    await resolveWebhookUrl();
    for (const inst of instances) {
      if (inst.state !== 'open') continue;
      api('PUT', '/instance/update/' + inst.name, { alwaysOnline: true }).catch(() => {});
      configureWebhook(inst.name);
    }
  }

  if (instances.length > 0 && !currentInstance) currentInstance = instances[0].name;
  saveInstances();
  renderInstances();

  startSSE();
}

// =====================
// SSE (Server-Sent Events)
// =====================
function startSSE() {
  if (typeof EventSource === 'undefined') return;
  const evtSource = new EventSource('/events');

  evtSource.addEventListener('connected', () => {
    sseConnected = true;
  });

  // Group participant events
  evtSource.addEventListener('group-participants.update', (e) => {
    try {
      const payload = JSON.parse(e.data);
      const d = payload.data || payload;
      const groupJid = d.id;
      if (!groupJid || groupJid !== selectedGroup) return;

      const action = d.action;
      const rawParticipants = d.participants || [];

      const names = rawParticipants.map(p => {
        if (typeof p === 'string') {
          const phone = p.split('@')[0];
          return contactNames[p] || formatPhone(phone);
        }
        const phoneJid = typeof p.phoneNumber === 'string' ? p.phoneNumber : '';
        const phone = phoneJid.split('@')[0] || (typeof p.id === 'string' ? p.id.split('@')[0] : '');
        return contactNames[p.id] || (phone && /^\d{10,15}$/.test(phone) ? formatPhone(phone) : phone);
      });

      const actionLabels = { add: 'entrou no grupo', remove: 'saiu do grupo', promote: 'agora e admin', demote: 'nao e mais admin' };
      const label = actionLabels[action] || action;

      names.forEach(name => {
        if (name) appendSystemMessage(name + ' ' + label);
      });

      if (showPanel) loadParticipants();
    } catch (err) { console.error('SSE group event error:', err); }
  });

  // Generic webhook handler
  evtSource.addEventListener('webhook', (e) => {
    try {
      const payload = JSON.parse(e.data);
      const event = payload.event || '';
      console.log('[SSE]', event);

      // Handle presence updates (typing indicators)
      if (event === 'presence.update') {
        const d = payload.data || payload;
        const participantJid = d.id || '';
        const presences = d.presences || d.presence || {};

        const chatJid = Object.keys(presences)[0] || participantJid;
        const presenceData = presences[chatJid] || presences[Object.keys(presences)[0]] || {};
        const status = presenceData.lastKnownPresence || d.status || '';

        const isCurrentChat = chatJid === selectedGroup ||
          participantJid === selectedGroup ||
          (selectedGroupData?.messageJid && (chatJid === selectedGroupData.messageJid || participantJid === selectedGroupData.messageJid));

        if (isCurrentChat && (status === 'composing' || status === 'recording')) {
          const name = contactNames[chatJid] || contactNames[participantJid] || d.pushName || formatPhone(chatJid.split('@')[0] || '');
          showTypingIndicator(name);
          clearTimeout(typingIndicators[chatJid]);
          typingIndicators[chatJid] = setTimeout(() => hideTypingIndicator(), 5000);
        } else if (isCurrentChat && (status === 'paused' || status === 'available')) {
          hideTypingIndicator();
          clearTimeout(typingIndicators[chatJid]);
        }
      }

      // Handle incoming messages
      if (event === 'messages.upsert') {
        const d = payload.data || payload;
        const key = d.key || {};
        if (key.fromMe) return;

        const remoteJid = key.remoteJid || '';
        const remoteJidAlt = key.remoteJidAlt || '';
        const allJids = [remoteJid, remoteJidAlt].filter(Boolean);
        const allPhones = allJids
          .filter(j => isPrivateJid(j))
          .map(j => j.split('@')[0])
          .filter(Boolean);
        if (key.participantAlt && isPrivateJid(key.participantAlt))
          allPhones.push(key.participantAlt.split('@')[0]);

        if (allJids.some(j => isDeletedChat(j))) return;

        // Use centralized JID lookup (checks all variants including phone)
        const mainPhone = allPhones[0] || '';
        let chat = findChatByJid(remoteJid, mainPhone);
        if (!chat && remoteJidAlt) chat = findChatByJid(remoteJidAlt, mainPhone);

        if (chat && (chat.id === selectedGroup || chat.messageJid === selectedGroup)) return;
        if (!chat && selectedGroupData?.phone) {
          const selPk = phoneKey(selectedGroupData.phone);
          if (allPhones.some(ph => phoneKey(ph) === selPk)) return;
        }

        if (!chat) {
          const phoneJid = allJids.find(j => isPrivateJid(j));
          const bestJid = phoneJid || remoteJid;
          const chatPhone = allPhones.find(p => isRealPhone(p)) || '';
          const isGrp = isGroupJid(bestJid);
          chat = {
            id: bestJid,
            messageJid: remoteJid,
            isGroup: isGrp,
            subject: d.pushName || '',
            pushName: d.pushName || '',
            phone: chatPhone,
            size: 0, profilePicUrl: null, lastMessageTs: 0, unreadCount: 0
          };
          allChats.push(chat);
          if (isGrp) groups.push(chat);
          rebuildPhoneIndex();

          if (!chatPhone && !isGrp && currentInstance) {
            api('POST', '/chat/whatsappNumbers/' + currentInstance, { numbers: [remoteJid] }).then(r => {
              if (r.ok && Array.isArray(r.data) && r.data[0]?.jid && isPrivateJid(r.data[0].jid)) {
                chat.phone = r.data[0].jid.split('@')[0];
                chat.messageJid = r.data[0].jid;
                rebuildPhoneIndex();
                renderGroupList();
              }
            }).catch(() => {});
          }
        }

        const inMsg = d.message || {};
        const inPreview = inMsg.conversation
          || inMsg.extendedTextMessage?.text
          || (inMsg.imageMessage ? '📷 Imagem' : '')
          || (inMsg.videoMessage ? '🎬 Video' : '')
          || (inMsg.audioMessage ? '🎵 Audio' : '')
          || (inMsg.documentMessage ? '📄 Documento' : '')
          || (inMsg.stickerMessage ? '🏷 Sticker' : '')
          || (inMsg.locationMessage || inMsg.liveLocationMessage ? '📍 Localizacao' : '')
          || '';
        if (inPreview) {
          chat.lastMsgPreview = inPreview.length > 80 ? inPreview.substring(0, 80) + '...' : inPreview;
          chat.lastMsgFromMe = false;
        }

        chat.unreadCount = (chat.unreadCount || 0) + 1;
        const ts = d.messageTimestamp;
        if (ts) {
          const numTs = typeof ts === 'string' ? parseInt(ts) : ts;
          if (numTs > (groupLastMsg[chat.id] || 0)) {
            groupLastMsg[chat.id] = numTs;
            saveGroupTimestamps();
          }
        }
        if (d.pushName) contactNames[chat.id] = d.pushName;
        renderGroupList();
      }

      // Handle chat.update
      if (event === 'chat.update') {
        const d = payload.data || {};
        const jid = d.remoteJid;
        if (!jid || d.fromMe) return;
        const ts = d.messageTimestamp || 0;
        const phone = isPrivateJid(jid) ? jid.split('@')[0] : '';

        let chat = allChats.find(c => c.id === jid || c.messageJid === jid);
        if (!chat && phone) {
          chat = findChatByPhone(phone);
          if (!chat) {
            const pk = phoneKey(phone);
            chat = allChats.find(c =>
              (c.phone && phoneKey(c.phone) === pk) ||
              (c.id && phoneKey(c.id.split('@')[0]) === pk) ||
              (c.messageJid && phoneKey(c.messageJid.split('@')[0]) === pk)
            );
          }
        }

        if (chat && (chat.id === selectedGroup || chat.messageJid === selectedGroup)) return;
        if (!chat && selectedGroupData?.phone && phone && phoneKey(phone) === phoneKey(selectedGroupData.phone)) return;

        if (!chat) {
          const isGrp = isGroupJid(jid);
          chat = {
            id: jid, messageJid: jid, isGroup: isGrp,
            subject: d.pushName || '', pushName: d.pushName || '', phone: phone,
            size: 0, profilePicUrl: d.profilePicUrl || null,
            lastMessageTs: ts, unreadCount: 0
          };
          allChats.push(chat);
          if (isGrp) groups.push(chat);
          rebuildPhoneIndex();
        }

        const lastSeen = chatLastSeen[chat.id] || 0;
        if (ts > lastSeen) {
          const apiUnread = d.unreadCount;
          chat.unreadCount = (apiUnread != null && apiUnread > 0) ? apiUnread : Math.max(chat.unreadCount, 1);
        }
        if (ts > (groupLastMsg[chat.id] || 0)) {
          groupLastMsg[chat.id] = ts;
          saveGroupTimestamps();
        }
        const lmSync = d.lastMessage?.message || {};
        const syncPreview = lmSync.conversation
          || lmSync.extendedTextMessage?.text
          || (lmSync.imageMessage ? '📷 Imagem' : '')
          || (lmSync.videoMessage ? '🎬 Video' : '')
          || (lmSync.audioMessage ? '🎵 Audio' : '')
          || (lmSync.documentMessage ? '📄 Documento' : '')
          || '';
        if (syncPreview) {
          chat.lastMsgPreview = syncPreview.length > 80 ? syncPreview.substring(0, 80) + '...' : syncPreview;
          chat.lastMsgFromMe = !!d.lastMessage?.key?.fromMe;
        }

        if (d.pushName) contactNames[chat.id] = d.pushName;
        if (!chat.messageJid || chat.messageJid.endsWith('@lid')) chat.messageJid = jid;
        renderGroupList();
      }

      // Handle connection updates
      if (event === 'connection.update') {
        const instName = payload.instance || payload.data?.instance;
        const state = payload.data?.state || '';
        if (!instName) return;
        const inst = instances.find(i => i.name === instName);
        if (!inst) return;
        if (state === 'open' && inst.state !== 'open') {
          updateCardStatus(instName, 'open');
          toast('"' + instName + '" conectado!');
          configureWebhook(instName);
        } else if (state === 'close' && inst.state === 'open') {
          attemptAutoRestart(instName);
        }
      }
    } catch (err) { console.error('[SSE webhook error]', err); }
  });

  // Fallback named listener
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
        attemptAutoRestart(instName);
      }
    } catch {}
  });

  evtSource.onerror = () => {
    sseConnected = false;
    if (evtSource.readyState === EventSource.CLOSED) {
      setTimeout(startSSE, 5000);
    }
  };
}

init();
