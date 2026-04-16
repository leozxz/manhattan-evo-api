// =====================
// INSTANCE MANAGEMENT
// =====================
let reconnecting = {}; // name -> true while reconnect in progress

function renderInstances() {
  const grid = document.getElementById('instancesGrid');
  grid.innerHTML = '';

  instances.forEach(inst => {
    const safeName = instanceDomId(inst.name);
    const role = inst.role || 'conversacional';
    const stClass = inst.state === 'open' ? 'open' : inst.state === 'connecting' ? 'connecting' : 'closed';
    const stLabel = inst.state === 'open' ? 'Conectado' : inst.state === 'connecting' ? 'Aguardando QR' : 'Desconectado';
    const isActive = inst.name === currentInstance;
    const isAdmin = role === 'admin';
    const isConnected = inst.state === 'open';

    const card = document.createElement('div');
    card.className = 'ic' + (isActive ? ' ic-active' : '') + (isConnected ? ' ic-clickable' : '');

    // Click card to select as active (only if connected)
    if (isConnected) {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.ic-actions') || e.target.closest('.ic-seg') || e.target.closest('.ic-name')) return;
        useInstance(inst.name);
      });
    }

    // ── Top row: status dot + name + role tag ──
    const topRow = document.createElement('div');
    topRow.className = 'ic-top';

    const statusDot = document.createElement('span');
    statusDot.className = 'ic-status-dot ic-dot-' + stClass;
    statusDot.title = stLabel;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ic-name';
    nameInput.value = inst.name;
    nameInput.setAttribute('data-inst', inst.name);
    nameInput.setAttribute('data-field', 'name');
    nameInput.setAttribute('readonly', '');
    nameInput.onfocus = function() { this.removeAttribute('readonly'); };
    nameInput.onblur = function() { this.setAttribute('readonly', ''); };
    nameInput.onchange = function() { updateInstanceField(this); };

    const roleTag = document.createElement('span');
    roleTag.className = 'ic-role-tag ic-role-' + (isAdmin ? 'admin' : 'conv');
    roleTag.textContent = isAdmin ? 'Admin' : 'Conv';

    topRow.appendChild(statusDot);
    topRow.appendChild(nameInput);
    topRow.appendChild(roleTag);

    // ── Active indicator ──
    if (isActive) {
      const activeTag = document.createElement('div');
      activeTag.className = 'ic-active-label';
      activeTag.textContent = 'Em uso';
      topRow.appendChild(activeTag);
    }

    // ── Card body (QR / checkmark) ──
    const body = document.createElement('div');
    body.className = 'ic-body';
    body.id = 'card-body-' + safeName;

    if (isConnected) {
      body.innerHTML = '<div class="ic-connected-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>';
    } else {
      body.innerHTML = '<div class="qr-container" id="qr-' + safeName + '"><span class="qr-placeholder">Clique "Conectar" para gerar QR Code</span></div>';
    }

    // ── Role segmented toggle ──
    const toggleRow = document.createElement('div');
    toggleRow.className = 'ic-toggle-row';
    toggleRow.innerHTML = `
      <div class="ic-seg" data-active="${role}" data-inst="${inst.name}">
        <div class="ic-seg-slider"></div>
        <button class="ic-seg-btn ${!isAdmin ? 'ic-seg-active' : ''}" onclick="setInstanceRole('${inst.name}','conversacional')">Conversacional</button>
        <button class="ic-seg-btn ${isAdmin ? 'ic-seg-active' : ''}" onclick="setInstanceRole('${inst.name}','admin')">Admin</button>
      </div>
    `;

    // ── Actions (minimal) ──
    const actions = document.createElement('div');
    actions.className = 'ic-actions';

    if (isConnected) {
      actions.innerHTML = `
        <button class="btn btn-danger btn-sm" onclick="logoutInstance('${inst.name}')">Desconectar</button>
      `;
    } else {
      actions.innerHTML = `
        <button class="btn btn-primary btn-sm" onclick="reconnectInstance('${inst.name}')">Conectar</button>
      `;
    }
    actions.innerHTML += `<button class="btn btn-secondary btn-sm" onclick="deleteInstance('${inst.name}')">Remover</button>`;

    card.appendChild(topRow);
    card.appendChild(body);
    card.appendChild(toggleRow);
    card.appendChild(actions);
    grid.appendChild(card);
  });

  // Add new card
  const addCard = document.createElement('div');
  addCard.className = 'add-instance-card';
  addCard.onclick = () => toggleNewForm();
  addCard.id = 'addCard';
  addCard.innerHTML = `
    <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
    <span style="font-size:14px;font-weight:500">Conectar novo numero</span>
  `;
  grid.appendChild(addCard);

  // New instance form
  const form = document.createElement('div');
  form.className = 'new-instance-form';
  form.id = 'newInstanceForm';
  form.innerHTML = `
    <h3>Novo numero</h3>
    <div class="form-group">
      <label>Nome da instancia</label>
      <input type="text" id="newInstanceName" placeholder="Ex: trabalho, pessoal, loja...">
    </div>
    <div class="qr-container" id="qr-new" style="display:none"><span class="qr-placeholder"></span></div>
    <div class="connect-steps" id="newSteps" style="display:none">
      <ol>
        <li>Abra o <strong>WhatsApp</strong> no celular</li>
        <li>Menu <strong>(&#8942;)</strong> > <strong>Dispositivos conectados</strong></li>
        <li>Toque em <strong>Conectar dispositivo</strong></li>
        <li>Aponte o celular para o QR Code acima</li>
      </ol>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" onclick="addNewInstance()">Gerar QR Code</button>
      <button class="btn btn-secondary" onclick="toggleNewForm()">Cancelar</button>
    </div>
  `;
  grid.appendChild(form);

  updateSelector();
}

