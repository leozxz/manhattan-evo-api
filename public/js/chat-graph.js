// =====================
// KNOWLEDGE GRAPH VISUALIZATION (Canvas) — Premium Edition
// =====================
const CATEGORY_COLORS = {
  PESSOA: '#6366f1', FAMILIA: '#ec4899', FINANCEIRO: '#10b981',
  SAUDE: '#ef4444', MORADIA: '#f59e0b', TRABALHO: '#3b82f6',
  EDUCACAO: '#8b5cf6', INTERESSE: '#14b8a6', EVENTO: '#f97316', SENTIMENTO: '#e879f9',
};

async function resetKnowledgeGraph() {
  const existing = document.querySelector('.graph-modal-overlay');
  if (existing) existing.remove();
  toast('Regenerando perfil...');
  try { await api('POST', '/knowledge/extract/' + currentInstance, { remoteJid: selectedGroup, messageCount: 50 }); } catch {}
  loadUnifiedPanel();
  await openKnowledgeGraph();
}

let _graphData = null; // shared for AI queries

async function openKnowledgeGraph() {
  const res = await api('GET', '/knowledge/contact/' + currentInstance + '?remoteJid=' + encodeURIComponent(selectedGroup));
  if (!res.ok || !res.data || !res.data.entities || res.data.entities.length === 0) {
    toast('Nenhum dado para exibir no grafo', 'error'); return;
  }

  _graphData = res.data;
  const contactName = contactNames[selectedGroup] || res.data.pushName || selectedGroup.split('@')[0];

  const overlay = document.createElement('div');
  overlay.className = 'graph-modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const modal = document.createElement('div');
  modal.className = 'graph-modal';
  modal.innerHTML = `
    <div class="graph-modal-header">
      <span>Grafo de Conhecimento</span>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="resetKnowledgeGraph()" title="Regerar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#54656f"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        </button>
        <button class="btn btn-secondary btn-sm" onclick="this.closest('.graph-modal-overlay').remove()">&times;</button>
      </div>
    </div>
    <div class="graph-modal-body"><canvas id="knowledgeCanvas"></canvas></div>
    <div class="graph-ai-bar" id="graphAiBar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#8b5cf6" style="flex-shrink:0"><path d="M10 2L8.6 6.6 4 8l4.6 1.4L10 14l1.4-4.6L16 8l-4.6-1.4L10 2zm8 6l-1 3-3 1 3 1 1 3 1-3 3-1-3-1-1-3zm-4 8l-1.5 4.5L8 22l-1.5-1.5L2 19l4.5-1.5L8 13l1.5 4.5z"/></svg>
      <input type="text" id="graphAiInput" placeholder="Pergunte sobre o cliente..." style="flex:1;border:none;background:none;outline:none;font-size:12px;color:var(--text)">
      <div id="graphAiStatus" style="font-size:11px;color:var(--text-muted);display:none"></div>
    </div>
    <div class="graph-legend" id="graphLegend"></div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    const canvas = document.getElementById('knowledgeCanvas');
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    renderGraph(canvas, _graphData, contactName);
  });
}

function renderGraph(canvas, data, contactName) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  let cam = { x: 0, y: 0, zoom: 1 };
  function worldToScreen(wx, wy) { return { x: (wx - cam.x) * cam.zoom + W / 2, y: (wy - cam.y) * cam.zoom + H / 2 }; }
  function screenToWorld(sx, sy) { return { x: (sx - W / 2) / cam.zoom + cam.x, y: (sy - H / 2) / cam.zoom + cam.y }; }

  // ---- Build graph ----
  const nodes = [], edges = [];
  const center = { id: '__contact__', label: contactName, x: 0, y: 0, vx: 0, vy: 0, r: 44, color: '#111b21', type: 'contact', fixed: true, category: null };
  nodes.push(center);

  const grouped = {};
  (data.entities || []).forEach(e => { if (!grouped[e.category]) grouped[e.category] = []; grouped[e.category].push(e); });
  const categories = Object.keys(grouped);

  categories.forEach((cat, ci) => {
    const angle = (2 * Math.PI * ci) / categories.length - Math.PI / 2;
    const catColor = CATEGORY_COLORS[cat] || '#6b7280';
    const catLabel = (KNOWLEDGE_CATEGORIES[cat] || { label: cat }).label;
    const catNode = { id: 'cat_' + cat, label: catLabel, x: Math.cos(angle) * 220, y: Math.sin(angle) * 220, vx: 0, vy: 0, r: 32, color: catColor, type: 'category', category: cat };
    nodes.push(catNode);
    edges.push({ from: center, to: catNode, color: catColor, strength: 0.3, type: 'hierarchy', category: cat });

    grouped[cat].forEach((ent, ei) => {
      const eAngle = angle + ((ei - (grouped[cat].length - 1) / 2) * 0.4);
      const entNode = { id: ent.id, label: ent.label, value: ent.value, category: cat, x: Math.cos(eAngle) * 350 + (Math.random() - 0.5) * 15, y: Math.sin(eAngle) * 350 + (Math.random() - 0.5) * 15, vx: 0, vy: 0, r: 22, color: catColor, type: 'entity' };
      nodes.push(entNode);
      edges.push({ from: catNode, to: entNode, color: catColor, strength: 0.4, type: 'hierarchy', category: cat });
    });
  });

  (data.relationships || []).forEach(r => {
    const fromNode = nodes.find(n => n.label === r.fromEntity?.label && n.type === 'entity');
    const toNode = nodes.find(n => n.label === r.toEntity?.label && n.type === 'entity');
    if (fromNode && toNode) edges.push({ from: fromNode, to: toNode, color: '#f59e0b', strength: 0.1, type: 'relation', label: r.type, category: null });
  });

  // ---- Filter + highlight state ----
  let activeFilter = null;
  let highlightLabels = new Set(); // AI highlight
  let targetCam = null; // smooth camera animation

  function setFilter(cat) {
    activeFilter = activeFilter === cat ? null : cat;
    buildLegend();
  }

  function nodeOpacity(n) {
    if (highlightLabels.size > 0) {
      if (n.type === 'contact') return 1;
      if (highlightLabels.has(n.label)) return 1;
      // Highlight parent category of matched entities
      if (n.type === 'category') {
        const hasMatch = nodes.some(nd => nd.category === n.category && highlightLabels.has(nd.label));
        if (hasMatch) return 1;
      }
      return 0.08;
    }
    if (!activeFilter) return 1;
    if (n.type === 'contact') return 1;
    if (n.category === activeFilter) return 1;
    return 0.08;
  }
  function edgeOpacity(e) {
    if (highlightLabels.size > 0) {
      if (highlightLabels.has(e.from.label) || highlightLabels.has(e.to.label)) return 1;
      if (e.from.type === 'contact') {
        const hasMatch = nodes.some(nd => nd.category === e.to.category && highlightLabels.has(nd.label));
        if (hasMatch) return 0.5;
      }
      return 0.04;
    }
    if (!activeFilter) return 1;
    if (e.category === activeFilter) return 1;
    if (e.from.type === 'contact' && e.to.category === activeFilter) return 1;
    return 0.04;
  }

  // ---- Simulation ----
  let simRunning = true, simAlpha = 1;
  function simulate() {
    if (simAlpha < 0.001) { simRunning = false; return; }
    simAlpha *= 0.97;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y, dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = simAlpha * 800 / (dist * dist);
        if (!a.fixed) { a.vx -= (dx / dist) * force; a.vy -= (dy / dist) * force; }
        if (!b.fixed) { b.vx += (dx / dist) * force; b.vy += (dy / dist) * force; }
        const minDist = (a.r + b.r) * 2.5;
        if (dist < minDist) { const push = (minDist - dist) / 2; if (!a.fixed) { a.x -= (dx / dist) * push; a.y -= (dy / dist) * push; } if (!b.fixed) { b.x += (dx / dist) * push; b.y += (dy / dist) * push; } }
      }
    }
    edges.forEach(e => {
      const dx = e.to.x - e.from.x, dy = e.to.y - e.from.y, dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = e.type === 'hierarchy' ? (e.from.type === 'contact' ? 220 : 130) : 250;
      const force = (dist - target) * (e.strength || 0.1) * simAlpha;
      if (!e.from.fixed) { e.from.vx += (dx / dist) * force; e.from.vy += (dy / dist) * force; }
      if (!e.to.fixed) { e.to.vx -= (dx / dist) * force; e.to.vy -= (dy / dist) * force; }
    });
    nodes.forEach(n => { if (n.fixed) return; n.vx -= n.x * 0.002 * simAlpha; n.vy -= n.y * 0.002 * simAlpha; n.vx *= 0.6; n.vy *= 0.6; n.x += n.vx; n.y += n.vy; });
  }

  // ---- Smooth camera ----
  function animateCamera() {
    if (!targetCam) return;
    cam.x += (targetCam.x - cam.x) * 0.08;
    cam.y += (targetCam.y - cam.y) * 0.08;
    cam.zoom += (targetCam.zoom - cam.zoom) * 0.08;
    if (Math.abs(cam.x - targetCam.x) < 0.5 && Math.abs(cam.y - targetCam.y) < 0.5) targetCam = null;
  }

  function panToNodes(matchedNodes) {
    if (matchedNodes.length === 0) return;
    let cx = 0, cy = 0;
    matchedNodes.forEach(n => { cx += n.x; cy += n.y; });
    cx /= matchedNodes.length; cy /= matchedNodes.length;
    targetCam = { x: cx, y: cy, zoom: 1.5 };
  }

  // ---- Interaction ----
  let hoveredNode = null, dragNode = null, isPanning = false, lastMouse = { x: 0, y: 0 };
  let tooltip = { visible: false, x: 0, y: 0, lines: [] };
  let clickStart = null;

  function hitTest(sx, sy) {
    const w = screenToWorld(sx, sy);
    for (let i = nodes.length - 1; i >= 0; i--) { const n = nodes[i]; const dx = w.x - n.x, dy = w.y - n.y; if (dx * dx + dy * dy < (n.r + 4) * (n.r + 4)) return n; }
    return null;
  }

  // ---- Drawing ----
  function drawEdge(e, highlight) {
    const op = edgeOpacity(e); if (op < 0.01) return;
    const s1 = worldToScreen(e.from.x, e.from.y), s2 = worldToScreen(e.to.x, e.to.y);
    ctx.globalAlpha = highlight ? 1 : op;
    ctx.beginPath(); ctx.moveTo(s1.x, s1.y);
    if (e.type === 'relation') { const mx = (s1.x + s2.x) / 2, my = (s1.y + s2.y) / 2; ctx.quadraticCurveTo(mx - (s2.y - s1.y) * 0.12, my + (s2.x - s1.x) * 0.12, s2.x, s2.y); }
    else ctx.lineTo(s2.x, s2.y);
    ctx.strokeStyle = e.color + (highlight ? 'cc' : (e.type === 'hierarchy' ? '50' : '70'));
    ctx.lineWidth = (highlight ? 2.5 : (e.type === 'hierarchy' ? 1.2 : 0.8)) * cam.zoom;
    if (e.type === 'relation') ctx.setLineDash([5 * cam.zoom, 3 * cam.zoom]); else ctx.setLineDash([]);
    ctx.stroke(); ctx.setLineDash([]);
    if (e.label && highlight && cam.zoom > 0.6) { ctx.font = (9 * cam.zoom) + 'px -apple-system,sans-serif'; ctx.fillStyle = e.color; ctx.textAlign = 'center'; ctx.fillText(e.label, (s1.x + s2.x) / 2, (s1.y + s2.y) / 2 - 8 * cam.zoom); }
    ctx.globalAlpha = 1;
  }

  function drawNode(n, highlight) {
    const op = nodeOpacity(n); if (op < 0.01) return;
    const s = worldToScreen(n.x, n.y), sr = n.r * cam.zoom;
    const isAiMatch = highlightLabels.has(n.label);
    ctx.globalAlpha = highlight ? 1 : op;

    // Glow
    if ((highlight && op > 0.5) || isAiMatch) {
      ctx.beginPath(); ctx.arc(s.x, s.y, sr + (isAiMatch ? 14 : 10) * cam.zoom, 0, 2 * Math.PI);
      const glow = ctx.createRadialGradient(s.x, s.y, sr, s.x, s.y, sr + (isAiMatch ? 14 : 10) * cam.zoom);
      glow.addColorStop(0, (isAiMatch ? '#8b5cf6' : n.color) + '40');
      glow.addColorStop(1, (isAiMatch ? '#8b5cf6' : n.color) + '00');
      ctx.fillStyle = glow; ctx.fill();
    }

    // Pulsing ring for AI matches
    if (isAiMatch) {
      const pulseR = sr + (6 + Math.sin(Date.now() / 300) * 3) * cam.zoom;
      ctx.beginPath(); ctx.arc(s.x, s.y, pulseR, 0, 2 * Math.PI);
      ctx.strokeStyle = '#8b5cf680'; ctx.lineWidth = 2 * cam.zoom; ctx.stroke();
    }

    const dimmed = op < 0.5; // node is filtered out
    ctx.shadowColor = dimmed ? 'transparent' : 'rgba(0,0,0,' + (n.type === 'contact' ? '0.2' : '0.08') + ')';
    ctx.shadowBlur = dimmed ? 0 : (n.type === 'contact' ? 12 : 6) * cam.zoom;
    ctx.shadowOffsetY = dimmed ? 0 : 2 * cam.zoom;
    ctx.globalAlpha = dimmed ? 0.15 : 1;
    ctx.beginPath(); ctx.arc(s.x, s.y, sr, 0, 2 * Math.PI);

    if (n.type === 'contact') {
      const grad = ctx.createLinearGradient(s.x - sr, s.y - sr, s.x + sr, s.y + sr);
      grad.addColorStop(0, '#1a1d23'); grad.addColorStop(1, '#2d3139');
      ctx.fillStyle = grad; ctx.fill();
    } else if (n.type === 'category') {
      ctx.fillStyle = dimmed ? '#d1d5db' : n.color;
      ctx.fill();
    } else {
      ctx.fillStyle = dimmed ? '#f3f4f6' : '#fff'; ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.strokeStyle = dimmed ? '#d1d5db' : (isAiMatch ? '#8b5cf6' : n.color);
      ctx.lineWidth = (isAiMatch ? 3 : 2) * cam.zoom; ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    if (n.type !== 'entity') {
      ctx.fillStyle = dimmed ? '#9ca3af' : '#fff';
      ctx.font = '600 ' + (n.type === 'contact' ? 13 : 10) * cam.zoom + 'px -apple-system,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const maxC = Math.floor(n.r * 2 / (n.type === 'contact' ? 8 : 6));
      ctx.fillText(n.label.length > maxC ? n.label.substring(0, maxC - 1) + '..' : n.label, s.x, s.y);
    }

    if (n.type === 'entity' && cam.zoom > 0.4) {
      ctx.fillStyle = dimmed ? '#ccc' : '#333';
      ctx.font = (10 * cam.zoom) + 'px -apple-system,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const maxW = 110 * cam.zoom, words = n.label.split(' ');
      let line = '', ly = s.y + sr + 5 * cam.zoom;
      words.forEach(w => { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, s.x, ly); line = w; ly += 12 * cam.zoom; } else line = t; });
      if (line) ctx.fillText(line, s.x, ly);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
    bgGrad.addColorStop(0, '#f0f2f5'); bgGrad.addColorStop(1, '#f8f9fb');
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

    if (cam.zoom > 0.3) {
      const tl = screenToWorld(0, 0), br = screenToWorld(W, H);
      ctx.fillStyle = '#ddd';
      for (let gx = Math.floor(tl.x / 50) * 50; gx < br.x; gx += 50)
        for (let gy = Math.floor(tl.y / 50) * 50; gy < br.y; gy += 50) { const sp = worldToScreen(gx, gy); ctx.beginPath(); ctx.arc(sp.x, sp.y, 1, 0, 2 * Math.PI); ctx.fill(); }
    }

    const hlEdges = new Set(), hlNodes = new Set();
    if (hoveredNode) { hlNodes.add(hoveredNode); edges.forEach((e, i) => { if (e.from === hoveredNode || e.to === hoveredNode) { hlEdges.add(i); hlNodes.add(e.from); hlNodes.add(e.to); } }); }
    edges.forEach((e, i) => drawEdge(e, hlEdges.has(i)));
    nodes.forEach(n => drawNode(n, hlNodes.size === 0 || hlNodes.has(n)));

    if (tooltip.visible && tooltip.lines.length > 0) {
      const pad = 12, lineH = 18;
      ctx.font = '12px -apple-system,sans-serif';
      const maxW = Math.max(...tooltip.lines.map(l => ctx.measureText(l.text).width)) + pad * 2;
      const boxH = tooltip.lines.length * lineH + pad * 2;
      let tx = tooltip.x + 20, ty = tooltip.y - boxH / 2;
      if (tx + maxW > W) tx = tooltip.x - maxW - 20;
      if (ty < 4) ty = 4; if (ty + boxH > H - 4) ty = H - boxH - 4;
      ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
      ctx.beginPath(); ctx.roundRect(tx, ty, maxW, boxH, 10); ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      tooltip.lines.forEach((line, i) => { ctx.font = line.bold ? '600 12px -apple-system,sans-serif' : '11px -apple-system,sans-serif'; ctx.fillStyle = line.color || '#333'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(line.text, tx + pad, ty + pad + i * lineH); });
    }
    ctx.fillStyle = '#bbb'; ctx.font = '10px -apple-system,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(Math.round(cam.zoom * 100) + '%', W - 12, H - 8);
  }

  let animFrame;
  function loop() { if (simRunning) simulate(); animateCamera(); draw(); animFrame = requestAnimationFrame(loop); }
  loop();
  const observer = new MutationObserver(() => { if (!document.body.contains(canvas)) { cancelAnimationFrame(animFrame); observer.disconnect(); } });
  observer.observe(document.body, { childList: true });

  // ---- Mouse ----
  canvas.onmousedown = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    clickStart = { x: e.clientX, y: e.clientY, time: Date.now() };
    const hit = hitTest(sx, sy);
    if (hit) { dragNode = hit; dragNode.fixed = true; simAlpha = 0.3; simRunning = true; }
    else isPanning = true;
    lastMouse = { x: e.clientX, y: e.clientY };
  };

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (dragNode) { const w = screenToWorld(sx, sy); dragNode.x = w.x; dragNode.y = w.y; dragNode.vx = 0; dragNode.vy = 0; canvas.style.cursor = 'grabbing'; return; }
    if (isPanning) { cam.x -= (e.clientX - lastMouse.x) / cam.zoom; cam.y -= (e.clientY - lastMouse.y) / cam.zoom; lastMouse = { x: e.clientX, y: e.clientY }; canvas.style.cursor = 'grabbing'; return; }
    const hit = hitTest(sx, sy); hoveredNode = hit; tooltip.visible = false;
    if (hit) {
      canvas.style.cursor = 'pointer';
      const lines = [{ text: hit.label, bold: true, color: hit.color }];
      if (hit.value) lines.push({ text: hit.value, bold: false });
      if (hit.type === 'category') { const ck = Object.keys(grouped).find(k => (KNOWLEDGE_CATEGORIES[k] || {}).label === hit.label) || hit.label.toUpperCase(); const c = (grouped[ck] || []).length; if (c) lines.push({ text: c + ' entidades', bold: false, color: '#888' }); }
      edges.filter(ed => (ed.from === hit || ed.to === hit) && ed.type === 'relation').forEach(ed => { const o = ed.from === hit ? ed.to : ed.from; lines.push({ text: (ed.label || 'Relacionado') + ' → ' + o.label, bold: false, color: '#f59e0b' }); });
      tooltip = { visible: true, x: sx, y: sy, lines };
    } else canvas.style.cursor = 'default';
  };

  canvas.onmouseup = (e) => {
    // Detect click vs drag
    if (clickStart && dragNode) {
      const dx = e.clientX - clickStart.x, dy = e.clientY - clickStart.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const elapsed = Date.now() - clickStart.time;
      if (dist < 5 && elapsed < 300) {
        // It's a click — toggle filter for category nodes
        if (dragNode.type === 'category') {
          highlightLabels.clear();
          setFilter(dragNode.category);
        } else if (dragNode.type === 'contact') {
          highlightLabels.clear();
          activeFilter = null;
          buildLegend();
        }
      }
    }
    if (dragNode && dragNode.id !== '__contact__') dragNode.fixed = false;
    dragNode = null; isPanning = false; clickStart = null; canvas.style.cursor = 'default';
  };

  canvas.onmouseleave = () => { if (dragNode && dragNode.id !== '__contact__') dragNode.fixed = false; dragNode = null; isPanning = false; hoveredNode = null; tooltip.visible = false; };

  canvas.onwheel = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const wBefore = screenToWorld(sx, sy);
    cam.zoom = Math.max(0.15, Math.min(4, cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
    const wAfter = screenToWorld(sx, sy);
    cam.x -= (wAfter.x - wBefore.x); cam.y -= (wAfter.y - wBefore.y);
    targetCam = null; // cancel smooth animation on manual zoom
  };

  // ---- AI Query ----
  const aiInput = document.getElementById('graphAiInput');
  const aiStatus = document.getElementById('graphAiStatus');

  if (aiInput) {
    aiInput.onkeydown = async (e) => {
      if (e.key !== 'Enter') return;
      const question = aiInput.value.trim();
      if (!question) return;

      aiInput.disabled = true;
      aiStatus.style.display = ''; aiStatus.textContent = 'Pensando...';
      highlightLabels.clear(); activeFilter = null;

      try {
        const res = await api('POST', '/ai/graph-query', {
          question,
          entities: data.entities || [],
          summary: data.summary || '',
        });

        if (res.ok && res.data) {
          const { answer, found, matchLabels, suggestedMessage } = res.data;

          if (found && matchLabels && matchLabels.length > 0) {
            matchLabels.forEach(l => highlightLabels.add(l));
            const matched = nodes.filter(n => highlightLabels.has(n.label));
            panToNodes(matched);
            aiStatus.textContent = answer || 'Encontrado!';
            aiStatus.style.color = '#10b981';
          } else {
            aiStatus.style.color = '#f59e0b';
            aiStatus.textContent = answer || 'Informacao nao encontrada no perfil.';
          }
        } else {
          aiStatus.textContent = 'Erro na consulta.'; aiStatus.style.color = '#ef4444';
        }
      } catch {
        aiStatus.textContent = 'Erro ao conectar com IA.'; aiStatus.style.color = '#ef4444';
      }

      aiInput.disabled = false; aiInput.value = '';
      buildLegend();

      // Auto-clear highlight after 8s
      setTimeout(() => { highlightLabels.clear(); aiStatus.style.display = 'none'; }, 8000);
    };
  }

  // ---- Legend ----
  const legend = document.getElementById('graphLegend');
  function buildLegend() {
    if (!legend) return;
    legend.innerHTML = '';
    categories.forEach(cat => {
      const color = CATEGORY_COLORS[cat] || '#6b7280';
      const label = (KNOWLEDGE_CATEGORIES[cat] || { label: cat }).label;
      const item = document.createElement('span');
      item.className = 'graph-legend-item' + (activeFilter === cat ? ' graph-legend-active' : '');
      item.style.opacity = activeFilter === null || activeFilter === cat ? '1' : '0.4';
      item.style.cursor = 'pointer';
      item.innerHTML = '<span class="graph-legend-dot" style="background:' + color + '"></span>' + label;
      item.onclick = () => { highlightLabels.clear(); setFilter(cat); };
      legend.appendChild(item);
    });
    const allItem = document.createElement('span');
    allItem.className = 'graph-legend-item' + (activeFilter === null && highlightLabels.size === 0 ? ' graph-legend-active' : '');
    allItem.style.cursor = 'pointer';
    allItem.innerHTML = '<span class="graph-legend-dot" style="background:#999"></span>Todos';
    allItem.onclick = () => { activeFilter = null; highlightLabels.clear(); buildLegend(); };
    legend.appendChild(allItem);
  }
  buildLegend();
}

