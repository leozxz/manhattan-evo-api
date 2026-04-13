// =====================
// SEND TEXT MESSAGE
// =====================

async function sendMsg() {
  if (!ensureConnected()) return;
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text || !selectedGroup) return;
  input.value = '';

  // Capture reply state before clearing
  const replyMsg = replyingTo;
  cancelReply();

  // Optimistic UI
  const container = document.getElementById('msgContainer');
  const wrapper = document.createElement('div');
  wrapper.className = 'msg-wrapper msg-wrapper-out';
  const div = document.createElement('div');
  div.className = 'msg msg-out';
  const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  let quotedHtml = '';
  if (replyMsg) {
    const qSender = replyMsg.key?.fromMe ? 'Voce' : (replyMsg.pushName || resolveContactName(replyMsg.key?.participant) || '');
    const qText = getMessageText(replyMsg) || getMediaCaption(replyMsg) || 'Midia';
    quotedHtml = '<div class="msg-quoted"><div class="msg-quoted-sender">' + escapeHtml(qSender) + '</div>' +
      '<div class="msg-quoted-text">' + escapeHtml(qText) + '</div></div>';
  }

  div.innerHTML = quotedHtml + linkifyText(highlightMentions(escapeHtml(text))) + '<span class="msg-time">' + now + '</span>';
  wrapper.appendChild(div);
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
  lastMsgCount++;

  // Build body with mentions
  const { mentioned, everyOne } = parseMentions(text);
  const sendNumber = await getSendNumber();
  console.log('[SEND]', { sendNumber, selectedGroup, phone: selectedGroupData?.phone, messageJid: selectedGroupData?.messageJid });
  if (!sendNumber) { toast('Numero nao encontrado', 'error'); return; }
  const body = { number: sendNumber, text, linkPreview: true };

  if (mentioned.length > 0) body.mentioned = mentioned;
  if (everyOne) body.everyOne = true;
  if (replyMsg && replyMsg.key) {
    body.quoted = {
      key: {
        id: replyMsg.key.id,
        remoteJid: replyMsg.key.remoteJid,
        fromMe: replyMsg.key.fromMe === true
      },
      message: replyMsg.message
    };
    if (replyMsg.key.participant) body.quoted.key.participant = replyMsg.key.participant;
  }

  // Send composing presence before message (anti-ban)
  await sendPresence('composing');
  await new Promise(r => setTimeout(r, randomDelay(1000, 3000)));

  const res = await api('POST', '/message/sendText/' + currentInstance, body);
  if (!res.ok || !res.data || !res.data.key) {
    const errMsg = res.data?.response?.message;
    const isConnErr = typeof errMsg === 'string' && errMsg.includes('Connection') || (Array.isArray(errMsg) && errMsg.some(e => String(e).includes('Connection')));
    toast(isConnErr ? 'Conexao instavel, tente novamente' : 'Erro ao enviar mensagem', 'error');
  } else {
    const chat = allChats.find(c => c.id === selectedGroup);
    if (chat) {
      chat.lastMsgPreview = text.length > 80 ? text.substring(0, 80) + '...' : text;
      chat.lastMsgFromMe = true;
      renderGroupList();
    }
  }

  sendPresence('paused');
}

// =====================
// MEDIA SEND
// =====================
let pendingMediaType = null;

function toggleAttachMenu() {
  const menu = document.getElementById('attachMenu');
  if (menu) menu.classList.toggle('show');
}

function pickMedia(type) {
  toggleAttachMenu();
  pendingMediaType = type;
  const input = document.getElementById('mediaFileInput');
  if (type === 'image') input.accept = 'image/*';
  else if (type === 'video') input.accept = 'video/*';
  else if (type === 'audio') input.accept = 'audio/*';
  else input.accept = '*/*';
  input.value = '';
  input.click();
}

