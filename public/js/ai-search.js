// =====================
// AI SEARCH - Search conversations with AI
// =====================

let aiSearching = false;

async function aiSearch() {
  if (aiSearching) return;
  const input = document.getElementById('aiSearchInput');
  const question = input.value.trim();
  if (!question) return;
  if (!currentInstance) return toast('Conecte uma instancia primeiro', 'error');

  aiSearching = true;
  const btn = document.getElementById('aiSearchBtn');
  const status = document.getElementById('aiSearchStatus');
  const summary = document.getElementById('aiSummary');
  const results = document.getElementById('aiResults');

  btn.disabled = true;
  results.innerHTML = '';
  summary.style.display = 'none';
  status.style.display = 'flex';
  status.innerHTML = '<div class="ai-spinner"></div> Buscando mensagens recentes...';

  try {
    // 1. Fetch recent chats
    const chatsRes = await api('POST', '/chat/findChats/' + currentInstance, {});
    const chats = chatsRes.ok && Array.isArray(chatsRes.data) ? chatsRes.data : [];

    // Filter to recent active chats (last 7 days), skip groups for now, limit to 30
    const now = Date.now() / 1000;
    const recentChats = chats
      .filter(c => {
        const ts = c.lastMessage?.messageTimestamp || 0;
        return ts > now - 7 * 86400 && c.remoteJid && c.remoteJid !== 'status@broadcast';
      })
      .sort((a, b) => (b.lastMessage?.messageTimestamp || 0) - (a.lastMessage?.messageTimestamp || 0))
      .slice(0, 30);

    if (recentChats.length === 0) {
      status.innerHTML = 'Nenhuma conversa recente encontrada.';
      aiSearching = false;
      btn.disabled = false;
      return;
    }

    // 2. Fetch messages from each chat (batch of 6)
    status.innerHTML = '<div class="ai-spinner"></div> Lendo ' + recentChats.length + ' conversas...';

    const allMessages = [];
    const contactMap = {}; // id -> name

    for (let i = 0; i < recentChats.length; i += 6) {
      const batch = recentChats.slice(i, i + 6);
      const fetches = batch.map(async (chat) => {
        const jid = chat.remoteJid;
        const jids = jidVariants(jid, '');
        let msgs = [];
        for (const j of jids) {
          const r = await api('POST', '/chat/findMessages/' + currentInstance, {
            where: { key: { remoteJid: j } }, offset: 30, page: 1
          });
          const m = extractMessages(r.ok ? r.data : null);
          msgs = msgs.concat(m);
        }

        // Dedup by message id
        const seen = new Set();
        const contactName = chat.pushName || contactNames[jid] || jid.split('@')[0];
        contactMap[jid] = contactName;

        msgs.forEach(m => {
          const mid = m.key?.id;
          if (!mid || seen.has(mid)) return;
          seen.add(mid);
          const text = getMessageText(m) || getMediaCaption(m);
          if (!text) return;
          allMessages.push({
            id: mid,
            contact: contactName,
            contactJid: jid,
            text: text,
            fromMe: !!m.key?.fromMe,
            timestamp: Number(m.messageTimestamp) || 0,
            pushName: m.pushName || contactName
          });
        });
      });
      await Promise.all(fetches);
    }

    if (allMessages.length === 0) {
      status.innerHTML = 'Nenhuma mensagem com texto encontrada.';
      aiSearching = false;
      btn.disabled = false;
      return;
    }

    // Sort by timestamp and limit to most recent 500
    allMessages.sort((a, b) => b.timestamp - a.timestamp);
    const limitedMsgs = allMessages.slice(0, 500);

    status.innerHTML = '<div class="ai-spinner"></div> Analisando ' + limitedMsgs.length + ' mensagens com IA...';

    // 3. Call AI search endpoint
    const aiRes = await api('POST', '/ai/search', {
      question,
      messages: limitedMsgs.map(m => ({
        id: m.id,
        contact: m.fromMe ? 'EU' : m.contact,
        text: m.text,
        fromMe: m.fromMe,
        timestamp: m.timestamp
      })),
      contacts: [...new Set(Object.values(contactMap))]
    });

    if (!aiRes.ok || !aiRes.data) {
      status.innerHTML = 'Erro ao consultar IA: ' + (aiRes.data?.error || 'tente novamente');
      aiSearching = false;
      btn.disabled = false;
      return;
    }

    const { results: matches, summary: aiSummaryText } = aiRes.data;

    // 4. Show summary
    if (aiSummaryText) {
      summary.textContent = aiSummaryText;
      summary.style.display = 'block';
    }

    // 5. Show results
    if (!matches || matches.length === 0) {
      status.innerHTML = 'Nenhuma mensagem relevante encontrada.';
      aiSearching = false;
      btn.disabled = false;
      return;
    }

    status.style.display = 'none';
    results.innerHTML = '';

    matches.forEach(match => {
      const origMsg = limitedMsgs.find(m => m.id === match.id);
      if (!origMsg) return;

      const ts = origMsg.timestamp;
      const date = new Date(ts * 1000);
      const timeStr = date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

      const card = document.createElement('div');
      card.className = 'ai-result-card';
      card.innerHTML = `
        <div class="ai-result-header">
          <div class="ai-result-avatar">${(origMsg.contact || '?').charAt(0).toUpperCase()}</div>
          <div class="ai-result-info">
            <span class="ai-result-name">${escapeHtml(origMsg.contact)}</span>
            <span class="ai-result-time">${timeStr}</span>
          </div>
        </div>
        <div class="ai-result-text">${escapeHtml(origMsg.text)}</div>
        ${match.reason ? '<div class="ai-result-reason">' + escapeHtml(match.reason) + '</div>' : ''}
      `;

      // Click to open the chat
      card.style.cursor = 'pointer';
      card.onclick = () => {
        const chat = findChatByJid(origMsg.contactJid);
        if (chat) {
          showPage('chat');
          if (typeof selectGroup === 'function') selectGroup(chat.id);
        }
      };

      results.appendChild(card);
    });

  } catch (err) {
    status.innerHTML = 'Erro: ' + (err.message || 'falha inesperada');
  }

  aiSearching = false;
  btn.disabled = false;
}