// Update only status badge and body of a single card (no full re-render)
function updateCardStatus(name, newState) {
  const inst = instances.find(i => i.name === name);
  if (!inst) return;
  inst.state = newState;
  saveInstances();
  renderInstances();
  updateSelector();
}

function toggleNewForm() {
  const form = document.getElementById('newInstanceForm');
  const card = document.getElementById('addCard');
  form.classList.toggle('visible');
  card.style.display = form.classList.contains('visible') ? 'none' : '';
}

async function addNewInstance() {
  const name = sanitizeName(document.getElementById('newInstanceName').value.trim());
  if (!name) return toast('Digite um nome', 'error');
  if (instances.find(i => i.name === name)) return toast('Ja existe uma instancia com esse nome', 'error');

  document.getElementById('qr-new').style.display = 'flex';
  document.getElementById('qr-new').innerHTML = '<div class="spinner"></div>';
  document.getElementById('newSteps').style.display = 'block';

  // Get webhook URL for instance config
  const cfgRes = await api('GET', '/config');
  const webhookUrl = cfgRes.ok ? cfgRes.data?.webhookUrl : null;
  const createBody = {
    instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true,
    rejectCall: false, groupsIgnore: false, alwaysOnline: true,
    readMessages: false, readStatus: false, syncFullHistory: false
  };
  if (webhookUrl) {
    createBody.webhook = { enabled: true, url: webhookUrl, byEvents: false, events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'GROUPS_UPSERT', 'GROUP_PARTICIPANTS_UPDATE', 'PRESENCE_UPDATE'] };
  }
  const res = await api('POST', '/instance/create', createBody);

  if (res.ok && res.data?.qrcode?.base64) {
    document.getElementById('qr-new').innerHTML = '<img src="' + res.data.qrcode.base64 + '">';
  } else {
    const qr = await api('GET', '/instance/connect/' + name);
    if (qr.ok && qr.data?.base64) {
      document.getElementById('qr-new').innerHTML = '<img src="' + qr.data.base64 + '">';
    } else {
      document.getElementById('qr-new').innerHTML = '<span class="qr-placeholder">Erro ao gerar QR</span>';
      return toast('Erro ao gerar QR Code', 'error');
    }
  }

  instances.push({ name, state: 'connecting', role: 'conversacional' });
  if (!currentInstance) currentInstance = name;
  saveInstances();
  qrTargetMap[name] = 'qr-new';
  startConnectionChecker(name);
  toast('Escaneie o QR Code para conectar "' + name + '"');
}

