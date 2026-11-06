/* Pure snapshot validation and bounded graph traversal; also exercised by Rust via fixtures. */
(function (root) {
  'use strict';
  const requests = new Set(['Requires', 'Wants', 'BindsTo', 'Upholds']);
  const ordering = new Set(['After', 'Before']);
  const category = kind => ordering.has(kind) ? 'ordering' : requests.has(kind) ? 'request' : 'other';
  function validate(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Snapshot must be a JSON object.');
    if (data.schema_version !== 1) throw Error('Unsupported schema version: ' + String(data.schema_version) + '. This viewer supports version 1.');
    for (const key of ['units', 'relations', 'timings', 'devices', 'warnings']) {
      if (!Array.isArray(data[key])) throw Error('Missing or invalid array: ' + key);
      if (data[key].length > 1000000) throw Error('Too many records in ' + key + '.');
    }
    if (!data.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) throw Error('Missing metadata.');
    const string = (v, field) => { if (typeof v !== 'string' || !v) throw Error('Invalid ' + field + '.'); };
    const names = new Set();
    for (const u of data.units) {
      if (!u || typeof u !== 'object') throw Error('Invalid unit.');
      string(u.name, 'unit name');
      if (names.has(u.name)) throw Error('Duplicate unit name: ' + u.name);
      names.add(u.name);
      for (const key of ['drop_in_paths', 'install_wanted_by', 'config_notes']) {
        if (u[key] !== undefined && (!Array.isArray(u[key]) || u[key].some(v => typeof v !== 'string'))) throw Error('Invalid unit ' + key);
      }
    }
    for (const e of data.relations) {
      if (!e || typeof e !== 'object') throw Error('Invalid relation.');
      for (const key of ['from', 'to', 'kind', 'evidence']) string(e[key], 'relation ' + key);
    }
    for (const t of data.timings) {
      if (!t || typeof t !== 'object') throw Error('Invalid timing.');
      string(t.unit, 'timing unit'); string(t.event, 'timing event');
      if (t.value !== null && t.value !== undefined && (!Number.isSafeInteger(t.value) || t.value < 0)) throw Error('Invalid timing value.');
    }
    for (const d of data.devices) {
      if (!d || typeof d !== 'object') throw Error('Invalid device.');
      string(d.unit, 'device unit');
      if (d.properties !== undefined && (!d.properties || typeof d.properties !== 'object' || Array.isArray(d.properties))) throw Error('Invalid device properties.');
    }
    return data;
  }
  function index(data) {
    const units = new Map(data.units.map(u => [u.name, u]));
    const adjacency = new Map();
    data.relations.forEach((e, i) => {
      for (const name of new Set([e.from, e.to])) {
        if (!units.has(name)) units.set(name, { name, unit_type: name.split('.').pop(), unresolved: true });
        if (!adjacency.has(name)) adjacency.set(name, []);
        adjacency.get(name).push(i);
      }
    });
    return { units, adjacency, relations: data.relations };
  }
  function neighborhood(idx, name, hops, allowed, { maxNodes = 180, maxEdges = 800, activeOnly = false } = {}) {
    if (!idx.units.has(name)) return { nodes: [], edges: [], truncated: false, hiddenByState: 0 };
    const distance = new Map([[name, 0]]), selected = [], edgeIds = new Set(), hidden = new Set();
    const queue = [name]; let truncated = false;
    const depth = Math.max(0, Math.min(4, Number(hops) || 0));
    for (let q = 0; q < queue.length; q++) {
      const current = queue[q];
      if (distance.get(current) >= depth) continue;
      for (const id of idx.adjacency.get(current) || []) {
        const e = idx.relations[id];
        if (!allowed(e)) continue;
        const other = e.from === current ? e.to : e.from;
        if (!distance.has(other)) {
          if (activeOnly && idx.units.get(other).active_state !== 'active') { hidden.add(other); continue; }
          if (distance.size >= maxNodes) { truncated = true; continue; }
          distance.set(other, distance.get(current) + 1); queue.push(other);
        }
      }
    }
    for (const node of queue) {
      for (const id of idx.adjacency.get(node) || []) {
        if (edgeIds.has(id)) continue;
        const e = idx.relations[id];
        if (!distance.has(e.from) || !distance.has(e.to) || !allowed(e)) continue;
        edgeIds.add(id);
        if (selected.length < maxEdges) selected.push(e); else truncated = true;
      }
    }
    return { nodes: queue.map(name => ({ unit: idx.units.get(name), depth: distance.get(name) })), edges: selected, truncated, hiddenByState: hidden.size };
  }
  function seconds(t) {
    return t.clock === 'boot_monotonic' && t.unit_of_time === 'microseconds' && t.certainty === 'observed' && Number.isSafeInteger(t.value) && t.value > 0 ? t.value / 1000000 : null;
  }
  // Lists cover all direct observations; graph size caps never remove rows here.
  function relationGroups(idx, name, allowed, { activeOnly = false, query = '' } = {}) {
    const sides = { incoming: new Map(), outgoing: new Map() }, hidden = new Set();
    const ids = idx.adjacency.get(name) || [], needle = query.trim().toLowerCase();
    let matchingRelations = 0;
    for (const id of ids) {
      const edge = idx.relations[id];
      if (!allowed(edge)) continue;
      const other = edge.from === name ? edge.to : edge.from, unit = idx.units.get(other);
      if (activeOnly && other !== name && unit.active_state !== 'active') { hidden.add(other); continue; }
      if (needle && !other.toLowerCase().includes(needle) && !String(unit.description || '').toLowerCase().includes(needle)) continue;
      matchingRelations++;
      for (const side of ['incoming', 'outgoing']) {
        if (side === 'incoming' ? edge.to !== name : edge.from !== name) continue;
        const key = JSON.stringify([edge.kind, edge.evidence]);
        if (!sides[side].has(key)) sides[side].set(key, { kind: edge.kind, evidence: edge.evidence, rows: new Map(), relationCount: 0 });
        const group = sides[side].get(key);
        if (!group.rows.has(other)) group.rows.set(other, { unit, relations: [] });
        group.rows.get(other).relations.push(edge); group.relationCount++;
      }
    }
    const rank = { request: 0, ordering: 1, other: 2 };
    const groups = side => Array.from(sides[side].values())
      .sort((a, b) => rank[category(a.kind)] - rank[category(b.kind)] || a.kind.localeCompare(b.kind) || a.evidence.localeCompare(b.evidence))
      .map(g => ({ ...g, rows: Array.from(g.rows.values()).sort((a, b) => a.unit.name.localeCompare(b.unit.name)) }));
    return { incoming: groups('incoming'), outgoing: groups('outgoing'), totalRelations: ids.length, matchingRelations, hiddenByState: hidden.size };
  }
  function filteredUnits(idx, query, type, state) {
    const needle = query.toLowerCase();
    return Array.from(idx.units.values()).filter(u => (u.name.toLowerCase().includes(needle) || String(u.description || '').toLowerCase().includes(needle)) && (!type || u.unit_type === type) && (!state || (u.active_state || 'unknown') === state));
  }
  root.ExplorerCore = { validate, index, neighborhood, relationGroups, category, seconds, filteredUnits };
  if (typeof module !== 'undefined') module.exports = root.ExplorerCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
