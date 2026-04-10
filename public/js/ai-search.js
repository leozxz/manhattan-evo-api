// =====================
// AI SEARCH - Search conversations with AI
// =====================

let aiSearching = false;

function aiSuggestClick(btn) {
  const input = document.getElementById('aiSearchInput');
  input.value = btn.textContent;
  aiSearch();
}

function formatTsForAi(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return 'hoje ' + time;
  if (isYesterday) return 'ontem ' + time;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + time;
}

async function aiSearch() {
  if (aiSearching) return;
  const input = document.getElementById('aiSearchInput');
  const question = input.value.trim();
  if (!question) return;
  if (!currentInstance) return toast('Conecte uma instancia primeiro', 'error');

  aiSearching = true;
  const btn = document.getElementById('aiSearchBtn');
  const status = document.getElementById('aiSearchStatus');
  const summaryEl = document.getElementById('aiSummary');
  const resultsEl = document.getElementById('aiResults');

  btn.disabled = true;
  document.querySelector('.ai-search-card')?.classList.add('ai-searching');
  // Keep min-height to prevent layout jump
  const currentH = resultsEl.offsetHeight + (summaryEl.offsetHeight || 0);
  if (currentH > 100) resultsEl.style.minHeight = currentH + 'px';
  resultsEl.innerHTML = '';
  summaryEl.style.display = 'none';
  status.style.display = 'flex';
  status.innerHTML = '<div class="ai-spinner"></div> Buscando conversas recentes...';
  const suggestionsEl = document.getElementById('aiSuggestions');
  if (suggestionsEl) suggestionsEl.style.display = 'none';

  try {
    // 1. Fetch recent chats
    const chatsRes = await api('POST', '/chat/findChats/' + currentInstance, {});
    const chats = chatsRes.ok && Array.isArray(chatsRes.data) ? chatsRes.data : [];

    const now = Date.now() / 1000;
    const recentChats = chats
      .filter(c => {
        const ts = c.lastMessage?.messageTimestamp || 0;
        return ts > now - 7 * 86400 && c.remoteJid && c.remoteJid !== 'status@broadcast' && c.remoteJid !== '0@s.whatsapp.net';
      })
      .sort((a, b) => (b.lastMessage?.messageTimestamp || 0) - (a.lastMessage?.messageTimestamp || 0))
      .slice(0, 40);

    if (recentChats.length === 0) {
      status.innerHTML = 'Nenhuma conversa recente encontrada.';
      aiSearching = false; btn.disabled = false; return;
    }

    // 2. Fetch messages from each chat (batch of 8)
    status.innerHTML = '<div class="ai-spinner"></div> Lendo ' + recentChats.length + ' conversas...';

    const allMessages = [];
    const contactMap = {};

    for (let i = 0; i < recentChats.length; i += 8) {
      const batch = recentChats.slice(i, i + 8);
      const fetches = batch.map(async (chat) => {
        const jid = chat.remoteJid;
        const variants = jidVariants(jid, '');
        let msgs = [];
        for (const j of variants) {
          const r = await api('POST', '/chat/findMessages/' + currentInstance, {
            where: { key: { remoteJid: j } }, offset: 50, page: 1
          });
          msgs = msgs.concat(extractMessages(r.ok ? r.data : null));
        }

        const seen = new Set();
        const contactName = chat.pushName || contactNames[jid] || jid.split('@')[0];
        contactMap[jid] = contactName;

        msgs.forEach(m => {
          const mid = m.key?.id;
          if (!mid || seen.has(mid)) return;
          seen.add(mid);
          const text = getMessageText(m) || getMediaCaption(m);
          if (!text || text.length < 2) return;
          const ts = Number(m.messageTimestamp) || 0;
          if (ts < now - 7 * 86400) return; // skip old messages
          allMessages.push({
            id: mid,
            contact: m.key?.fromMe ? 'EU' : (m.pushName || contactName),
            contactJid: jid,
            contactName: contactName,
            text: text,
            fromMe: !!m.key?.fromMe,
            timestamp: ts,
            dateStr: formatTsForAi(ts)
          });
        });
      });
      await Promise.all(fetches);
    }

    if (allMessages.length === 0) {
      status.innerHTML = 'Nenhuma mensagem com texto encontrada.';
      aiSearching = false; btn.disabled = false; return;
    }

    // Sort by time (newest first) and limit
    allMessages.sort((a, b) => b.timestamp - a.timestamp);
    const limited = allMessages.slice(0, 600);

    status.innerHTML = '<div class="ai-spinner"></div> Analisando ' + limited.length + ' mensagens com IA...';

    // 3. Build messages with readable timestamps and index-based IDs
    const indexed = limited.map((m, i) => ({ ...m, idx: i }));
    const msgLines = indexed.map(m =>
      '[' + m.idx + '] (' + m.dateStr + ') ' + m.contact + ': ' + m.text
    );

    const aiRes = await api('POST', '/ai/search', {
      question,
      messages: indexed.map(m => ({
        id: String(m.idx),
        contact: m.contact,
        text: m.text,
        fromMe: m.fromMe,
        timestamp: m.timestamp
      })),
      contacts: [...new Set(Object.values(contactMap))],
      messageLines: msgLines.join('\n')
    });

    if (!aiRes.ok || !aiRes.data) {
      status.innerHTML = 'Erro ao consultar IA: ' + (aiRes.data?.error || 'tente novamente');
      aiSearching = false; btn.disabled = false; return;
    }

    const { results: matches, summary: aiSummaryText } = aiRes.data;

    if (aiSummaryText) {
      summaryEl.textContent = aiSummaryText;
      summaryEl.style.display = 'block';
      summaryEl.classList.remove('ai-summary-enter');
      void summaryEl.offsetWidth; // force reflow
      summaryEl.classList.add('ai-summary-enter');
    }

    if (!matches || matches.length === 0) {
      status.innerHTML = 'Nenhuma mensagem relevante encontrada.';
      aiSearching = false; btn.disabled = false; return;
    }

    status.style.display = 'none';
    resultsEl.innerHTML = '';
    resultsEl.style.minHeight = '';

    // Group matches by contact
    const grouped = {};
    matches.forEach(match => {
      const idx = parseInt(match.id, 10);
      const origMsg = indexed[idx];
      if (!origMsg) return;
      const key = origMsg.contactJid || origMsg.contactName;
      if (!grouped[key]) {
        grouped[key] = { contactName: origMsg.contactName, contactJid: origMsg.contactJid, messages: [] };
      }
      grouped[key].messages.push({ ...origMsg, reason: match.reason });
    });

    let cardIdx = 0;
    Object.values(grouped).forEach(group => {
      const initials = (group.contactName || '?').charAt(0).toUpperCase();

      const card = document.createElement('div');
      card.className = 'ai-result-card';

      let msgsHtml = group.messages.map(m => {
        const date = new Date(m.timestamp * 1000);
        const timeStr = date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `
          <div class="ai-msg-item">
            <div class="ai-msg-bubble">
              <span class="ai-msg-text">${escapeHtml(m.text)}</span>
              <span class="ai-msg-time">${timeStr}</span>
            </div>
            ${m.reason ? '<div class="ai-result-reason">' + escapeHtml(m.reason) + '</div>' : ''}
          </div>
        `;
      }).join('');

      card.innerHTML = `
        <div class="ai-result-header">
          <div class="ai-result-avatar">${initials}</div>
          <div class="ai-result-info">
            <span class="ai-result-name">${escapeHtml(group.contactName)}</span>
            <span class="ai-result-count">${group.messages.length} mensage${group.messages.length !== 1 ? 'ns' : 'm'}</span>
          </div>
          <div class="ai-result-open">Abrir conversa &rarr;</div>
        </div>
        <div class="ai-msg-list">${msgsHtml}</div>
      `;

      card.onclick = (e) => {
        if (e.target.closest('.ai-msg-item')) return openChatFromAi(group.contactJid);
        openChatFromAi(group.contactJid);
      };
      card.style.animationDelay = (cardIdx * 0.1) + 's';
      card.classList.add('ai-result-enter');
      cardIdx++;
      resultsEl.appendChild(card);
    });

  } catch (err) {
    status.innerHTML = 'Erro: ' + (err.message || 'falha inesperada');
  }

  aiSearching = false;
  btn.disabled = false;
  document.querySelector('.ai-search-card')?.classList.remove('ai-searching');
}

function openChatFromAi(jid) {
  // Find the chat object
  let chat = findChatByJid(jid);
  if (!chat) {
    // Try allChats directly
    chat = allChats.find(c => c.id === jid || c.messageJid === jid);
  }
  if (!chat) {
    toast('Conversa nao encontrada', 'error');
    return;
  }
  showPage('chat');
  // Small delay to ensure page is visible before selecting
  setTimeout(() => {
    if (typeof selectGroup === 'function') selectGroup(chat);
  }, 100);
}