async function handleMediaFile(input) {
  if (!ensureConnected()) return;
  const file = input.files[0];
  if (!file || !selectedGroup) return;
  if (file.size > MAX_MEDIA_SIZE) return toast('Arquivo muito grande (max 16MB)', 'error');

  const replyMsg = replyingTo;
  cancelReply();

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64Full = e.target.result;
    const base64Data = base64Full.split(',')[1];
    const mediatype = pendingMediaType || 'document';

    const container = document.getElementById('msgContainer');
    const div = document.createElement('div');
    div.className = 'msg msg-out';
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    let preview = '';
    if (mediatype === 'image') {
      preview = '<div class="msg-media"><img src="' + base64Full + '" style="max-width:200px;max-height:200px;border-radius:6px"></div>';
    } else if (mediatype === 'video') {
      preview = '<div class="msg-media"><video src="' + base64Full + '" style="max-width:200px" controls></video></div>';
    } else if (mediatype === 'audio') {
      preview = '<div class="msg-media"><audio src="' + base64Full + '" controls></audio></div>';
    } else {
      preview = '<div class="msg-media"><div class="msg-doc"><div class="msg-doc-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg></div><div class="msg-doc-info"><div class="msg-doc-name">' + escapeHtml(file.name) + '</div></div></div></div>';
    }

    div.innerHTML = preview + '<span class="msg-time">' + now + ' enviando...</span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    lastMsgCount++;

    toast('Enviando ' + mediatype + '...');
    const body = {
      number: await getSendNumber(),
      mediatype: mediatype,
      media: base64Data,
      mimetype: file.type || undefined,
      fileName: file.name
    };
    if (replyMsg && replyMsg.key) {
      body.quoted = {
        key: {
          id: replyMsg.key.id,
          remoteJid: replyMsg.key.remoteJid,
          fromMe: replyMsg.key.fromMe === true
        },
        message: replyMsg.message
      };
      if (replyMsg.key.participant) body.quoted.key.participant = replyMsg.key.participant;
    }

    const res = await api('POST', '/message/sendMedia/' + currentInstance, body);
    if (res.ok && res.data && res.data.key) {
      div.querySelector('.msg-time').textContent = now;
      toast('Midia enviada!');
    } else {
      div.querySelector('.msg-time').innerHTML = now + ' <span style="color:#ea0038">erro</span>';
      toast('Erro ao enviar midia', 'error');
    }
  };
  reader.readAsDataURL(file);
}

