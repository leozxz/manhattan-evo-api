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
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
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

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const idx = ['connect','group','chat'].indexOf(name);
  document.querySelectorAll('.sidebar-btn')[idx].classList.add('active');

  const titles = { connect: 'Conexoes', group: 'Criar Grupo', chat: 'Mensagens' };
  document.getElementById('pageTitle').textContent = titles[name];

  if (name === 'connect') renderInstances();
  if (name === 'group') updateGroupInstanceSelect();
  if (name === 'chat') { loadContacts(); loadGroups(); startMsgPolling(); }
  else stopMsgPolling();
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
