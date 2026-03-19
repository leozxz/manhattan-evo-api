// =====================
// KNOWLEDGE GRAPH VISUALIZATION (Canvas)
// =====================
const CATEGORY_COLORS = {
  PESSOA: '#6366f1', FAMILIA: '#ec4899', FINANCEIRO: '#10b981',
  SAUDE: '#ef4444', MORADIA: '#f59e0b', TRABALHO: '#3b82f6',
  EDUCACAO: '#8b5cf6', INTERESSE: '#14b8a6', EVENTO: '#f97316', SENTIMENTO: '#e879f9',
};

async function resetKnowledgeGraph() {
  // Close current modal
  const existing = document.querySelector('.graph-modal-overlay');
  if (existing) existing.remove();

  toast('Regenerando perfil...');

  try {
    // Re-extract knowledge from messages
    await api('POST', '/knowledge/extract/' + currentInstance, {
      remoteJid: selectedGroup,
      messageCount: 50
    });
  } catch {}

  // Reload unified panel
  loadUnifiedPanel();

  // Reopen graph with fresh data
  await openKnowledgeGraph();
}

async function openKnowledgeGraph() {
  const res = await api('GET', '/knowledge/contact/' + currentInstance + '?remoteJid=' + encodeURIComponent(selectedGroup));
  if (!res.ok || !res.data || !res.data.entities || res.data.entities.length === 0) {
    toast('Nenhum dado para exibir no grafo', 'error');
    return;
  }

  const data = res.data;
  const contactName = data.pushName || selectedGroup.split('@')[0];

  const overlay = document.createElement('div');
  overlay.className = 'graph-modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const modal = document.createElement('div');
  modal.className = 'graph-modal';
  modal.innerHTML = `
    <div class="graph-modal-header">
      <span>Grafo de Conhecimento</span>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="resetKnowledgeGraph()" title="Regerar grafo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#54656f"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
          Regerar
        </button>
        <button class="btn btn-secondary btn-sm" onclick="this.closest('.graph-modal-overlay').remove()">&times;</button>
      </div>
    </div>
    <div class="graph-modal-body">
      <canvas id="knowledgeCanvas"></canvas>
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
    renderGraph(canvas, data, contactName);
  });
}

function renderGraph(canvas, data, contactName) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // ---- Camera (zoom + pan) ----
  let cam = { x: 0, y: 0, zoom: 1 };
  function worldToScreen(wx, wy) {
    return { x: (wx - cam.x) * cam.zoom + W / 2, y: (wy - cam.y) * cam.zoom + H / 2 };
  }
  function screenToWorld(sx, sy) {
    return { x: (sx - W / 2) / cam.zoom + cam.x, y: (sy - H / 2) / cam.zoom + cam.y };
  }

  // ---- Build graph data ----
  const nodes = [];
  const edges = [];

  const center = { id: '__contact__', label: contactName, x: 0, y: 0, vx: 0, vy: 0, r: 40, color: '#111b21', type: 'contact', fixed: true };
  nodes.push(center);

  const grouped = {};
  (data.entities || []).forEach(e => {
    if (!grouped[e.category]) grouped[e.category] = [];
    grouped[e.category].push(e);
  });

  const categories = Object.keys(grouped);
  const catCount = categories.length;

  categories.forEach((cat, ci) => {
    const angle = (2 * Math.PI * ci) / catCount - Math.PI / 2;
    const catRadius = 200;
    const catColor = CATEGORY_COLORS[cat] || '#6b7280';
    const catLabel = (KNOWLEDGE_CATEGORIES[cat] || { label: cat }).label;

    const catNode = {
      id: 'cat_' + cat, label: catLabel,
      x: Math.cos(angle) * catRadius, y: Math.sin(angle) * catRadius,
      vx: 0, vy: 0, r: 30, color: catColor, type: 'category'
    };
    nodes.push(catNode);
    edges.push({ from: center, to: catNode, color: catColor, strength: 0.3, type: 'hierarchy' });

    const entities = grouped[cat];
    entities.forEach((ent, ei) => {
      const eAngle = angle + ((ei - (entities.length - 1) / 2) * 0.45);
      const entRadius = catRadius + 120;
      const entNode = {
        id: ent.id, label: ent.label, value: ent.value, category: cat,
        x: Math.cos(eAngle) * entRadius + (Math.random() - 0.5) * 20,
        y: Math.sin(eAngle) * entRadius + (Math.random() - 0.5) * 20,
        vx: 0, vy: 0, r: 20, color: catColor, type: 'entity'
      };
      nodes.push(entNode);
      edges.push({ from: catNode, to: entNode, color: catColor, strength: 0.4, type: 'hierarchy' });
    });
  });

  // Relationship edges
  (data.relationships || []).forEach(r => {
    const fromNode = nodes.find(n => n.label === r.fromEntity?.label && n.type === 'entity');
    const toNode = nodes.find(n => n.label === r.toEntity?.label && n.type === 'entity');
    if (fromNode && toNode) {
      edges.push({ from: fromNode, to: toNode, color: '#f59e0b', strength: 0.1, type: 'relation', label: r.type, description: r.description });
    }
  });

  // Auto-correlate entities that share keywords
  const entityNodes = nodes.filter(n => n.type === 'entity');
  for (let i = 0; i < entityNodes.length; i++) {
    for (let j = i + 1; j < entityNodes.length; j++) {
      const a = entityNodes[i];
      const b = entityNodes[j];
      if (a.category === b.category) continue;
      const aText = ((a.label || '') + ' ' + (a.value || '')).toLowerCase();
      const bText = ((b.label || '') + ' ' + (b.value || '')).toLowerCase();
      const aWords = a.label.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const bWords = b.label.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const hasLink = aWords.some(w => bText.includes(w)) || bWords.some(w => aText.includes(w));
      if (hasLink) {
        const exists = edges.some(e => e.type === 'relation' &&
          ((e.from === a && e.to === b) || (e.from === b && e.to === a)));
        if (!exists) {
          edges.push({ from: a, to: b, color: '#94a3b8', strength: 0.05, type: 'inferred' });
        }
      }
    }
  }

  // ---- Force-directed simulation ----
  let simRunning = true;
  let simAlpha = 1;

  function simulate() {
    if (simAlpha < 0.001) { simRunning = false; return; }
    simAlpha *= 0.97;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = (a.r + b.r) * 2.5;
        const force = simAlpha * 800 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
        if (!b.fixed) { b.vx += fx; b.vy += fy; }
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const px = (dx / dist) * push;
          const py = (dy / dist) * push;
          if (!a.fixed) { a.x -= px; a.y -= py; }
          if (!b.fixed) { b.x += px; b.y += py; }
        }
      }
    }

    edges.forEach(e => {
      const dx = e.to.x - e.from.x;
      const dy = e.to.y - e.from.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetDist = e.type === 'hierarchy' ? (e.from.type === 'contact' ? 200 : 120) : 250;
      const force = (dist - targetDist) * (e.strength || 0.1) * simAlpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!e.from.fixed) { e.from.vx += fx; e.from.vy += fy; }
      if (!e.to.fixed) { e.to.vx -= fx; e.to.vy -= fy; }
    });

    nodes.forEach(n => {
      if (n.fixed) return;
      n.vx -= n.x * 0.002 * simAlpha;
      n.vy -= n.y * 0.002 * simAlpha;
    });

    nodes.forEach(n => {
      if (n.fixed) return;
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += n.vx;
      n.y += n.vy;
    });
  }

  // ---- Interaction state ----
  let hoveredNode = null;
  let dragNode = null;
  let isPanning = false;
  let lastMouse = { x: 0, y: 0 };
  let tooltip = { visible: false, x: 0, y: 0, lines: [] };

  function hitTest(sx, sy) {
    const w = screenToWorld(sx, sy);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = w.x - n.x, dy = w.y - n.y;
      if (dx * dx + dy * dy < (n.r + 4) * (n.r + 4)) return n;
    }
    return null;
  }

  // ---- Drawing ----
  function drawEdge(e, highlight) {
    const s1 = worldToScreen(e.from.x, e.from.y);
    const s2 = worldToScreen(e.to.x, e.to.y);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);

    if (e.type === 'relation' || e.type === 'inferred') {
      const mx = (s1.x + s2.x) / 2;
      const my = (s1.y + s2.y) / 2;
      const dx = s2.x - s1.x, dy = s2.y - s1.y;
      const nx = -dy * 0.15, ny = dx * 0.15;
      ctx.quadraticCurveTo(mx + nx, my + ny, s2.x, s2.y);
    } else {
      ctx.lineTo(s2.x, s2.y);
    }

    ctx.strokeStyle = highlight ? e.color : (e.color + (e.type === 'hierarchy' ? '40' : '60'));
    ctx.lineWidth = (highlight ? 2.5 : (e.type === 'hierarchy' ? 1.5 : 1)) * cam.zoom;
    if (e.type === 'relation') ctx.setLineDash([6 * cam.zoom, 4 * cam.zoom]);
    else if (e.type === 'inferred') ctx.setLineDash([3 * cam.zoom, 3 * cam.zoom]);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (e.label && highlight && cam.zoom > 0.6) {
      const lx = (s1.x + s2.x) / 2;
      const ly = (s1.y + s2.y) / 2 - 8 * cam.zoom;
      ctx.font = (10 * cam.zoom) + 'px -apple-system,sans-serif';
      ctx.fillStyle = e.color;
      ctx.textAlign = 'center';
      ctx.fillText(e.label, lx, ly);
    }
  }

  function drawNode(n, highlight) {
    const s = worldToScreen(n.x, n.y);
    const sr = n.r * cam.zoom;

    if (highlight) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, sr + 8 * cam.zoom, 0, 2 * Math.PI);
      ctx.fillStyle = n.color + '25';
      ctx.fill();
    }

    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 6 * cam.zoom;

    ctx.beginPath();
    ctx.arc(s.x, s.y, sr, 0, 2 * Math.PI);
    if (n.type === 'entity') {
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = n.color;
      ctx.lineWidth = 2.5 * cam.zoom;
      ctx.stroke();
    } else {
      ctx.fillStyle = n.color;
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    if (n.type !== 'entity') {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + (n.type === 'contact' ? 13 : 10) * cam.zoom + 'px -apple-system,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxChars = Math.floor(n.r * 2 / (n.type === 'contact' ? 8 : 6));
      const lbl = n.label.length > maxChars ? n.label.substring(0, maxChars - 1) + '..' : n.label;
      ctx.fillText(lbl, s.x, s.y);
    }

    if (n.type === 'entity' && cam.zoom > 0.4) {
      ctx.fillStyle = '#444';
      ctx.font = (10 * cam.zoom) + 'px -apple-system,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const maxW = 120 * cam.zoom;
      const lbl = n.label;
      const words = lbl.split(' ');
      let line = '';
      let ly = s.y + sr + 4 * cam.zoom;
      words.forEach(word => {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) {
          ctx.fillText(line, s.x, ly);
          line = word;
          ly += 12 * cam.zoom;
        } else {
          line = test;
        }
      });
      if (line) ctx.fillText(line, s.x, ly);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, H);

    if (cam.zoom > 0.3) {
      const gridSize = 40;
      const tl = screenToWorld(0, 0);
      const br = screenToWorld(W, H);
      ctx.fillStyle = '#e8e8e8';
      for (let gx = Math.floor(tl.x / gridSize) * gridSize; gx < br.x; gx += gridSize) {
        for (let gy = Math.floor(tl.y / gridSize) * gridSize; gy < br.y; gy += gridSize) {
          const sp = worldToScreen(gx, gy);
          ctx.fillRect(sp.x - 0.5, sp.y - 0.5, 1, 1);
        }
      }
    }

    const highlightEdges = new Set();
    const highlightNodes = new Set();
    if (hoveredNode) {
      highlightNodes.add(hoveredNode);
      edges.forEach((e, i) => {
        if (e.from === hoveredNode || e.to === hoveredNode) {
          highlightEdges.add(i);
          highlightNodes.add(e.from);
          highlightNodes.add(e.to);
        }
      });
    }

    edges.forEach((e, i) => drawEdge(e, highlightEdges.has(i)));
    nodes.forEach(n => drawNode(n, highlightNodes.size === 0 || highlightNodes.has(n)));

    if (tooltip.visible && tooltip.lines.length > 0) {
      const pad = 10;
      const lineH = 16;
      ctx.font = '12px -apple-system,sans-serif';
      const maxW = Math.max(...tooltip.lines.map(l => ctx.measureText(l.text).width)) + pad * 2;
      const boxH = tooltip.lines.length * lineH + pad * 2;
      let tx = tooltip.x + 18;
      let ty = tooltip.y - boxH / 2;
      if (tx + maxW > W) tx = tooltip.x - maxW - 18;
      if (ty < 4) ty = 4;
      if (ty + boxH > H - 4) ty = H - boxH - 4;

      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.roundRect(tx, ty, maxW, boxH, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      ctx.stroke();

      tooltip.lines.forEach((line, i) => {
        ctx.font = line.bold ? 'bold 12px -apple-system,sans-serif' : '11px -apple-system,sans-serif';
        ctx.fillStyle = line.color || '#333';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(line.text, tx + pad, ty + pad + i * lineH);
      });
    }

    ctx.fillStyle = '#aaa';
    ctx.font = '11px -apple-system,sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(Math.round(cam.zoom * 100) + '%', W - 12, H - 8);
  }

  // ---- Animation loop ----
  let animFrame;
  function loop() {
    if (simRunning) simulate();
    draw();
    animFrame = requestAnimationFrame(loop);
  }
  loop();

  const overlayEl = canvas.closest('.graph-modal-overlay');
  const observer = new MutationObserver(() => {
    if (!document.body.contains(canvas)) {
      cancelAnimationFrame(animFrame);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  // ---- Mouse events ----
  canvas.onmousedown = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const hit = hitTest(sx, sy);
    if (hit) {
      dragNode = hit;
      dragNode.fixed = true;
      simAlpha = 0.3;
      simRunning = true;
    } else {
      isPanning = true;
    }
    lastMouse = { x: e.clientX, y: e.clientY };
  };

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    if (dragNode) {
      const w = screenToWorld(sx, sy);
      dragNode.x = w.x;
      dragNode.y = w.y;
      dragNode.vx = 0;
      dragNode.vy = 0;
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (isPanning) {
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      cam.x -= dx / cam.zoom;
      cam.y -= dy / cam.zoom;
      lastMouse = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
      return;
    }

    const hit = hitTest(sx, sy);
    hoveredNode = hit;
    tooltip.visible = false;

    if (hit) {
      canvas.style.cursor = 'pointer';
      const lines = [{ text: hit.label, bold: true, color: hit.color }];
      if (hit.value) lines.push({ text: hit.value, bold: false });
      if (hit.type === 'category') {
        const count = (grouped[hit.label.toUpperCase()] || grouped[Object.keys(grouped).find(k => (KNOWLEDGE_CATEGORIES[k] || {}).label === hit.label)] || []).length;
        if (count) lines.push({ text: count + ' entidades', bold: false, color: '#888' });
      }
      edges.filter(ed => (ed.from === hit || ed.to === hit) && ed.type === 'relation').forEach(ed => {
        const other = ed.from === hit ? ed.to : ed.from;
        lines.push({ text: (ed.label || 'Relacionado') + ' → ' + other.label, bold: false, color: '#f59e0b' });
      });
      tooltip = { visible: true, x: sx, y: sy, lines };
    } else {
      canvas.style.cursor = 'default';
    }
  };

  canvas.onmouseup = () => {
    if (dragNode && dragNode.id !== '__contact__') dragNode.fixed = false;
    dragNode = null;
    isPanning = false;
    canvas.style.cursor = 'default';
  };

  canvas.onmouseleave = () => {
    if (dragNode && dragNode.id !== '__contact__') dragNode.fixed = false;
    dragNode = null;
    isPanning = false;
    hoveredNode = null;
    tooltip.visible = false;
  };

  canvas.onwheel = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const wBefore = screenToWorld(sx, sy);
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    cam.zoom = Math.max(0.15, Math.min(4, cam.zoom * factor));
    const wAfter = screenToWorld(sx, sy);
    cam.x -= (wAfter.x - wBefore.x);
    cam.y -= (wAfter.y - wBefore.y);
  };

  // Legend
  const legend = document.getElementById('graphLegend');
  if (legend) {
    const items = categories.map(cat => {
      const color = CATEGORY_COLORS[cat] || '#6b7280';
      const label = (KNOWLEDGE_CATEGORIES[cat] || { label: cat }).label;
      return '<span class="graph-legend-item"><span class="graph-legend-dot" style="background:' + color + '"></span>' + label + '</span>';
    });
    items.push('<span class="graph-legend-item"><span class="graph-legend-dot" style="background:#f59e0b"></span>Correlacao</span>');
    items.push('<span class="graph-legend-item"><span class="graph-legend-dot" style="background:#94a3b8"></span>Inferida</span>');
    legend.innerHTML = items.join('');
  }
}
