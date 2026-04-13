// =====================
// SHARED STATE & UTILITIES
// =====================
let instances = JSON.parse(localStorage.getItem('evo_instances') || '[]');
let currentInstance = localStorage.getItem('evo_current') || '';
let groups = [];
let selectedGroup = null;
let selectedGroupData = null;
let connectionCheckers = {};
let qrTargetMap = {}; // instanceName -> DOM element id for QR updates
let sseConnected = false;
const contactNames = {}; // JID -> display name
let contactsLoaded = false;
let msgPollInterval = null;
let lastMsgCount = 0;

const MAX_MEDIA_SIZE = 16 * 1024 * 1024; // 16MB

function saveInstances() {
  localStorage.setItem('evo_instances', JSON.stringify(instances));
  localStorage.setItem('evo_current', currentInstance);
}

function instanceDomId(name) {
  return encodeURIComponent(String(name));
}

function sanitizeName(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(path, opts);
    const data = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, status: r.status, data };
    return { ok: true, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  }
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.innerHTML = '<span>' + escapeHtml(msg) + '</span>';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = () => dismissToast(el);
  el.appendChild(closeBtn);
  document.body.appendChild(el);
  el._timer = setTimeout(() => dismissToast(el), 4000);
}

function dismissToast(el) {
  if (el._dismissed) return;
  el._dismissed = true;
  clearTimeout(el._timer);
  el.classList.add('toast-out');
  setTimeout(() => el.remove(), 350);
}

function ensureConnected() {
  if (!currentInstance) {
    toast('Nenhuma instancia selecionada', 'error');
    return false;
  }
  const inst = instances.find(i => i.name === currentInstance);
  if (!inst || inst.state !== 'open') {
    toast('Instancia "' + currentInstance + '" nao esta conectada', 'error');
    return false;
  }
  return true;
}

// =====================
// USER ROLE & PERMISSIONS
// =====================
let currentUserRole = 'user';
let currentUsername = '';
const ADMIN_PAGES = ['connect', 'group', 'dashboard'];

async function loadCurrentUser() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const data = await res.json();
      currentUserRole = data.role || 'user';
      currentUsername = data.username || '';
    }
  } catch {}
  applyPermissions();
}

function applyPermissions() {
  const isAdmin = currentUserRole === 'admin';
  const btns = document.querySelectorAll('.sidebar-btn');
  const pages = ['connect', 'group', 'chat', 'ai', 'dashboard'];

  pages.forEach((page, i) => {
    const btn = btns[i];
    if (!btn) return;
    if (ADMIN_PAGES.includes(page) && !isAdmin) {
      btn.classList.add('locked');
      // Add lock icon if not already there
      if (!btn.querySelector('.lock-icon')) {
        const lock = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        lock.setAttribute('viewBox', '0 0 24 24');
        lock.setAttribute('class', 'lock-icon');
        lock.innerHTML = '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/>';
        btn.appendChild(lock);
      }
    } else {
      btn.classList.remove('locked');
      const lock = btn.querySelector('.lock-icon');
      if (lock) lock.remove();
    }
  });

}

// User menu toggle
function showAccountModal() {
  const overlay = document.getElementById('accountModalOverlay');
  const nameEl = document.getElementById('accountName');
  const roleEl = document.getElementById('accountRole');
  const manageBtn = document.getElementById('accountManageUsersBtn');
  if (nameEl) nameEl.textContent = currentUsername || 'Usuario';
  if (roleEl) roleEl.textContent = currentUserRole === 'admin' ? 'Administrador' : 'Usuario';
  if (manageBtn) manageBtn.style.display = currentUserRole === 'admin' ? '' : 'none';
  overlay.style.display = '';
}
function closeAccountModal() {
  document.getElementById('accountModalOverlay').style.display = 'none';
}

// =====================
// USER MANAGER (admin)
// =====================
function openUserManager() {
  document.getElementById('userManagerOverlay').style.display = 'flex';
  loadUserList();
}