// =====================
// LOCATION SEND
// =====================
function showLocationModal() {
  toggleAttachMenu();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'locationModal';
  overlay.innerHTML = `
    <div class="modal-box">
      <h3>Enviar localizacao</h3>
      <div class="form-group">
        <label>Latitude</label>
        <input type="text" id="locLat" placeholder="-15.7801">
      </div>
      <div class="form-group">
        <label>Longitude</label>
        <input type="text" id="locLng" placeholder="-47.9292">
      </div>
      <div class="form-group">
        <label>Nome do local (opcional)</label>
        <input type="text" id="locName" placeholder="Ex: Praca dos Tres Poderes">
      </div>
      <div class="form-group">
        <label>Endereco (opcional)</label>
        <input type="text" id="locAddr" placeholder="Ex: Brasilia, DF">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="document.getElementById('locationModal').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="sendLocation()">Enviar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function sendLocation() {
  if (!ensureConnected()) return;
  const lat = parseFloat(document.getElementById('locLat').value);
  const lng = parseFloat(document.getElementById('locLng').value);
  const name = document.getElementById('locName').value.trim();
  const addr = document.getElementById('locAddr').value.trim();

  if (isNaN(lat) || isNaN(lng)) return toast('Latitude e longitude invalidas', 'error');

  document.getElementById('locationModal').remove();

  toast('Enviando localizacao...');
  const body = {
    number: await getSendNumber(),
    name: name || undefined,
    address: addr || undefined,
    latitude: lat,
    longitude: lng
  };

  const res = await api('POST', '/message/sendLocation/' + currentInstance, body);
  if (res.ok && res.data && res.data.key) {
    toast('Localizacao enviada!');
    lastMsgCount = 0;
    fetchAndRenderMessages();
  } else {
    toast('Erro ao enviar localizacao', 'error');
  }
}

// =====================
// BUTTON MESSAGE SEND
// =====================
let buttonRows = [];

function showButtonsModal() {
  toggleAttachMenu();
  buttonRows = [];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'buttonsModal';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:480px">
      <h3>Mensagem com botoes</h3>
      <div class="form-group">
        <label>Titulo</label>
        <input type="text" id="btnTitle" placeholder="Titulo da mensagem" maxlength="60">
      </div>
      <div class="form-group">
        <label>Descricao (opcional)</label>
        <textarea id="btnDesc" placeholder="Texto da mensagem" rows="3" style="width:100%;padding:10px 12px;border:1px solid #dfe5e7;border-radius:8px;font-size:14px;resize:vertical;font-family:inherit"></textarea>
      </div>
      <div class="form-group">
        <label>Rodape (opcional)</label>
        <input type="text" id="btnFooter" placeholder="Texto do rodape" maxlength="60">
      </div>
      <div class="form-group">
        <label>Imagem (URL, opcional)</label>
        <input type="text" id="btnThumb" placeholder="https://exemplo.com/imagem.jpg">
      </div>
      <div style="border-top:1px solid #e9edef;margin:16px 0 12px;padding-top:12px">
        <label style="font-weight:600;font-size:14px">Botoes</label>
        <div id="btnList" style="margin-top:8px"></div>
        <div style="margin-top:8px">
          <select id="btnTypeSelect" style="padding:8px;border:1px solid #dfe5e7;border-radius:8px;font-size:13px">
            <option value="reply">Resposta rapida</option>
            <option value="url">Abrir link</option>
            <option value="call">Ligar</option>
            <option value="copy">Copiar texto</option>
          </select>
          <button class="btn btn-secondary" onclick="addButtonRow()" style="margin-left:6px;padding:8px 12px;font-size:13px">+ Adicionar</button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="document.getElementById('buttonsModal').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="sendButtonMessage()">Enviar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function addButtonRow() {
  const type = document.getElementById('btnTypeSelect').value;
  const maxButtons = type === 'reply' ? 3 : 3;
  if (buttonRows.length >= maxButtons) return toast('Maximo de 3 botoes', 'error');
  if (type === 'reply' && buttonRows.some(b => b.type !== 'reply')) return toast('Botoes de resposta nao podem ser misturados com outros tipos', 'error');
  if (type !== 'reply' && buttonRows.some(b => b.type === 'reply')) return toast('Botoes de resposta nao podem ser misturados com outros tipos', 'error');

  const id = Date.now();
  buttonRows.push({ id, type, displayText: '', value: '' });
  renderButtonRows();
}

function removeButtonRow(id) {
  buttonRows = buttonRows.filter(b => b.id !== id);
  renderButtonRows();
}

function renderButtonRows() {
  const container = document.getElementById('btnList');
  if (!container) return;
  container.innerHTML = buttonRows.map(b => {
    const typeLabels = { reply: 'Resposta', url: 'Link', call: 'Telefone', copy: 'Copiar' };
    const valuePlaceholder = { reply: '', url: 'https://exemplo.com', call: '5511999999999', copy: 'Texto para copiar' };
    const showValue = b.type !== 'reply';
    return `<div class="btn-row" style="display:flex;gap:6px;align-items:center;margin-bottom:6px;padding:8px;background:#f0f2f5;border-radius:8px">
      <span style="font-size:11px;color:#667781;min-width:60px;font-weight:600">${typeLabels[b.type]}</span>
      <input type="text" placeholder="Texto do botao" value="${escapeHtml(b.displayText)}" onchange="updateBtnField(${b.id},'displayText',this.value)" style="flex:1;padding:6px 8px;border:1px solid #dfe5e7;border-radius:6px;font-size:13px">
      ${showValue ? '<input type="text" placeholder="' + valuePlaceholder[b.type] + '" value="' + escapeHtml(b.value) + '" onchange="updateBtnField(' + b.id + ',\'value\',this.value)" style="flex:1;padding:6px 8px;border:1px solid #dfe5e7;border-radius:6px;font-size:13px">' : ''}
      <button onclick="removeButtonRow(${b.id})" style="background:none;border:none;cursor:pointer;color:#ea0038;font-size:18px;padding:0 4px" title="Remover">&times;</button>
    </div>`;
  }).join('');
}

function updateBtnField(id, field, value) {
  const btn = buttonRows.find(b => b.id === id);
  if (btn) btn[field] = value;
}

async function sendButtonMessage() {
  if (!ensureConnected()) return;
  const title = document.getElementById('btnTitle').value.trim();
  const description = document.getElementById('btnDesc').value.trim();
  const footer = document.getElementById('btnFooter').value.trim();
  const thumbnailUrl = document.getElementById('btnThumb').value.trim();

  if (!title) return toast('Titulo e obrigatorio', 'error');
  if (buttonRows.length === 0) return toast('Adicione pelo menos um botao', 'error');

  for (const b of buttonRows) {
    if (!b.displayText.trim()) return toast('Preencha o texto de todos os botoes', 'error');
    if (b.type === 'url' && !b.value.trim()) return toast('Preencha a URL do botao', 'error');
    if (b.type === 'call' && !b.value.trim()) return toast('Preencha o telefone do botao', 'error');
    if (b.type === 'copy' && !b.value.trim()) return toast('Preencha o texto para copiar', 'error');
  }

  const sendNumber = await getSendNumber();
  if (!sendNumber) return toast('Numero nao encontrado', 'error');

  const buttons = buttonRows.map(b => {
    const btn = { type: b.type, displayText: b.displayText.trim() };
    if (b.type === 'reply') btn.id = 'btn_' + Math.random().toString(36).substring(2, 8);
    if (b.type === 'url') btn.url = b.value.trim();
    if (b.type === 'call') btn.phoneNumber = b.value.trim();
    if (b.type === 'copy') btn.copyCode = b.value.trim();
    return btn;
  });

  const body = { number: sendNumber, title };
  if (description) body.description = description;
  if (footer) body.footer = footer;
  if (thumbnailUrl) body.thumbnailUrl = thumbnailUrl;
  body.buttons = buttons;

  document.getElementById('buttonsModal').remove();
  toast('Enviando mensagem com botoes...');

  await sendPresence('composing');
  await new Promise(r => setTimeout(r, randomDelay(1000, 3000)));

  const res = await api('POST', '/message/sendButtons/' + currentInstance, body);
  if (res.ok && res.data && res.data.key) {
    toast('Mensagem com botoes enviada!');
    const chat = allChats.find(c => c.id === selectedGroup);
    if (chat) {
      chat.lastMsgPreview = title;
      chat.lastMsgFromMe = true;
      renderGroupList();
    }
    lastMsgCount = 0;
    fetchAndRenderMessages();
  } else {
    toast('Erro ao enviar mensagem com botoes', 'error');
  }
  sendPresence('paused');
}

// =====================
// PRESENCE (anti-ban)
// =====================
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function sendPresence(type) {
  if (!currentInstance || !selectedGroup) return;
  const number = await getSendNumber();
  if (!number) return;
  try {
    await api('POST', '/chat/sendPresence/' + currentInstance, {
      number,
      presence: type,
      delay: randomDelay(1000, 3000)
    });
  } catch {}
}

// Track remote typing indicators
const typingIndicators = {};

function showTypingIndicator(name) {
  const container = document.getElementById('msgContainer');
  if (!container) return;
  let el = document.getElementById('typingIndicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'typingIndicator';
    el.className = 'typing-indicator-wrapper';
    container.appendChild(el);
  }
  el.innerHTML = '<div class="typing-indicator"><span class="typing-name">' + escapeHtml(name) + '</span> digitando<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span></div>';
  el.style.display = '';
  container.scrollTop = container.scrollHeight;
}

function hideTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.style.display = 'none';
}

// =====================
// AUDIO RECORDING
// =====================
let mediaRecorder = null;
let recordedChunks = [];
let recordingTimerInterval = null;
let recordingStartTime = 0;

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  if (!ensureConnected()) return;
  if (!selectedGroup) return toast('Selecione uma conversa primeiro', 'error');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];

    const mimeType = MediaRecorder.isTypeSupported('audio/ogg; codecs=opus')
      ? 'audio/ogg; codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm; codecs=opus')
        ? 'audio/webm; codecs=opus'
        : 'audio/webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      stopRecordingUI();

      if (recordedChunks.length === 0) return;

      const blob = new Blob(recordedChunks, { type: mimeType });
      if (blob.size > MAX_MEDIA_SIZE) return toast('Audio muito grande (max 16MB)', 'error');
      if (blob.size < 1000) return;

      toast('Enviando audio gravado...');
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });

      await sendPresence('recording');
      await new Promise(r => setTimeout(r, randomDelay(1000, 3000)));

      const sendRes = await api('POST', '/message/sendWhatsAppAudio/' + currentInstance, {
        number: await getSendNumber(),
        audio: base64
      });

      if (sendRes.ok && sendRes.data && sendRes.data.key) {
        toast('Audio enviado!');
        lastMsgCount = 0;
        fetchAndRenderMessages();
      } else {
        toast('Erro ao enviar audio gravado', 'error');
      }
    };

    mediaRecorder.start(250);
    startRecordingUI();
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      toast('Permissao de microfone negada', 'error');
    } else {
      toast('Erro ao iniciar gravacao: ' + err.message, 'error');
    }
  }
}

function startRecordingUI() {
  const msgInput = document.getElementById('msgInput');
  const recordBar = document.getElementById('recordingBar');
  const recordBtn = document.getElementById('recordBtn');
  const sendBtn = document.getElementById('sendBtn');

  if (msgInput) msgInput.style.display = 'none';
  if (recordBar) recordBar.style.display = 'flex';
  if (recordBtn) recordBtn.classList.add('recording');
  if (sendBtn) {
    sendBtn.onclick = () => { if (mediaRecorder) mediaRecorder.stop(); };
    sendBtn.title = 'Enviar audio';
  }

  recordingStartTime = Date.now();
  recordingTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = String(elapsed % 60).padStart(2, '0');
    const timerEl = document.getElementById('recordingTimer');
    if (timerEl) timerEl.textContent = min + ':' + sec;
  }, 500);
}

function stopRecordingUI() {
  const msgInput = document.getElementById('msgInput');
  const recordBar = document.getElementById('recordingBar');
  const recordBtn = document.getElementById('recordBtn');
  const sendBtn = document.getElementById('sendBtn');

  if (msgInput) msgInput.style.display = '';
  if (recordBar) recordBar.style.display = 'none';
  if (recordBtn) recordBtn.classList.remove('recording');
  if (sendBtn) {
    sendBtn.onclick = () => sendMsg();
    sendBtn.title = '';
  }

  if (recordingTimerInterval) {
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
  }
  const timerEl = document.getElementById('recordingTimer');
  if (timerEl) timerEl.textContent = '0:00';
}

function cancelRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    recordedChunks = [];
    mediaRecorder.stop();
  }
  stopRecordingUI();
  toast('Gravacao cancelada');
}

// Close menus when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('attachMenu');
  if (menu && !e.target.closest('.attach-menu') && !e.target.closest('[onclick="toggleAttachMenu()"]')) {
    menu.classList.remove('show');
  }
});
