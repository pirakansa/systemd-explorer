/* Pure normalization and viewport selection for observed transition timestamps. */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' ? require('./core.js') : root.ExplorerCore;
  const GROUP_HEIGHT = 36, UNIT_HEIGHT = 64, BIN_COUNT = 100;
  function build(snapshot, indexedUnits) {
    const units = new Map(indexedUnits || snapshot.units.map(u => [u.name, u]));
    const records = new Map(Array.from(units, ([name, unit]) => [name, { unit, events: [] }]));
    let observed = 0, unknown = 0, maxTime = 0;
    for (const t of snapshot.timings) {
      if (!records.has(t.unit)) records.set(t.unit, { unit: { name: t.unit, unit_type: t.unit.split('.').pop(), unresolved: true }, events: [] });
      const time = C.seconds(t);
      if (time === null) { unknown++; continue; }
      records.get(t.unit).events.push({ time, event: t.event, source: t.source || 'unknown' });
      observed++; maxTime = Math.max(maxTime, time);
    }
    const domainEnd = Math.max(1, maxTime * 1.02), bins = Array(BIN_COUNT).fill(0), groups = new Map();
    let missingUnits = 0;
    for (const record of records.values()) {
      record.events.sort((a, b) => a.time - b.time || a.event.localeCompare(b.event));
      if (!record.events.length) missingUnits++;
      for (const event of record.events) bins[Math.min(BIN_COUNT - 1, Math.floor(event.time / domainEnd * BIN_COUNT))]++;
      const type = typeof record.unit.unit_type === 'string' && record.unit.unit_type ? record.unit.unit_type : record.unit.name.split('.').pop() || 'unknown';
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(record);
    }
    for (const records of groups.values()) records.sort((a, b) => (a.events[0]?.time ?? Infinity) - (b.events[0]?.time ?? Infinity) || a.unit.name.localeCompare(b.unit.name));
    return {
      groups: Array.from(groups, ([type, records]) => ({ type, records })).sort((a, b) => a.type.localeCompare(b.type)),
      domainEnd, bins, observed, unknown, missingUnits, totalUnits: records.size,
      crossBoot: Boolean(snapshot.metadata.boot_id && snapshot.metadata.boot_id_at_end && snapshot.metadata.boot_id !== snapshot.metadata.boot_id_at_end),
    };
  }
  function entries(model, { start = 0, end = model.domainEnd, query = '', includeUnknown = true, collapsed = new Set() } = {}) {
    const needle = query.trim().toLowerCase(), rows = [];
    let top = 0, matchingUnits = 0;
    for (const group of model.groups) {
      const records = group.records.filter(r => {
        if (needle && !r.unit.name.toLowerCase().includes(needle) && !String(r.unit.description || '').toLowerCase().includes(needle)) return false;
        return r.events.length ? r.events.some(e => e.time >= start && e.time <= end) : includeUnknown;
      });
      if (!records.length) continue;
      rows.push({ kind: 'group', type: group.type, count: records.length, top, height: GROUP_HEIGHT });
      top += GROUP_HEIGHT; matchingUnits += records.length;
      if (collapsed.has(group.type)) continue;
      for (const record of records) {
        rows.push({ kind: 'unit', record, top, height: UNIT_HEIGHT }); top += UNIT_HEIGHT;
      }
    }
    return { rows, totalHeight: top, matchingUnits };
  }
  function visible(rows, scrollTop, height, overscan = UNIT_HEIGHT * 2) {
    const start = Math.max(0, scrollTop - overscan), end = scrollTop + height + overscan;
    let low = 0, high = rows.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (rows[mid].top + rows[mid].height <= start) low = mid + 1; else high = mid;
    }
    const from = low;
    while (low < rows.length && rows[low].top < end) low++;
    return rows.slice(from, low);
  }
  function windowRange(start, end, domainEnd) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end || end > domainEnd) return null;
    return { start, end };
  }
  function zoomRange(range, factor, domainEnd) {
    const span = Math.min(domainEnd, Math.max(Math.min(0.000001, domainEnd), (range.end - range.start) * factor));
    const start = Math.max(0, Math.min(domainEnd - span, (range.start + range.end - span) / 2));
    return { start, end: Math.min(domainEnd, start + span) };
  }
  root.ExplorerTimelineData = { build, entries, visible, windowRange, zoomRange };
  if (typeof module !== 'undefined') module.exports = root.ExplorerTimelineData;
})(typeof globalThis !== 'undefined' ? globalThis : this);
