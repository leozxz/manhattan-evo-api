// =====================
// MENSAGENS RAPIDAS
// =====================

let quickMessages = [];

function openQuickMessagesModal() {
  toggleAttachMenu();
  if (!ensureConnected()) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay quick-msg-overlay';
  overlay.id = 'quickMsgModal';
  overlay.innerHTML = `
    <div class="modal-box quick-msg-modal">
      <div class="quick-msg-header">
        <h3>Mensagens rapidas</h3>
        <button class="organize-close" onclick="closeQuickMessagesModal()">&times;</button>
      </div>
      <div class="quick-msg-list" id="quickMsgList">
        <div class="spinner" style="margin:20px auto"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeQuickMessagesModal(); });
  loadQuickMessages();
}

function closeQuickMessagesModal() {
  const modal = document.getElementById('quickMsgModal');
  if (modal) modal.remove();
}

async function loadQuickMessages() {
  const list = document.getElementById('quickMsgList');
  if (!list) return;
  try {
    const res = await fetch('/api/quick-messages');
    quickMessages = await res.json();
    renderQuickMessages();
  } catch (err) {
    list.innerHTML = '<div class="quick-msg-empty">Erro ao carregar mensagens</div>';
  }
}

function renderQuickMessages() {
  const list = document.getElementById('quickMsgList');
  if (!list) return;

  if (quickMessages.length === 0) {
    list.innerHTML = `
      <div class="quick-msg-empty">
        Nenhuma mensagem rapida salva
      </div>
      <div class="quick-msg-footer">
        <button class="btn btn-primary btn-sm" onclick="showQuickMsgForm()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          Adicionar
        </button>
      </div>
    `;
    return;
  }

  let html = '';
  quickMessages.forEach(msg => {
    const preview = msg.body.length > 60 ? msg.body.substring(0, 60) + '...' : msg.body;
    html += `
      <div class="quick-msg-item" data-id="${msg.id}">
        <div class="quick-msg-info" onclick="useQuickMessage('${escapeAttr(msg.body)}')" title="Clique para usar">
          <div class="quick-msg-title">${escapeHtml(msg.title)}</div>
          <div class="quick-msg-preview">${escapeHtml(preview)}</div>
        </div>
        <div class="quick-msg-actions">
          <button onclick="editQuickMessage('${msg.id}')" title="Editar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button onclick="deleteQuickMessage('${msg.id}')" title="Excluir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </div>
    `;
  });

  if (quickMessages.length < 5) {
    html += `
      <div class="quick-msg-footer">
        <button class="btn btn-primary btn-sm" onclick="showQuickMsgForm()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          Adicionar
        </button>
        <span class="quick-msg-count">${quickMessages.length}/5</span>
      </div>
    `;
  } else {
    html += '<div class="quick-msg-footer"><span class="quick-msg-count">5/5</span></div>';
  }

  list.innerHTML = html;
}

function escapeAttr(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function showQuickMsgForm(editId) {
  const list = document.getElementById('quickMsgList');
  if (!list) return;

  const existing = editId ? quickMessages.find(m => m.id === editId) : null;

  const formHtml = `
    <div class="quick-msg-form" id="quickMsgForm">
      <input type="text" id="qmTitle" placeholder="Titulo (ex: Saudacao)" maxlength="100" value="${existing ? escapeHtml(existing.title) : ''}">
      <textarea id="qmBody" placeholder="Mensagem..." rows="3">${existing ? escapeHtml(existing.body) : ''}</textarea>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" onclick="cancelQuickMsgForm()">Cancelar</button>
        <button class="btn btn-primary btn-sm" onclick="saveQuickMessage('${editId || ''}')">Salvar</button>
      </div>
    </div>
  `;

  if (editId) {
    const item = list.querySelector(`[data-id="${editId}"]`);
    if (item) {
      item.outerHTML = formHtml;
      return;
    }
  }
  // Insert form before footer
  const footer = list.querySelector('.quick-msg-footer');
  if (footer) {
    footer.insertAdjacentHTML('beforebegin', formHtml);
  } else {
    list.innerHTML = formHtml;
  }
}

function cancelQuickMsgForm() {
  renderQuickMessages();
}

async function saveQuickMessage(editId) {
  const title = document.getElementById('qmTitle')?.value.trim();
  const body = document.getElementById('qmBody')?.value.trim();
  if (!title || !body) return toast('Preencha titulo e mensagem', 'error');

  try {
    let res;
    if (editId) {
      res = await fetch('/api/quick-messages/' + editId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body })
      });
    } else {
      res = await fetch('/api/quick-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body })
      });
    }
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Erro ao salvar', 'error');
      return;
    }
    toast(editId ? 'Mensagem atualizada' : 'Mensagem criada', 'success');
    await loadQuickMessages();
  } catch (err) {
    toast('Erro ao salvar mensagem', 'error');
  }
}

function editQuickMessage(id) {
  showQuickMsgForm(id);
}

async function deleteQuickMessage(id) {
  if (!confirm('Excluir esta mensagem rapida?')) return;
  try {
    const res = await fetch('/api/quick-messages/' + id, { method: 'DELETE' });
    if (!res.ok) {
      toast('Erro ao excluir', 'error');
      return;
    }
    toast('Mensagem excluida', 'success');
    await loadQuickMessages();
  } catch (err) {
    toast('Erro ao excluir mensagem', 'error');
  }
}

function useQuickMessage(body) {
  closeQuickMessagesModal();
  const input = document.getElementById('msgInput');
  if (input) {
    input.value = body;
    input.focus();
  }
}
