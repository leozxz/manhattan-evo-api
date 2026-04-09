// =====================
// GROUP CREATION
// =====================
let groupParticipants = [];
let groupImageBase64 = null;
let selectedMsgType = 'single';

// Pitches — each pitch is an array of messages sent in sequence
const pitches = {
  'Boas-vindas': [
    'Olá',
    'Tudo bem?'
  ],
};

// Populate pitch select on load
function initPitchSelect() {
  const sel = document.getElementById('pitchSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Nenhum --</option>';
  Object.keys(pitches).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name + ' (' + pitches[name].length + ' msgs)';
    sel.appendChild(opt);
  });
}

function switchMsgType(type) {
  selectedMsgType = type;
  document.querySelectorAll('.gc-tab').forEach(t => t.classList.toggle('active', t.dataset.type === type));
  document.getElementById('msgTypeSingle').style.display = type === 'single' ? '' : 'none';
  document.getElementById('msgTypePitch').style.display = type === 'pitch' ? '' : 'none';
}

function previewPitch() {
  const name = document.getElementById('pitchSelect').value;
  const preview = document.getElementById('pitchPreview');
  if (!name || !pitches[name]) { preview.innerHTML = ''; return; }
  preview.innerHTML = pitches[name].map((msg, i) =>
    '<div class="pitch-msg"><span class="pitch-num">' + (i + 1) + '</span>' + escapeHtml(msg) + '</div>'
  ).join('');
}

// Init on page load
document.addEventListener('DOMContentLoaded', initPitchSelect);

function addParticipant() {
  const input = document.getElementById('participantInput');
  const num = input.value.trim().replace(/[^0-9]/g, '');
  if (!num || num.length < 10) return toast('Numero invalido', 'error');
  if (groupParticipants.includes(num)) return toast('Numero ja adicionado', 'error');
  groupParticipants.push(num);
  input.value = '';
  renderParticipants();
}

function removeParticipant(num) {
  groupParticipants = groupParticipants.filter(p => p !== num);
  renderParticipants();
}

function renderParticipants() {
  const el = document.getElementById('participantsList');
  if (groupParticipants.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = groupParticipants.map(p =>
    '<div class="participant-chip">' +
      '<span>' + p + '</span>' +
      '<button onclick="removeParticipant(\'' + p + '\')">&times;</button>' +
    '</div>'
  ).join('');
}

function previewGroupImage(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    groupImageBase64 = e.target.result;
    document.getElementById('groupImagePreview').innerHTML =
      '<img src="' + groupImageBase64 + '">';
    document.getElementById('btnRemoveImg').style.display = 'inline';
  };
  reader.readAsDataURL(file);
}

function removeGroupImage() {
  groupImageBase64 = null;
  document.getElementById('groupImageInput').value = '';
  document.getElementById('groupImagePreview').innerHTML =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#bbb" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
  document.getElementById('btnRemoveImg').style.display = 'none';
}

async function createGroup() {
  if (!ensureConnected()) return;
  const instName = document.getElementById('groupInstance').value;
  const name = document.getElementById('groupName').value.trim();
  const desc = document.getElementById('groupDesc').value.trim();
  const firstMsg = document.getElementById('groupFirstMsg').value.trim();

  if (!instName) return toast('Nenhuma instancia admin conectada', 'error');
  if (!name) return toast('Digite o nome do grupo', 'error');
  if (groupParticipants.length === 0) return toast('Adicione pelo menos um participante', 'error');

  toast('Criando grupo...');
  const res = await api('POST', '/group/create/' + instName, {
    subject: name, description: desc || '', participants: groupParticipants
  });

  if (!res.ok || !res.data) return toast('Erro ao criar grupo', 'error');

  const groupId = res.data.id || res.data.groupJid || res.data.jid;
  if (!groupId) return toast('Erro: ' + JSON.stringify(res.data), 'error');

  toast('Grupo "' + name + '" criado!');

  // Set group picture
  if (groupImageBase64) {
    toast('Enviando imagem do grupo...');
    // API expects raw base64 without the data:image/...;base64, prefix
    const rawBase64 = groupImageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    await api('POST', '/group/updateGroupPicture/' + instName, {
      groupJid: groupId,
      image: rawBase64
    });
  }

  // Send messages: single or pitch
  await new Promise(r => setTimeout(r, 2000));
  if (selectedMsgType === 'pitch') {
    const pitchName = document.getElementById('pitchSelect').value;
    const convInst = document.getElementById('groupConvInstance').value;
    if (pitchName && pitches[pitchName]) {
      const msgs = pitches[pitchName];
      toast('Enviando pitch (' + msgs.length + ' msgs)...');
      for (let i = 0; i < msgs.length; i++) {
        // 1a mensagem: admin (instName), demais: conversacional (convInst) se disponivel
        const sender = (i === 0 || !convInst) ? instName : convInst;
        const msgRes = await api('POST', '/message/sendText/' + sender, { number: groupId, text: msgs[i] });
        if (!msgRes.ok) {
          toast('Erro ao enviar mensagem ' + (i + 1) + ' do pitch', 'error');
          break;
        }
        if (i < msgs.length - 1) await new Promise(r => setTimeout(r, 1500));
      }
      toast('Pitch enviado!');
    }
  } else if (firstMsg) {
    const msgRes = await api('POST', '/message/sendText/' + instName, { number: groupId, text: firstMsg });
    if (msgRes.ok && msgRes.data && msgRes.data.key) toast('Mensagem enviada!');
    else toast('Grupo criado, mas erro ao enviar mensagem', 'error');
  }

  // Reset form
  groupParticipants = [];
  renderParticipants();
  removeGroupImage();
  document.getElementById('groupName').value = '';
  document.getElementById('groupDesc').value = '';
}