function closeUserManager() {
  document.getElementById('userManagerOverlay').style.display = 'none';
}

function applyPhoneMask(input) {
  let v = input.value.replace(/\D/g, '');
  // Limit to 13 digits (55 + DD + 9XXXXXXXX)
  if (v.length > 13) v = v.slice(0, 13);
  // Auto-prepend 55 if user starts typing DDD
  if (v.length > 0 && !v.startsWith('55')) {
    v = '55' + v;
  }
  let formatted = '';
  if (v.length > 0) formatted = '+' + v.slice(0, 2);
  if (v.length > 2) formatted += ' (' + v.slice(2, 4);
  if (v.length > 4) formatted += ') ' + v.slice(4, 9);
  if (v.length > 9) formatted += '-' + v.slice(9, 13);
  input.value = formatted;
}

function phoneToRaw(masked) {
  return masked.replace(/\D/g, '');
}

let userFormVisible = false;

async function createUser() {
  const username = document.getElementById('newUserUsername').value.trim();
  const password = document.getElementById('newUserPassword').value.trim();
  const name = document.getElementById('newUserName').value.trim();
  const email = document.getElementById('newUserEmail').value.trim();
  const phoneRaw = phoneToRaw(document.getElementById('newUserPhone').value);

  if (!username || !password) { alert('Usuario e senha sao obrigatorios'); return; }
  if (phoneRaw && phoneRaw.length !== 13) { alert('Telefone deve ter o formato completo: +55 (DD) 9XXXX-XXXX'); return; }

  const btn = document.getElementById('createUserBtn');
  btn.disabled = true;
  btn.textContent = 'Criando...';
  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, name: name || username, email: email || null, phone: phoneRaw || null })
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Erro ao criar'); }
    userFormVisible = false;
    loadUserList();
  } catch (err) {
    alert('Erro: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Criar Usuario';
  }
}

function toggleUserForm() {
  userFormVisible = !userFormVisible;
  loadUserList();
}

async function loadUserList() {
  const body = document.getElementById('userManagerBody');
  try {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error('Erro ao carregar');
    const users = await res.json();
    const active = users.filter(u => u.active);

    let html = '<button class="user-form-toggle" onclick="toggleUserForm()">' + (userFormVisible ? '− Cancelar' : '+ Novo Usuario') + '</button>';

    if (userFormVisible) {
      html += '<div class="user-form">' +
        '<div class="user-form-row">' +
          '<input id="newUserName" type="text" placeholder="Nome">' +
          '<input id="newUserUsername" type="text" placeholder="Usuario *">' +
        '</div>' +
        '<input id="newUserPassword" type="password" placeholder="Senha *">' +
        '<input id="newUserEmail" type="email" placeholder="E-mail">' +
        '<input id="newUserPhone" type="text" placeholder="+55 (DD) 9XXXX-XXXX" oninput="applyPhoneMask(this)">' +
        '<button id="createUserBtn" class="user-form-btn" onclick="createUser()">Criar Usuario</button>' +
        '</div>';
    }

    html += '<p class="user-count">' + active.length + ' usuario' + (active.length !== 1 ? 's' : '') + ' ativo' + (active.length !== 1 ? 's' : '') + '</p>';
    users.forEach(u => {
      const initials = (u.name || u.username || '?').charAt(0).toUpperCase();
      const isAdmin = u.role === 'admin';
      const inactive = u.active ? '' : ' style="opacity:0.5"';
      html += '<div class="user-row"' + inactive + '>' +
        '<div class="user-avatar"><span style="color:#9ca3af;font-size:14px;font-weight:600">' + initials + '</span></div>' +
        '<div class="user-info"><div class="user-name">' + (u.name || u.username) + (!u.active ? ' <span style="color:#ef4444;font-size:10px">(inativo)</span>' : '') + '</div>' +
        '<div class="user-email">' + (u.email || u.username) + '</div></div>' +
        '<div class="role-switch' + (isAdmin ? '' : ' is-user') + '" data-uid="' + u.id + '">' +
          '<div class="role-slider"></div>' +
          '<button class="' + (isAdmin ? 'active' : '') + '" onclick="toggleRole(\'' + u.id + '\',\'admin\')">Admin</button>' +
          '<button class="' + (isAdmin ? '' : 'active') + '" onclick="toggleRole(\'' + u.id + '\',\'user\')">Comum</button>' +
        '</div>' +
        '</div>';
    });
    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = '<p style="color:#ef4444;text-align:center;padding:20px">Erro ao carregar usuarios</p>';
  }
}