function stopConnectionChecker(name) {
  if (connectionCheckers[name]) {
    clearInterval(connectionCheckers[name]);
    delete connectionCheckers[name];
  }
}

function startConnectionChecker(name) {
  stopConnectionChecker(name);
  let failCount = 0;
  let lastQrTime = Date.now();
  connectionCheckers[name] = setInterval(async () => {
    const res = await api('GET', '/instance/connectionState/' + name);
    const s = res.ok ? res.data?.instance?.state : null;

    if (s === 'open') {
      stopConnectionChecker(name);
      delete qrTargetMap[name];
      const inst = instances.find(i => i.name === name);
      if (inst && inst.state !== 'open') {
        updateCardStatus(name, 'open');
        toast('"' + name + '" conectado!');
      }
    } else if (s === 'connecting') {
      // Auto-renew QR code every 18s
      if (Date.now() - lastQrTime > 18000) {
        lastQrTime = Date.now();
        const qr = await api('GET', '/instance/connect/' + name);
        if (qr.ok && qr.data?.base64) {
          const elId = qrTargetMap[name] || ('qr-' + instanceDomId(name));
          const qrEl = document.getElementById(elId);
          if (qrEl) qrEl.innerHTML = '<img src="' + qr.data.base64 + '">';
        }
      }
      failCount = 0; // reset fail count while connecting
    } else {
      failCount++;
      // After ~2.5 minutes (50 checks * 3s), stop and expire
      if (failCount > 50) {
        stopConnectionChecker(name);
        delete qrTargetMap[name];
        updateCardStatus(name, 'closed');
        toast('QR Code expirou para "' + name + '". Clique Conectar novamente.', 'error');
      }
    }
  }, 3000);
}

async function attemptAutoRestart(name) {
  if (reconnecting[name]) return;
  reconnecting[name] = true;
  try {
    toast('Reconectando "' + name + '"...');
    await api('PUT', '/instance/restart/' + name);
    await new Promise(r => setTimeout(r, 3000));
    const s = await api('GET', '/instance/connectionState/' + name);
    if (s.ok && s.data?.instance?.state === 'open') {
      updateCardStatus(name, 'open');
      toast('"' + name + '" reconectado!');
    } else {
      updateCardStatus(name, 'closed');
      toast('"' + name + '" desconectou. Clique Reconectar.', 'error');
    }
  } finally {
    delete reconnecting[name];
  }
}

// Monitor connected instances for disconnection (every 30s, skipped when SSE is active)
let disconnectFailCounts = {};
setInterval(async () => {
  if (sseConnected) return; // SSE handles this in real-time
  for (const inst of instances) {
    if (inst.state !== 'open') continue;
    if (connectionCheckers[inst.name]) continue;
    if (reconnecting[inst.name]) continue;
    try {
      const res = await api('GET', '/instance/connectionState/' + inst.name);
      const s = res.ok ? res.data?.instance?.state : null;
      if (s === 'open') {
        disconnectFailCounts[inst.name] = 0;
      } else if (s) {
        disconnectFailCounts[inst.name] = (disconnectFailCounts[inst.name] || 0) + 1;
        if (disconnectFailCounts[inst.name] >= 2) {
          disconnectFailCounts[inst.name] = 0;
          // Try auto-restart before giving up
          await attemptAutoRestart(inst.name);
        }
      }
    } catch (e) { /* network error, ignore */ }
  }
}, 30000);

