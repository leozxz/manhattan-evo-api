const { evoRequest } = require('./evolution');
const { broadcastSSE, clientCount } = require('./sse');

const syncState = {}; // instanceName -> { jid -> { ts, fromMe } }

async function syncChatList() {
  if (clientCount() === 0) return;

  const instances = await evoRequest('GET', '/instance/fetchInstances');
  if (!Array.isArray(instances)) return;

  const connectedNames = instances
    .filter(i => (i.instance?.status || i.connectionStatus) === 'open')
    .map(i => i.instance?.instanceName || i.name || '')
    .filter(Boolean);

  for (const instName of connectedNames) {
    const chats = await evoRequest('POST', '/chat/findChats/' + instName, {});
    if (!Array.isArray(chats)) continue;

    if (!syncState[instName]) syncState[instName] = {};
    const known = syncState[instName];

    chats.forEach(chat => {
      const jid = chat.remoteJid;
      if (!jid || jid === 'status@broadcast' || jid === '0@s.whatsapp.net') return;
      const lm = chat.lastMessage;
      if (!lm) return;
      const ts = typeof lm.messageTimestamp === 'string' ? parseInt(lm.messageTimestamp) : (lm.messageTimestamp || 0);
      if (ts <= 0) return;
      const fromMe = !!lm.key?.fromMe;

      const prev = known[jid];
      if (!prev || ts > prev.ts) {
        const isNew = prev && ts > prev.ts && !fromMe;
        known[jid] = { ts, fromMe };

        if (isNew) {
          broadcastSSE('chat.update', {
            event: 'chat.update',
            instance: instName,
            data: {
              remoteJid: jid,
              pushName: lm.pushName || chat.pushName || '',
              profilePicUrl: chat.profilePicUrl || null,
              lastMessage: lm,
              unreadCount: chat.unreadCount,
              messageTimestamp: ts,
              fromMe: fromMe
            }
          });
        }
      }
    });
  }
}

function startSync() {
  setInterval(syncChatList, 5000);
  setTimeout(syncChatList, 3000);
}

module.exports = { startSync };