async function toggleRole(userId, newRole) {
  // Animate switch immediately
  const sw = document.querySelector('.role-switch[data-uid="' + userId + '"]');
  if (sw) {
    sw.classList.toggle('is-user', newRole === 'user');
    sw.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    sw.querySelector('button:' + (newRole === 'admin' ? 'first-child' : 'last-child')).classList.add('active');
  }
  try {
    const res = await fetch('/api/users/' + userId + '/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole })
    });
    if (!res.ok) { loadUserList(); alert('Erro ao alterar permissao'); }
  } catch { loadUserList(); alert('Erro de conexao'); }
}

function showPage(name) {
  // Block non-admin pages
  if (ADMIN_PAGES.includes(name) && currentUserRole !== 'admin') return;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const idx = ['connect','group','chat','ai','dashboard'].indexOf(name);
  if (idx >= 0) document.querySelectorAll('.sidebar-btn')[idx].classList.add('active');

  const titles = { connect: 'Conexoes', group: 'Criar Grupo', chat: 'Mensagens', ai: 'Busca IA', dashboard: 'Dashboard' };
  document.getElementById('pageTitle').textContent = titles[name];

  // Chat page uses fullscreen (hide header, expand content)
  const header = document.querySelector('.header');
  const content = document.querySelector('.content');
  if (name === 'chat') {
    if (header) header.style.display = 'none';
    if (content) content.classList.add('content-fullscreen');
  } else {
    if (header) header.style.display = '';
    if (content) content.classList.remove('content-fullscreen');
  }

  if (name === 'connect') renderInstances();
  if (name === 'group') updateGroupInstanceSelect();
  if (name === 'chat') {
    selectedGroup = null; selectedGroupData = null;
    const area = document.getElementById('chatArea');
    if (area) area.innerHTML = '<div class="empty-chat"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>Selecione uma conversa para ver as mensagens</div>';
    stopMsgPolling(); loadContacts(); loadGroups();
  }
  else stopMsgPolling();
  if (name === 'dashboard') startDashboard();
  else stopDashboard();
}

// Format phone number for display: +55 11 99999-9999
function formatPhone(num) {
  if (!num) return '';
  const s = String(num).replace(/\D/g, '');
  // Brazilian format
  if (s.length === 13 && s.startsWith('55')) {
    return '+' + s.slice(0,2) + ' ' + s.slice(2,4) + ' ' + s.slice(4,9) + '-' + s.slice(9);
  }
  if (s.length === 12 && s.startsWith('55')) {
    return '+' + s.slice(0,2) + ' ' + s.slice(2,4) + ' ' + s.slice(4,8) + '-' + s.slice(8);
  }
  // Generic international
  if (s.length > 6) {
    return '+' + s.slice(0,2) + ' ' + s.slice(2);
  }
  return s;
}

// Load all contacts from Evolution API to populate display names
async function loadContacts() {
  if (!currentInstance || contactsLoaded) return;
  try {
    const res = await api('POST', '/chat/findContacts/' + currentInstance, {});
    if (res.ok && Array.isArray(res.data)) {
      res.data.forEach(c => {
        const jid = c.id || c.remoteJid;
        if (!jid) return;
        // pushName is the WhatsApp profile name set by the user
        const name = c.pushName || c.profileName || c.name || c.verifiedName || '';
        if (name && !contactNames[jid]) {
          contactNames[jid] = name;
        }
      });
      contactsLoaded = true;
    }
  } catch (e) { /* ignore - contacts are optional enrichment */ }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