async function reconnectInstance(name) {
  if (reconnecting[name]) return;
  reconnecting[name] = true;

  const safeName = instanceDomId(name);
  const qrEl = document.getElementById('qr-' + safeName);
  if (qrEl) qrEl.innerHTML = '<div class="spinner"></div>';

  try {
    // Step 1: Check if already connected
    const state = await api('GET', '/instance/connectionState/' + name);
    if (state.ok && state.data?.instance?.state === 'open') {
      updateCardStatus(name, 'open');
      toast('"' + name + '" ja esta conectado!');
      return;
    }

    // Step 2: Try restart (reconnects existing session without new QR)
    toast('Tentando reconectar "' + name + '"...');
    const restart = await api('PUT', '/instance/restart/' + name);
    if (restart.ok) {
      await new Promise(r => setTimeout(r, 3000));
      const s2 = await api('GET', '/instance/connectionState/' + name);
      if (s2.ok && s2.data?.instance?.state === 'open') {
        updateCardStatus(name, 'open');
        toast('"' + name + '" reconectado!');
        return;
      }
    }

    // Step 3: Try connect for QR code
    let qr = await api('GET', '/instance/connect/' + name);
    if (!qr.ok || !qr.data?.base64) {
      // Step 3b: Logout stale session and try again
      await api('DELETE', '/instance/logout/' + name);
      await new Promise(r => setTimeout(r, 2000));
      qr = await api('GET', '/instance/connect/' + name);
    }

    if (qr.ok && qr.data?.base64) {
      // Re-fetch the QR element (DOM may have changed)
      const qrNow = document.getElementById('qr-' + safeName);
      if (qrNow) qrNow.innerHTML = '<img src="' + qr.data.base64 + '">';
      const inst = instances.find(i => i.name === name);
      if (inst) inst.state = 'connecting';
      saveInstances();
      // Update only the status ribbon, NOT full re-render (would destroy QR)
      const cardEl = qrNow?.closest('.ic');
      const ribbonEl = cardEl?.querySelector('.ic-ribbon-closed, .ic-ribbon-open');
      if (ribbonEl) { ribbonEl.className = 'ic-ribbon ic-ribbon-connecting'; ribbonEl.textContent = 'Aguardando QR'; }
      startConnectionChecker(name);
      toast('Escaneie o QR Code para "' + name + '"');
      return;
    }

    // All attempts failed
    const qrNow = document.getElementById('qr-' + safeName);
    if (qrNow) qrNow.innerHTML = '<span class="qr-placeholder">Nao foi possivel reconectar. Tente remover e criar novamente.</span>';
    toast('Erro ao conectar "' + name + '"', 'error');
  } finally {
    delete reconnecting[name];
  }
}

function useInstance(name) {
  currentInstance = name;
  contactsLoaded = false;
  saveInstances();
  renderInstances();
  updateSelector();
  toast('Usando instancia "' + name + '"');
}

async function logoutInstance(name) {
  stopConnectionChecker(name);
  const res = await api('DELETE', '/instance/logout/' + name);
  if (!res.ok) return toast('Erro ao desconectar "' + name + '"', 'error');
  updateCardStatus(name, 'closed');
  toast('Desconectado "' + name + '"');
}

async function deleteInstance(name) {
  // Stop any active checkers
  stopConnectionChecker(name);

  // Try delete from API (ignore errors — remove locally regardless)
  await api('DELETE', '/instance/logout/' + name).catch(() => {});
  await api('DELETE', '/instance/delete/' + name).catch(() => {});

  instances = instances.filter(i => i.name !== name);
  if (currentInstance === name) currentInstance = instances.length ? instances[0].name : '';
  saveInstances();
  renderInstances();
  updateSelector();
  toast('Instancia "' + name + '" removida');
}

function switchInstance(name) {
  currentInstance = name;
  contactsLoaded = false;
  saveInstances();
  renderInstances();
  updateSelector();
  // Reload current page data
  if (document.getElementById('page-chat').classList.contains('active')) {
    selectedGroup = null;
    selectedGroupData = null;
    lastMsgCount = 0;
    groups = [];
    // Clear group list immediately to avoid showing old instance's groups
    const groupList = document.getElementById('groupList');
    if (groupList) groupList.innerHTML = '<div style="padding:24px;text-align:center;color:#667781">Carregando grupos...</div>';
    // Stop message polling from previous group
    if (typeof stopMsgPolling === 'function') stopMsgPolling();
    loadContacts();
    loadGroups();
    document.getElementById('chatArea').innerHTML =
      '<div class="empty-chat"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>Selecione um grupo para ver as mensagens</div>';
  }
}

