// =====================
// GROUP CREATION
// =====================
let groupParticipants = [];
let groupImageBase64 = null;

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
    '<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
  document.getElementById('btnRemoveImg').style.display = 'none';
}

async function createGroup() {
  if (!ensureConnected()) return;
  const instName = document.getElementById('groupInstance').value;
  const name = document.getElementById('groupName').value.trim();
  const desc = document.getElementById('groupDesc').value.trim();
  const firstMsg = document.getElementById('groupFirstMsg').value.trim();

  if (!instName) return toast('Nenhuma instancia conectada', 'error');
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

  // Send first message
  if (firstMsg) {
    await new Promise(r => setTimeout(r, 2000));
    const msgRes = await api('POST', '/message/sendText/' + instName, { number: groupId, text: firstMsg });
    if (msgRes.ok && msgRes.data && msgRes.data.key) toast('Mensagem "' + firstMsg + '" enviada!');
    else toast('Grupo criado, mas erro ao enviar mensagem', 'error');
  }

  // Reset form
  groupParticipants = [];
  renderParticipants();
  removeGroupImage();
  document.getElementById('groupName').value = '';
  document.getElementById('groupDesc').value = '';
}
