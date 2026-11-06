/* Offline UI: all imported strings enter the DOM through textContent. */
(function () {
  'use strict';
  const C = globalThis.ExplorerCore, $ = id => document.getElementById(id);
  let data = null, idx = null, selected = null, pageSize = 100, graph = null, positions = new Map();
  let zoom = 1, pan = { x: 0, y: 0 }, drag = null, loadToken = 0;
  const canvas = $('graph'), ctx = canvas.getContext('2d');
  const colors = { request: '#1466ab', ordering: '#9a5900', other: '#7954a1' };
  function el(tag, text, cls) {
    const e = document.createElement(tag); if (text !== undefined) e.textContent = String(text); if (cls) e.className = cls; return e;
  }
  function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; }
  function button(name) { const b = el('button', name); b.type = 'button'; b.addEventListener('click', () => choose(name)); return b; }
  function field(list, name, value) { list.append(el('dt', name), el('dd', value === null || value === undefined || value === '' ? 'Unknown / not collected' : value)); }
  function setOptions(id, values, all) {
    const e = $(id); e.replaceChildren(el('option', all)); e.firstChild.value = '';
    for (const v of Array.from(new Set(values)).sort()) { const o = el('option', v); o.value = v; e.append(o); }
  }
  async function load(file) {
    if (!file) return;
    const token = ++loadToken;
    try {
      if (file.size > 100 * 1024 * 1024) throw Error('Snapshot exceeds the 100 MiB browser input limit.');
      const text = await file.text();
      if (token !== loadToken) return;
      const parsed = C.validate(JSON.parse(text));
      data = parsed; idx = C.index(data); selected = null; pageSize = 100; graph = null; positions.clear();
      $('search').value = ''; $('detail').textContent = 'Select a unit from the inventory.';
      $('graph-status').textContent = 'Select a unit to explore a bounded neighborhood.';
      setOptions('type', Array.from(idx.units.values()).map(u => u.unit_type || 'unknown'), 'All types');
      setOptions('state', Array.from(idx.units.values()).map(u => u.active_state || 'unknown'), 'All states');
      $('kinds').replaceChildren();
      for (const kind of Array.from(new Set(data.relations.map(e => e.kind))).sort()) {
        const label = el('label', undefined, C.category(kind) === 'ordering' ? 'order' : C.category(kind) === 'request' ? 'request' : 'other');
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = kind; input.checked = true;
        input.addEventListener('change', updateGraph); label.append(input, document.createTextNode(kind)); $('kinds').append(label);
      }
      $('overview').replaceChildren();
      for (const text of [`${idx.units.size} units (including references)`, `${data.relations.filter(e => e.evidence === 'effective').length} effective relations`, `${data.warnings.length} warnings`, `systemd: ${data.metadata.systemd_version || 'unknown'}`, `boot: ${data.metadata.boot_id || 'unknown'}`]) $('overview').append(el('span', text, 'stat'));
      for (const key of ['unit_type', 'active_state']) {
        const counts = new Map();
        for (const u of idx.units.values()) { const value = u[key] || 'unknown'; counts.set(value, (counts.get(value) || 0) + 1); }
        for (const [value, count] of Array.from(counts).sort()) $('overview').append(el('span', `${key === 'unit_type' ? 'type' : 'state'} ${value}: ${count}`, 'stat'));
      }
      const diagnostic = $('diagnostic-body'); diagnostic.replaceChildren();
      diagnostic.append(el('p', 'Collection start (Unix ms): ' + (data.metadata.collected_at_unix_ms ?? 'unknown')), el('p', 'Collection end (Unix ms): ' + (data.metadata.finished_at_unix_ms ?? 'unknown')), el('p', data.metadata.history || 'Full history unavailable.'));
      for (const d of Array.isArray(data.metadata.diagnostics) ? data.metadata.diagnostics : []) if (d) diagnostic.append(el('div', `${d.item}: ${d.status} — ${d.detail}`));
      for (const w of data.warnings) if (w) diagnostic.append(el('div', `${w.unit || 'snapshot'} / ${w.item}: ${w.message}`, 'warning'));
      message(idx.units.size ? `Loaded ${file.name}. ${data.warnings.length ? 'Partial observations: inspect collection warnings.' : 'Review diagnostics for collection coverage.'}` : 'Snapshot contains no units. Collection diagnostics may explain missing data.');
      renderInventory(); renderTimeline(); resetView();
    } catch (e) {
      if (token !== loadToken) return;
      data = null; idx = null; selected = null; graph = null; positions.clear();
      for (const id of ['units', 'overview', 'detail', 'timeline', 'diagnostic-body', 'kinds']) $(id).replaceChildren();
      $('more').hidden = true; $('list-count').textContent = ''; $('graph-status').textContent = 'No valid snapshot loaded.';
      draw(); message('Could not load snapshot: ' + e.message, true);
    }
  }
  function renderInventory() {
    if (!idx) return;
    const rows = C.filteredUnits(idx, $('search').value, $('type').value, $('state').value);
    $('list-count').textContent = `${rows.length} matches · showing ${Math.min(rows.length, pageSize)}`;
    $('units').replaceChildren();
    for (const u of rows.slice(0, pageSize)) {
      const b = button(u.name); b.className = 'unit-row' + (selected === u.name ? ' selected' : '');
      b.append(el('small', `${u.unit_type || 'unknown'} · ${u.active_state || 'unknown'} / ${u.sub_state || 'unknown'}${u.unresolved ? ' · unresolved reference' : ''}`));
      $('units').append(b);
    }
    $('more').hidden = rows.length <= pageSize;
  }
  function choose(name) {
    if (!idx || !idx.units.has(name)) return;
    selected = name; renderInventory(); renderDetails(); updateGraph();
  }
  function renderDetails() {
    const u = idx.units.get(selected), out = $('detail'); out.replaceChildren(el('h3', u.name));
    const dl = el('dl'); out.append(dl);
    for (const [label, key] of [['Type', 'unit_type'], ['Description', 'description'], ['Load state', 'load_state'], ['Active state', 'active_state'], ['Sub state', 'sub_state'], ['Unit file state', 'unit_file_state'], ['FragmentPath (manager observation)', 'fragment_path'], ['SourcePath', 'source_path']]) field(dl, label, u[key]);
    field(dl, 'Inventory', `${u.loaded ? 'Manager loaded inventory' : 'Not observed loaded'}; ${u.installed ? 'installed inventory' : 'not observed installed'}${u.unresolved ? '; unresolved reference' : ''}`);
    field(dl, 'DropInPaths', (u.drop_in_paths || []).join('\n'));
    field(dl, 'Generator clue', u.generator_hint ? 'Fragment path is in a runtime generator directory; exact origin undetermined.' : 'No positive clue collected (not proof of absence).');
    field(dl, 'DefaultDependencies', u.default_dependencies === undefined || u.default_dependencies === null ? null : String(u.default_dependencies) + ' (does not attribute individual edges)');
    field(dl, 'NeedDaemonReload', u.need_daemon_reload === undefined || u.need_daemon_reload === null ? null : String(u.need_daemon_reload));
    field(dl, '[Install] WantedBy (fragment-only disk hint)', (u.install_wanted_by || []).join('\n'));
    for (const note of u.config_notes || []) out.append(el('p', note, 'muted'));
    out.append(el('h3', 'Observed times'));
    const times = data.timings.filter(t => t.unit === selected);
    if (!times.length) out.append(el('p', 'Unknown / not collected. No conclusion about activation history.'));
    for (const t of times) {
      const s = C.seconds(t);
      out.append(el('p', `${t.event}: ${s === null ? 'unknown or unsupported clock/certainty' : s.toFixed(6) + ' seconds since boot'} · ${t.source || 'source unknown'}`));
    }
    for (const d of data.devices.filter(d => d.unit === selected)) {
      out.append(el('h3', 'Device / udev observation'), el('p', d.sysfs_path || 'Sysfs path unknown'), el('pre', JSON.stringify(d.properties || {}, null, 2)), el('p', 'Rule origin: ' + (d.rule_origin || 'undetermined')));
      const wants = d.properties && d.properties.SYSTEMD_WANTS;
      if (typeof wants === 'string') {
        out.append(el('p', 'SYSTEMD_WANTS property is a device hint, not proof of an activation transaction.'));
        for (const name of wants.split(/\s+/)) if (idx.units.has(name)) out.append(button(name));
      }
    }
    const warnings = data.warnings.filter(w => w && w.unit === selected);
    if (warnings.length) { out.append(el('h3', 'Warnings')); for (const w of warnings) out.append(el('p', `${w.item}: ${w.message}`, 'warning')); }
    out.append(el('h3', 'Incoming / outgoing relationships'));
    const edges = (idx.adjacency.get(selected) || []).map(i => idx.relations[i]);
    if (!edges.length) out.append(el('p', 'No relationships collected. This is not proof of no dependencies.'));
    // Details are paginated separately so graph caps never hide navigation entirely.
    let shown = 0;
    const more = el('button', 'Show more relationships');
    function appendEdges() {
      for (const e of edges.slice(shown, shown + 100)) {
        const div = el('div', undefined, 'relation ' + C.category(e.kind) + (e.evidence === 'effective' ? '' : ' disk'));
        const other = e.from === selected ? e.to : e.from;
        div.append(el('small', `${e.from} → ${e.to} · ${e.kind}`), button(other), el('small', `${e.evidence} · certainty: ${e.confidence || 'unknown'} · origin: ${e.origin || 'undetermined'}`), el('small', e.source || 'Source unknown'));
        if (e.evidence !== 'effective') div.append(el('small', 'Disk hint only; does not establish a manager dependency or activation.'));
        out.insertBefore(div, more);
      }
      shown += 100; more.hidden = shown >= edges.length;
    }
    out.append(more); more.addEventListener('click', appendEdges); appendEdges();
  }
  function updateGraph() {
    if (!idx || !selected) return;
    const layers = new Set(Array.from($('evidence').querySelectorAll('input:checked'), c => c.value));
    const kinds = new Set(Array.from($('kinds').querySelectorAll('input:checked'), c => c.value));
    graph = C.neighborhood(idx, selected, $('hops').value, e => layers.has(e.evidence) && kinds.has(e.kind));
    positions.clear();
    const groups = new Map();
    for (const n of graph.nodes) { if (!groups.has(n.depth)) groups.set(n.depth, []); groups.get(n.depth).push(n); }
    for (const [depth, group] of groups) group.forEach((n, i) => {
      const angle = i * Math.PI * 2 / group.length - Math.PI / 2;
      positions.set(n.unit.name, { x: depth ? Math.cos(angle) * depth * 190 : 0, y: depth ? Math.sin(angle) * depth * 190 : 0, u: n.unit });
    });
    $('graph-status').textContent = `${selected} · ${graph.nodes.length} nodes / ${graph.edges.length} edges${graph.truncated ? ' · TRUNCATED: reduce hops or disable relation layers. All collected relationships remain in details.' : ''}`;
    resetView();
  }
  function resetView() {
    const width = canvas.clientWidth || 500, height = canvas.clientHeight || 480;
    let extentX = 150, extentY = 60;
    for (const p of positions.values()) { extentX = Math.max(extentX, Math.abs(p.x) + 110); extentY = Math.max(extentY, Math.abs(p.y) + 30); }
    zoom = Math.min(1, width / (extentX * 2), height / (extentY * 2)); pan = { x: width / 2, y: height / 2 }; draw();
  }
  function draw() {
    const dpr = window.devicePixelRatio || 1, width = canvas.clientWidth || 500, height = canvas.clientHeight || 480;
    canvas.width = width * dpr; canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    if (!graph) { ctx.fillStyle = '#53677c'; ctx.font = '14px system-ui'; ctx.fillText('Select a unit to explore its neighborhood.', 16, 32); return; }
    ctx.translate(pan.x, pan.y); ctx.scale(zoom, zoom);
    for (const e of graph.edges) {
      const a = positions.get(e.from), b = positions.get(e.to); if (!a || !b) continue;
      const category = C.category(e.kind); ctx.strokeStyle = colors[category]; ctx.fillStyle = colors[category]; ctx.lineWidth = 1.5 / Math.sqrt(zoom);
      ctx.setLineDash(e.evidence !== 'effective' ? [2, 5] : category === 'ordering' ? [8, 5] : []);
      if (e.from === e.to) { ctx.beginPath(); ctx.arc(a.x + 70, a.y - 14, 22, 0, Math.PI * 2); ctx.stroke(); continue; }
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      const endX = b.x - ux * 28, endY = b.y - uy * 28;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(endX, endY); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(endX, endY); ctx.lineTo(endX - ux * 10 - uy * 5, endY - uy * 10 + ux * 5); ctx.lineTo(endX - ux * 10 + uy * 5, endY - uy * 10 - ux * 5); ctx.fill();
    }
    ctx.setLineDash([]);
    for (const [name, p] of positions) {
      ctx.fillStyle = name === selected ? '#d8eaff' : p.u.unresolved ? '#fff2d6' : '#ffffff'; ctx.strokeStyle = name === selected ? '#1466ab' : '#8299ae';
      ctx.lineWidth = name === selected ? 2 : 1; ctx.fillRect(p.x - 90, p.y - 20, 180, 40); ctx.strokeRect(p.x - 90, p.y - 20, 180, 40);
      ctx.fillStyle = '#203349'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText(name.length > 24 ? name.slice(0, 22) + '…' : name, p.x, p.y - 1);
      ctx.font = '10px system-ui'; ctx.fillText(`${p.u.unit_type || 'unknown'} · ${p.u.active_state || 'unknown'}`, p.x, p.y + 13);
    }
  }
  function renderTimeline() {
    const out = $('timeline'); out.replaceChildren();
    if (data.metadata.boot_id && data.metadata.boot_id_at_end && data.metadata.boot_id !== data.metadata.boot_id_at_end) {
      out.append(el('p', 'Boot ID changed during collection. A shared boot timeline cannot be established; inspect individual raw observations and warnings.', 'warning'));
      return;
    }
    const valid = data.timings.filter(t => C.seconds(t) !== null && t.event === 'ActiveEnterTimestampMonotonic').sort((a, b) => a.value - b.value);
    const known = new Set(valid.map(t => t.unit));
    out.append(el('p', `${valid.length} observed latest active-entry timestamps; ${Array.from(idx.units.keys()).filter(n => !known.has(n)).length} units without comparable active-entry timing. Showing up to 200 observations; all per-unit times remain in details.`));
    if (!valid.length) { out.append(el('p', 'No comparable timing observations available.')); return; }
    const max = valid.reduce((max, t) => Math.max(max, C.seconds(t)), 1);
    for (const t of valid.slice(0, 200)) {
      const row = el('div', undefined, 'timing-row'), track = el('div', undefined, 'track'), marker = el('span', undefined, 'marker');
      marker.style.left = Math.min(99, C.seconds(t) / max * 99) + '%'; track.append(marker);
      row.append(button(t.unit), track, el('span', C.seconds(t).toFixed(3) + ' s')); out.append(row);
    }
  }
  $('file').addEventListener('change', e => load(e.target.files[0]));
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); load(e.dataTransfer.files[0]); });
  for (const id of ['search', 'type', 'state']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { pageSize = 100; renderInventory(); });
  $('more').addEventListener('click', () => { pageSize += 100; renderInventory(); });
  $('hops').addEventListener('change', updateGraph);
  $('evidence').addEventListener('change', updateGraph);
  $('fit').addEventListener('click', resetView);
  function scale(factor, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2) {
    const next = Math.min(4, Math.max(.08, zoom * factor)), ratio = next / zoom;
    pan = { x: x - (x - pan.x) * ratio, y: y - (y - pan.y) * ratio }; zoom = next; draw();
  }
  $('zoom-in').addEventListener('click', () => scale(1.25)); $('zoom-out').addEventListener('click', () => scale(.8));
  canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); scale(e.deltaY < 0 ? 1.12 : .89, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    pan.x += e.clientX - drag.x; pan.y += e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; draw();
  });
  canvas.addEventListener('pointerup', e => {
    if (!drag) return;
    const clicked = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5; drag = null;
    if (clicked) {
      const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left - pan.x) / zoom, y = (e.clientY - r.top - pan.y) / zoom;
      for (const [name, p] of positions) if (Math.abs(x - p.x) <= 90 && Math.abs(y - p.y) <= 20) { choose(name); break; }
    }
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  window.addEventListener('resize', draw); draw();
})();
