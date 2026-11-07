/* Offline global timeline: points are observed transitions, never inferred durations. */
(function (root) {
  'use strict';
  const T = root.ExplorerTimelineData;
  const OVERVIEW_HEIGHT = 88;
  const EVENTS = {
    InactiveExitTimestampMonotonic: { label: 'Inactive exit', color: '#1466ab', lane: 0 },
    ActiveEnterTimestampMonotonic: { label: 'Active entry', color: '#26794c', lane: 1 },
    ActiveExitTimestampMonotonic: { label: 'Active exit', color: '#a85d00', lane: 2 },
    InactiveEnterTimestampMonotonic: { label: 'Inactive entry', color: '#75638b', lane: 3 },
  };
  function create({ document: doc, element, onSelect }) {
    let model = null, range = { start: 0, end: 1 }, flat = { rows: [], totalHeight: 0, matchingUnits: 0 };
    let collapsed = new Set(), selected = null, brush = null, pending = false;
    function el(tag, text, id, cls) {
      const e = doc.createElement(tag); if (text !== undefined) e.textContent = String(text); if (id) e.id = id; if (cls) e.className = cls; return e;
    }
    function control(text, id, action) { const e = el('button', text, id); e.type = 'button'; e.addEventListener('click', action); return e; }
    function labeled(text, input) { const label = el('label', text); label.append(input); return label; }
    const status = el('p', '', 'timeline-status'); status.setAttribute('role', 'status');
    const search = el('input', undefined, 'timeline-search'); search.type = 'search'; search.placeholder = 'Unit name or description…';
    const includeUnknown = el('input', undefined, 'timeline-unknown'); includeUnknown.type = 'checkbox'; includeUnknown.checked = true;
    const startInput = el('input', undefined, 'timeline-start'), endInput = el('input', undefined, 'timeline-end');
    for (const input of [startInput, endInput]) { input.type = 'number'; input.min = '0'; input.step = 'any'; }
    const error = el('p', '', 'timeline-range-error', 'warning'); error.setAttribute('role', 'alert');
    const overview = el('canvas', undefined, 'timeline-overview');
    overview.setAttribute('aria-label', 'All observed transitions: drag to select a time range, or use the start/end time controls. Counts do not represent active units.');
    const context = overview.getContext('2d');
    const filters = el('div', undefined, undefined, 'timeline-toolbar');
    filters.append(labeled('Find units ', search), labeled('Show units with unknown timings ', includeUnknown),
      control('Collapse types', 'timeline-collapse', () => { if (!model) return; collapsed = new Set(model.groups.map(g => g.type)); rebuild(); }),
      control('Expand types', 'timeline-expand', () => { collapsed.clear(); rebuild(); }));
    const controls = el('div', undefined, undefined, 'timeline-toolbar');
    const changeRange = next => { if (!model || model.crossBoot) return; range = next; error.textContent = ''; updateRangeInputs(); rebuild(); };
    controls.append(labeled('From (seconds) ', startInput), labeled('To (seconds) ', endInput),
      control('Apply range', 'timeline-apply', () => {
        if (!model || model.crossBoot) return;
        const next = startInput.value.trim() && endInput.value.trim() ? T.windowRange(Number(startInput.value), Number(endInput.value), model.domainEnd) : null;
        if (!next) { error.textContent = `Use a range with 0 ≤ start < end ≤ ${model.domainEnd.toFixed(6)} seconds.`; return; }
        changeRange(next);
      }),
      control('Zoom in', 'timeline-zoom-in', () => { if (model) changeRange(T.zoomRange(range, .5, model.domainEnd)); }),
      control('Zoom out', 'timeline-zoom-out', () => { if (model) changeRange(T.zoomRange(range, 2, model.domainEnd)); }),
      control('Earlier', 'timeline-earlier', () => pan(-.5)), control('Later', 'timeline-later', () => pan(.5)),
      control('Full range', 'timeline-reset', () => { if (model) changeRange({ start: 0, end: model.domainEnd }); }));
    const legend = el('div', undefined, undefined, 'timeline-legend');
    for (const event of Object.values(EVENTS)) { const label = el('span', '● ' + event.label); label.style.color = event.color; legend.append(label); }
    const axis = el('div', undefined, 'timeline-axis', 'timeline-axis');
    const viewport = el('div', undefined, 'timeline-viewport'); viewport.tabIndex = 0;
    viewport.setAttribute('aria-label', 'Unit transition rows; scroll vertically. Only visible rows are rendered.');
    const rows = el('div', undefined, 'timeline-rows'); viewport.append(rows);
    element.replaceChildren(status, filters, el('p', 'Overview: all snapshot observations, including later restarts. Histogram counts transitions, not concurrent active units.', undefined, 'muted'), overview, controls, error, legend, axis, viewport);
    function updateRangeInputs() { startInput.value = String(range.start); endInput.value = String(range.end); }
    function pan(fraction) {
      if (!model) return;
      const span = range.end - range.start, start = Math.max(0, Math.min(model.domainEnd - span, range.start + span * fraction));
      changeRange({ start, end: Math.min(model.domainEnd, start + span) });
    }
    function drawOverview(preview = range) {
      const width = overview.clientWidth || 600, height = OVERVIEW_HEIGHT, dpr = root.window.devicePixelRatio || 1;
      overview.width = width * dpr; overview.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height);
      if (!model || model.crossBoot) return;
      const peak = Math.max(1, ...model.bins);
      context.fillStyle = '#819bb4';
      model.bins.forEach((count, i) => { const h = count / peak * (height - 20); context.fillRect(i / model.bins.length * width, height - 18 - h, Math.max(1, width / model.bins.length - 1), h); });
      const x = preview.start / model.domainEnd * width, w = (preview.end - preview.start) / model.domainEnd * width;
      context.fillStyle = 'rgba(20,102,171,.14)'; context.fillRect(x, 0, w, height - 16);
      context.strokeStyle = '#1466ab'; context.lineWidth = 2; context.strokeRect(x, 0, w, height - 16);
      context.fillStyle = '#203349'; context.font = '11px system-ui'; context.textAlign = 'left'; context.fillText('0 s', 2, height - 2);
      context.textAlign = 'right'; context.fillText(model.domainEnd.toFixed(3) + ' s', width - 2, height - 2);
    }
    function renderVisible() {
      rows.replaceChildren();
      if (!model || model.crossBoot) return;
      for (const entry of T.visible(flat.rows, viewport.scrollTop || 0, viewport.clientHeight || 480)) {
        const row = el('div', undefined, undefined, 'timeline-virtual-row'); row.style.top = entry.top + 'px'; row.style.height = entry.height + 'px';
        if (entry.kind === 'group') {
          row.className += ' timeline-type-row';
          const button = control(`${collapsed.has(entry.type) ? '▸' : '▾'} ${entry.type} · ${entry.count} units`, undefined, () => {
            if (collapsed.has(entry.type)) collapsed.delete(entry.type); else collapsed.add(entry.type); rebuild(false);
          });
          button.setAttribute('aria-expanded', String(!collapsed.has(entry.type))); row.append(button);
        } else {
          const record = entry.record, name = record.unit.name, label = el('div', undefined, undefined, 'timeline-unit-label');
          const button = control(name, undefined, () => onSelect(name)); button.className = 'timeline-unit-name'; button.title = name;
          label.append(button, el('small', `${record.unit.unit_type || 'unknown'} · ${record.unit.active_state || 'unknown'} (snapshot)`));
          const track = el('div', undefined, undefined, 'timeline-unit-track');
          if (!record.events.length) track.append(el('span', 'Timing unknown', undefined, 'timeline-missing'));
          for (const point of record.events) {
            if (point.time < range.start || point.time > range.end) continue;
            const style = EVENTS[point.event] || { label: point.event, color: '#53677c', lane: 0 };
            const marker = el('span', undefined, undefined, 'timeline-event');
            marker.style.left = ((point.time - range.start) / (range.end - range.start) * 100) + '%';
            marker.style.top = (5 + style.lane * 11) + 'px'; marker.style.backgroundColor = style.color;
            marker.title = `${name}: ${style.label} at ${point.time.toFixed(6)} s since boot · ${point.source}`;
            marker.setAttribute('aria-label', marker.title); track.append(marker);
          }
          if (selected === name) row.className += ' selected';
          row.append(label, track);
        }
        rows.append(row);
      }
    }
    function rebuild(resetScroll = true) {
      axis.replaceChildren();
      if (!model) { status.textContent = 'Open a snapshot to inspect the global timeline.'; rows.replaceChildren(); rows.style.height = '0px'; drawOverview(); return; }
      if (model.crossBoot) { status.textContent = 'Boot ID changed during collection. A shared boot timeline cannot be established; inspect per-unit observations.'; rows.replaceChildren(); rows.style.height = '0px'; drawOverview(); return; }
      flat = T.entries(model, { ...range, query: search.value, includeUnknown: includeUnknown.checked, collapsed });
      rows.style.height = flat.totalHeight + 'px';
      if (resetScroll) viewport.scrollTop = 0;
      viewport.scrollTop = Math.min(viewport.scrollTop || 0, Math.max(0, flat.totalHeight - (viewport.clientHeight || 480)));
      status.textContent = `${model.observed} observed transitions; ${model.missingUnits} units without comparable timing; ${model.unknown} unknown/incomparable timestamp records. ${flat.matchingUnits} units match ${range.start.toFixed(3)}–${range.end.toFixed(3)} s. ${model.observed ? '' : 'No comparable timing observations available. '}${flat.matchingUnits ? '' : 'No units match the current range/search. ' }Latest retained transitions only; not a complete boot trace or measured startup durations.`;
      axis.append(el('span', 'Unit / current snapshot state'));
      const ticks = el('div', undefined, undefined, 'timeline-ticks');
      const tickCount = (element.clientWidth || 900) < 600 ? 1 : (element.clientWidth || 900) < 900 ? 2 : 4;
      for (let i = 0; i <= tickCount; i++) ticks.append(el('span', (range.start + (range.end - range.start) * i / tickCount).toFixed(3) + ' s'));
      axis.style.marginRight = Math.max(0, (viewport.offsetWidth || viewport.clientWidth) - viewport.clientWidth) + 'px';
      axis.append(ticks); renderVisible(); drawOverview();
    }
    search.addEventListener('input', () => rebuild()); includeUnknown.addEventListener('change', () => rebuild());
    viewport.addEventListener('scroll', () => {
      if (pending) return; pending = true;
      (root.requestAnimationFrame || (fn => fn()))(() => { pending = false; renderVisible(); });
    });
    const timeAt = e => Math.max(0, Math.min(1, (e.clientX - overview.getBoundingClientRect().left) / (overview.clientWidth || 600))) * model.domainEnd;
    overview.addEventListener('pointerdown', e => { if (!model || model.crossBoot) return; brush = timeAt(e); overview.setPointerCapture(e.pointerId); });
    overview.addEventListener('pointermove', e => { if (brush === null) return; const time = timeAt(e); drawOverview({ start: Math.min(brush, time), end: Math.max(brush, time) }); });
    overview.addEventListener('pointerup', e => {
      if (brush === null) return;
      const time = timeAt(e), start = Math.min(brush, time), end = Math.max(brush, time); brush = null;
      if (end > start) changeRange({ start, end }); else drawOverview();
    });
    overview.addEventListener('pointercancel', () => { brush = null; drawOverview(); });
    root.window.addEventListener('resize', () => rebuild(false));
    rebuild();
    return {
      setSnapshot(snapshot, units) {
        model = snapshot ? T.build(snapshot, units) : null;
        range = { start: 0, end: model?.domainEnd || 1 }; collapsed.clear(); selected = null; brush = null; search.value = ''; error.textContent = ''; updateRangeInputs();
        for (const input of [search, includeUnknown, startInput, endInput, ...filters.querySelectorAll('button'), ...controls.querySelectorAll('button')]) input.disabled = !model || model.crossBoot;
        rebuild();
      },
      select(name) { selected = name; renderVisible(); },
      refresh() { rebuild(false); },
    };
  }
  root.ExplorerTimeline = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
