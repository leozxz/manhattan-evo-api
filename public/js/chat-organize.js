// =====================
// ORGANIZAR IDEIAS
// =====================

let organizeLoading = false;

function openOrganizeModal() {
  toggleAttachMenu();
  if (!ensureConnected()) return;
  if (!selectedGroup) return toast('Selecione uma conversa primeiro', 'error');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay organize-overlay';
  overlay.id = 'organizeModal';
  overlay.innerHTML = `
    <div class="modal-box organize-modal">
      <div class="organize-header">
        <h3>Organizar ideias</h3>
        <button class="organize-close" onclick="closeOrganizeModal()">&times;</button>
      </div>
      <div id="organizeInputView">
        <textarea id="organizeText" class="organize-textarea" placeholder="Cole ou digite seu texto complexo aqui... A IA vai organizar em topicos claros e gerar uma imagem visual." rows="10"></textarea>
        <div class="organize-input-actions">
          <button class="btn btn-secondary" onclick="closeOrganizeModal()">Cancelar</button>
          <button class="btn btn-primary" id="organizeBtn" onclick="runOrganize()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 2L8.6 6.6 4 8l4.6 1.4L10 14l1.4-4.6L16 8l-4.6-1.4L10 2zm8 6l-1 3-3 1 3 1 1 3 1-3 3-1-3-1-1-3z"/></svg>
            Organizar
          </button>
        </div>
      </div>
      <div id="organizeResultView" style="display:none">
        <div class="organize-result-content">
          <div class="organize-img-wrap">
            <canvas id="organizeCanvas" style="display:none"></canvas>
            <img id="organizePreviewImg" class="organize-preview-img">
          </div>
          <div class="organize-text-preview" id="organizeTextPreview"></div>
        </div>
        <div class="organize-result-actions">
          <button class="btn btn-secondary" onclick="organizeBack()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            Voltar
          </button>
          <button class="btn btn-secondary" onclick="copyOrganizedText()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
            Copiar texto
          </button>
          <button class="btn btn-secondary" onclick="downloadOrganizeImage()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            Baixar imagem
          </button>
          <button class="btn btn-primary" onclick="sendOrganizeImage()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            Enviar no WhatsApp
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('organizeText')?.focus(), 100);
}

function closeOrganizeModal() {
  const modal = document.getElementById('organizeModal');
  if (modal) modal.remove();
}

function organizeBack() {
  document.getElementById('organizeInputView').style.display = '';
  document.getElementById('organizeResultView').style.display = 'none';
}

let lastOrganizeData = null;

async function runOrganize() {
  const textarea = document.getElementById('organizeText');
  const text = textarea?.value?.trim();
  if (!text || text.length < 10) return toast('Digite pelo menos 10 caracteres', 'error');
  if (organizeLoading) return;

  const btn = document.getElementById('organizeBtn');
  organizeLoading = true;
  btn.disabled = true;
  btn.innerHTML = '<div class="ai-spinner"></div> Organizando...';

  try {
    const res = await fetch('/ai/organize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok || !data.title) {
      toast(data.error || 'Erro ao organizar texto', 'error');
      return;
    }

    lastOrganizeData = data;
    renderOrganizeResult(data);
  } catch (err) {
    toast('Erro ao conectar com IA: ' + err.message, 'error');
  } finally {
    organizeLoading = false;
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 2L8.6 6.6 4 8l4.6 1.4L10 14l1.4-4.6L16 8l-4.6-1.4L10 2zm8 6l-1 3-3 1 3 1 1 3 1-3 3-1-3-1-1-3z"/></svg> Organizar';
  }
}

function renderOrganizeResult(data) {
  // Generate image
  generateOrganizeImage(data);

  // Render text preview
  const preview = document.getElementById('organizeTextPreview');
  let html = '<h4>' + escapeHtml(data.title) + '</h4>';
  (data.sections || []).forEach(s => {
    html += '<div class="organize-section">';
    html += '<h5>' + escapeHtml(s.heading) + '</h5>';
    html += '<ul>';
    (s.points || []).forEach(p => {
      html += '<li>' + escapeHtml(p) + '</li>';
    });
    html += '</ul></div>';
  });
  if (data.conclusion) {
    html += '<div class="organize-conclusion"><strong>Conclusao:</strong> ' + escapeHtml(data.conclusion) + '</div>';
  }
  preview.innerHTML = html;

  // Switch views
  document.getElementById('organizeInputView').style.display = 'none';
  document.getElementById('organizeResultView').style.display = '';
}

function generateOrganizeImage(data) {
  const canvas = document.getElementById('organizeCanvas');
  const ctx = canvas.getContext('2d');

  const COLORS = {
    bg: '#1f1f21',
    text: '#f3f1e8',
    accent: '#33e5b0',
    muted: '#8a8a8e',
    cardBg: '#2a2a2d',
  };

  const PAD = 40;
  const WIDTH = 800;
  const LINE_HEIGHT = 26;
  const SECTION_GAP = 20;
  const BULLET_INDENT = 24;

  // Measure height first
  ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  let totalHeight = PAD + 36 + 16; // top pad + title + gap

  (data.sections || []).forEach(s => {
    totalHeight += SECTION_GAP + 22 + 8; // gap + heading + gap
    (s.points || []).forEach(p => {
      const lines = wrapText(ctx, p, WIDTH - PAD * 2 - BULLET_INDENT, '15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
      totalHeight += lines.length * LINE_HEIGHT;
    });
  });

  if (data.conclusion) {
    totalHeight += SECTION_GAP + 4;
    ctx.font = '15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const cLines = wrapText(ctx, data.conclusion, WIDTH - PAD * 2, '15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
    totalHeight += cLines.length * LINE_HEIGHT;
  }

  totalHeight += PAD; // bottom pad

  // Set canvas size
  canvas.width = WIDTH;
  canvas.height = totalHeight;

  // Background
  ctx.fillStyle = COLORS.bg;
  roundRect(ctx, 0, 0, WIDTH, totalHeight, 16);
  ctx.fill();

  // Subtle border
  ctx.strokeStyle = 'rgba(51, 229, 176, 0.15)';
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, WIDTH - 1, totalHeight - 1, 16);
  ctx.stroke();

  let y = PAD;

  // Title
  ctx.fillStyle = COLORS.accent;
  ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(data.title, PAD, y + 24);
  y += 36;

  // Divider line
  y += 8;
  ctx.strokeStyle = 'rgba(51, 229, 176, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(WIDTH - PAD, y);
  ctx.stroke();
  y += 8;

  // Sections
  (data.sections || []).forEach(s => {
    y += SECTION_GAP;

    // Section heading
    ctx.fillStyle = COLORS.accent;
    ctx.font = 'bold 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(s.heading, PAD, y + 17);
    y += 22 + 8;

    // Points
    ctx.fillStyle = COLORS.text;
    ctx.font = '15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    (s.points || []).forEach(p => {
      // Bullet dot
      ctx.fillStyle = COLORS.accent;
      ctx.beginPath();
      ctx.arc(PAD + 6, y + LINE_HEIGHT / 2, 3, 0, Math.PI * 2);
      ctx.fill();

      // Text
      ctx.fillStyle = COLORS.text;
      const lines = wrapText(ctx, p, WIDTH - PAD * 2 - BULLET_INDENT, '15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
      lines.forEach((line, i) => {
        ctx.fillText(line, PAD + BULLET_INDENT, y + LINE_HEIGHT * (i + 1) - 6);
      });
      y += lines.length * LINE_HEIGHT;
    });
  });

  // Conclusion
  if (data.conclusion) {
    y += SECTION_GAP;

    // Divider
    ctx.strokeStyle = 'rgba(51, 229, 176, 0.2)';
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(WIDTH - PAD, y);
    ctx.stroke();
    y += 12;

    ctx.fillStyle = COLORS.accent;
    ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('Conclusao', PAD, y + 15);
    y += 24;

    ctx.fillStyle = COLORS.text;
    ctx.font = '15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const cLines = wrapText(ctx, data.conclusion, WIDTH - PAD * 2, '15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
    cLines.forEach((line, i) => {
      ctx.fillText(line, PAD, y + LINE_HEIGHT * (i + 1) - 6);
    });
  }

  // Set preview image
  const img = document.getElementById('organizePreviewImg');
  img.src = canvas.toDataURL('image/png');
}

function wrapText(ctx, text, maxWidth, font) {
  ctx.font = font;
  const words = text.split(' ');
  const lines = [];
  let line = '';

  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function copyOrganizedText() {
  if (!lastOrganizeData) return;
  const d = lastOrganizeData;
  let text = d.title + '\n\n';
  (d.sections || []).forEach(s => {
    text += s.heading + '\n';
    (s.points || []).forEach(p => { text += '  • ' + p + '\n'; });
    text += '\n';
  });
  if (d.conclusion) text += 'Conclusao: ' + d.conclusion;

  navigator.clipboard.writeText(text.trim()).then(() => {
    toast('Texto copiado!');
  }).catch(() => {
    toast('Erro ao copiar', 'error');
  });
}

function downloadOrganizeImage() {
  const img = document.getElementById('organizePreviewImg');
  if (!img?.src) return;
  const a = document.createElement('a');
  a.href = img.src;
  a.download = 'ideias-organizadas.png';
  a.click();
  toast('Imagem baixada!');
}

async function sendOrganizeImage() {
  if (!ensureConnected()) return;
  if (!selectedGroup) return toast('Selecione uma conversa', 'error');

  const canvas = document.getElementById('organizeCanvas');
  if (!canvas) return;

  const base64 = canvas.toDataURL('image/png').split(',')[1];
  toast('Enviando imagem...');

  const sendNumber = await getSendNumber();
  if (!sendNumber) return toast('Numero nao encontrado', 'error');

  const res = await api('POST', '/message/sendMedia/' + currentInstance, {
    number: sendNumber,
    mediatype: 'image',
    media: base64,
    mimetype: 'image/png',
    fileName: 'ideias-organizadas.png',
  });

  if (res.ok && res.data && res.data.key) {
    toast('Imagem enviada!');
    closeOrganizeModal();
    lastMsgCount = 0;
    fetchAndRenderMessages();
  } else {
    toast('Erro ao enviar imagem', 'error');
  }
}
