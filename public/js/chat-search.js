// =====================
// CHAT SEARCH
// =====================
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

  results.sort((a, b) => b.matches.length - a.matches.length);
  const queryLower = query.toLowerCase();

  searchResultsEl.innerHTML = '';
  results.forEach(r => {
    const sorted = [...r.matches].sort((a, b) => {
      const tsA = typeof a.timestamp === 'string' ? parseInt(a.timestamp) : (a.timestamp || 0);
      const tsB = typeof b.timestamp === 'string' ? parseInt(b.timestamp) : (b.timestamp || 0);
      return tsB - tsA;
    });

    sorted.forEach(match => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.onclick = () => {
        document.getElementById('chatSearchInput').value = '';
        handleChatSearch('');
        const g = r.group;
        selectGroup(g, null);
      };

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
  const start = Math.max(0, idx - 30);
  const end = Math.min(escaped.length, idx + queryLower.length + 30);
  let snippet = (start > 0 ? '...' : '') + escaped.substring(start, end) + (end < escaped.length ? '...' : '');
  const re = new RegExp('(' + queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return snippet.replace(re, '<mark>$1</mark>');
}
