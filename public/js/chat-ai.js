// =====================
// AI SUGGESTION
// =====================
let aiSuggestLoading = false;

async function requestAiSuggestion() {
  if (!ensureConnected()) return;
  if (!selectedGroup) return toast('Selecione uma conversa primeiro', 'error');
  if (aiSuggestLoading) return;

  const btn = document.getElementById('aiSuggestBtn');
  const input = document.getElementById('msgInput');

  const container = document.getElementById('msgContainer');
  if (!container) return;

  // Re-fetch messages to get structured data
  const jidsToTry = [selectedGroup];
  if (selectedGroupData?.phone) {
    const phone = selectedGroupData.phone;
    jidsToTry.push(phone + '@s.whatsapp.net');
    if (phone.startsWith('55') && phone.length === 13)
      jidsToTry.push(phone.slice(0, 4) + phone.slice(5) + '@s.whatsapp.net');
    else if (phone.startsWith('55') && phone.length === 12)
      jidsToTry.push(phone.slice(0, 4) + '9' + phone.slice(4) + '@s.whatsapp.net');
  }
  if (selectedGroupData?.messageJid && !jidsToTry.includes(selectedGroupData.messageJid))
    jidsToTry.push(selectedGroupData.messageJid);

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

  allMsgs.sort((a, b) => {
    const ta = typeof a.messageTimestamp === 'string' ? parseInt(a.messageTimestamp) : (a.messageTimestamp || 0);
    const tb = typeof b.messageTimestamp === 'string' ? parseInt(b.messageTimestamp) : (b.messageTimestamp || 0);
    return ta - tb;
  });

  const textMsgs = allMsgs
    .map(m => ({ text: getMessageText(m), fromMe: !!m.key?.fromMe }))
    .filter(m => m.text && m.text.trim());

  const last15 = textMsgs.slice(-15);
  if (last15.length === 0) return toast('Nenhuma mensagem de texto encontrada', 'error');

  aiSuggestLoading = true;
  btn.classList.add('loading');
  btn.innerHTML = '<div class="ai-spinner"></div>';

  try {
    const res = await fetch('/ai/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: last15 }),
    });
    const data = await res.json();
    if (res.ok && data.suggestion) {
      input.value = data.suggestion;
      input.focus();
      toast('Sugestao gerada pela IA');
    } else {
      toast(data.error || 'Erro ao gerar sugestao', 'error');
    }
  } catch (err) {
    toast('Erro ao conectar com IA: ' + err.message, 'error');
  } finally {
    aiSuggestLoading = false;
    btn.classList.remove('loading');
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#54656f"><path d="M10 2L8.6 6.6 4 8l4.6 1.4L10 14l1.4-4.6L16 8l-4.6-1.4L10 2zm8 6l-1 3-3 1 3 1 1 3 1-3 3-1-3-1-1-3zm-4 8l-1.5 4.5L8 22l-1.5-1.5L2 19l4.5-1.5L8 13l1.5 4.5z"/></svg>';
  }
}