function updateSelector() {
  const sel = document.getElementById('instanceSelect');
  const dot = document.getElementById('selectorDot');
  const container = document.getElementById('instanceSelector');

  const connected = instances.filter(i => i.state === 'open');
  if (connected.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  sel.innerHTML = '';

  // Prefer conversacional instance as default for chat
  const cur = instances.find(i => i.name === currentInstance);
  if (!cur || cur.state !== 'open') {
    const conv = connected.find(i => i.role === 'conversacional');
    if (conv) { currentInstance = conv.name; saveInstances(); }
    else if (connected.length > 0) { currentInstance = connected[0].name; saveInstances(); }
  }

  instances.forEach(inst => {
    const opt = document.createElement('option');
    opt.value = inst.name;
    const roleTag = inst.role === 'admin' ? ' [Admin]' : ' [Conv]';
    opt.textContent = inst.name + roleTag + (inst.state === 'open' ? '' : ' (offline)');
    opt.selected = inst.name === currentInstance;
    sel.appendChild(opt);
  });

  const curInst = instances.find(i => i.name === currentInstance);
  dot.className = 'instance-dot' + (curInst && curInst.state === 'open' ? ' on' : '');
}

function updateInstanceField(el) {
  const instName = el.dataset.inst;
  const field = el.dataset.field;
  const value = el.value.trim();
  const inst = instances.find(i => i.name === instName);
  if (!inst) return;

  if (field === 'role') {
    inst.role = value;
  } else if (field === 'name' && value && value !== instName) {
    // Rename: update all references
    const wasActive = currentInstance === instName;
    inst.name = value;
    if (wasActive) currentInstance = value;
  }

  saveInstances();
  renderInstances();
  updateSelector();
  updateGroupInstanceSelect();
}

function setInstanceRole(name, newRole) {
  const inst = instances.find(i => i.name === name);
  if (!inst || inst.role === newRole) return;
  inst.role = newRole;
  saveInstances();

  // Animate the segmented toggle without full re-render
  const seg = document.querySelector('.ic-seg[data-inst="' + name + '"]');
  if (seg) {
    seg.dataset.active = newRole;
    seg.querySelectorAll('.ic-seg-btn').forEach((btn, i) => {
      btn.classList.toggle('ic-seg-active', (i === 0 && newRole === 'conversacional') || (i === 1 && newRole === 'admin'));
    });
    // Update the role ribbon
    const card = seg.closest('.ic');
    const roleRibbon = card?.querySelector('.ic-ribbon-role-admin, .ic-ribbon-role-conv');
    if (roleRibbon) {
      roleRibbon.className = 'ic-ribbon ic-ribbon-role-' + (newRole === 'admin' ? 'admin' : 'conv');
      roleRibbon.textContent = newRole === 'admin' ? 'Admin' : 'Conv';
    }
  }

  updateSelector();
  updateGroupInstanceSelect();
}

function toggleInstanceRole(name) {
  const inst = instances.find(i => i.name === name);
  if (!inst) return;
  inst.role = inst.role === 'admin' ? 'conversacional' : 'admin';
  saveInstances();
  renderInstances();
  updateSelector();
  updateGroupInstanceSelect();
  updateConvInstanceSelect();
}

function updateConvInstanceSelect() {
  const sel = document.getElementById('groupConvInstance');
  if (!sel) return;
  sel.innerHTML = '';
  const convInstances = instances.filter(i => i.state === 'open' && i.role === 'conversacional');
  convInstances.forEach(inst => {
    const opt = document.createElement('option');
    opt.value = inst.name;
    opt.textContent = inst.name;
    sel.appendChild(opt);
  });
}

function updateGroupInstanceSelect() {
  const sel = document.getElementById('groupInstance');
  sel.innerHTML = '';
  const adminInstances = instances.filter(i => i.state === 'open' && i.role === 'admin');
  if (adminInstances.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- Nenhum admin conectado --';
    sel.appendChild(opt);
  }
  adminInstances.forEach(inst => {
    const opt = document.createElement('option');
    opt.value = inst.name;
    opt.textContent = inst.name;
    opt.selected = inst.name === currentInstance;
    sel.appendChild(opt);
  });
  updateConvInstanceSelect();
}
