const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('./core.js');
const small = JSON.parse(fs.readFileSync(__dirname + '/samples/small.json', 'utf8'));
const medium = JSON.parse(fs.readFileSync(__dirname + '/samples/medium.json', 'utf8'));
const effective = e => e.evidence === 'effective';
test('samples validate; unknown optional extensions are accepted', () => {
  C.validate(small); C.validate(medium);
  C.validate({ ...small, future: { arbitrary: true } });
  assert.throws(() => C.validate({ ...small, schema_version: 2 }), /Unsupported schema/);
  assert.throws(() => C.validate({ ...small, units: null }), /units/);
  assert.throws(() => C.validate({ ...small, units: [{ name: 'a.service', drop_in_paths: {} }] }), /drop_in_paths/);
  assert.throws(() => C.validate({ ...small, units: [small.units[0], small.units[0]] }), /Duplicate/);
  assert.throws(() => C.validate({ ...small, relations: [{ from: 'a' }] }), /relation/);
  assert.throws(() => C.validate({ ...small, timings: [{ unit: 'a', event: 'x', value: -1 }] }), /timing/);
  assert.throws(() => JSON.parse('{'), SyntaxError);
});
test('empty snapshots are valid; missing references become unresolved nodes', () => {
  const empty = { ...small, units: [], relations: [], timings: [], devices: [], warnings: [] };
  C.validate(empty); assert.equal(C.index(empty).units.size, 0);
  const idx = C.index(small);
  assert.equal(idx.units.get('unknown-helper.service').unresolved, true);
  assert.deepEqual(C.neighborhood(idx, 'absent', 1, effective).nodes, []);
});
test('incoming and outgoing traversal obeys hops and evidence layers', () => {
  const idx = C.index(small);
  assert.equal(C.neighborhood(idx, 'demo.service', 0, effective).nodes.length, 1);
  const one = C.neighborhood(idx, 'demo.service', 1, effective).nodes.map(n => n.unit.name);
  assert(one.includes('demo.target')); assert(one.includes('data.mount'));
  assert(!one.includes('sys-devices-demo.device'));
  assert(C.neighborhood(idx, 'demo.service', 2, effective).nodes.some(n => n.unit.name === 'sys-devices-demo.device'));
  assert(!C.neighborhood(idx, 'demo.target', 1, effective).nodes.some(n => n.unit.name === 'not-loaded.service'));
  assert(C.neighborhood(idx, 'demo.target', 1, () => true).nodes.some(n => n.unit.name === 'not-loaded.service'));
});
test('large neighborhoods remain bounded and announce truncation', () => {
  const graph = C.neighborhood(C.index(medium), 'demo.target', 4, () => true, { maxNodes: 30, maxEdges: 40 });
  assert(graph.nodes.length <= 30); assert(graph.edges.length <= 40); assert(graph.truncated);
  const names = new Set(graph.nodes.map(n => n.unit.name));
  assert(graph.edges.every(e => names.has(e.from) && names.has(e.to)));
});
test('cycles and self edges terminate without duplicating nodes', () => {
  const data = { ...small, units: [{ name: 'a.service' }, { name: 'b.service' }], relations: [{ from: 'a.service', to: 'b.service', kind: 'Wants', evidence: 'effective' }, { from: 'b.service', to: 'a.service', kind: 'After', evidence: 'effective' }, { from: 'a.service', to: 'a.service', kind: 'Wants', evidence: 'effective' }] };
  const g = C.neighborhood(C.index(data), 'a.service', 4, effective);
  assert.equal(g.nodes.length, 2); assert.equal(g.edges.length, 3);
});
test('ordering never becomes an activation request; timings require observed monotonic units', () => {
  assert.equal(C.category('After'), 'ordering'); assert.equal(C.category('Before'), 'ordering');
  assert.equal(C.category('Wants'), 'request'); assert.equal(C.category('Requires'), 'request');
  assert.equal(C.category('Requisite'), 'other'); assert.equal(C.category('PartOf'), 'other');
  const t = small.timings[0]; assert.equal(C.seconds(t), .43);
  assert.equal(C.seconds({ ...t, value: null }), null);
  assert.equal(C.seconds({ ...t, certainty: 'estimated' }), null);
  assert.equal(C.seconds({ ...t, clock: 'wall' }), null);
});
test('inventory filters unit names, descriptions, types and unknown states', () => {
  const idx = C.index(small);
  assert.equal(C.filteredUnits(idx, 'DEMO.SERVICE', 'service', 'active').length, 1);
  assert.equal(C.filteredUnits(idx, '', 'device', '').length, 1);
  assert(C.filteredUnits(idx, 'not-loaded', '', 'unknown').length === 1);
});
test('activation-request traversal excludes ordering, checks and propagation', () => {
  const kinds = ['Wants', 'Requires', 'BindsTo', 'Upholds', 'After', 'Before', 'Requisite', 'PartOf', 'Conflicts', 'Triggers'];
  const data = { ...small, units: [{ name: 'root.target' }, ...kinds.map(kind => ({ name: kind + '.service' }))], relations: kinds.map(kind => ({ from: 'root.target', to: kind + '.service', kind, evidence: 'effective' })) };
  const graph = C.neighborhood(C.index(data), 'root.target', 1, e => effective(e) && C.category(e.kind) === 'request');
  assert.deepEqual(graph.edges.map(e => e.kind), ['Wants', 'Requires', 'BindsTo', 'Upholds']);
  assert.equal(graph.nodes.length, 5);
});
test('active filter keeps the focus, excludes unknown states and never bridges hidden units', () => {
  const units = [
    { name: 'root.target', active_state: 'inactive' },
    { name: 'active.service', active_state: 'active' },
    { name: 'inactive.service', active_state: 'inactive' },
    { name: 'beyond.service', active_state: 'active' },
    { name: 'failed.service', active_state: 'failed' },
    { name: 'transition.service', active_state: 'activating' },
    { name: 'unknown.service' },
    { name: 'incoming.service', active_state: 'active' },
  ];
  const edge = (from, to, kind = 'Wants') => ({ from, to, kind, evidence: 'effective' });
  const relations = [
    ...['active.service', 'inactive.service', 'failed.service', 'transition.service', 'unknown.service', 'unresolved.service'].map(to => edge('root.target', to)),
    edge('inactive.service', 'beyond.service'), edge('incoming.service', 'root.target'),
    edge('active.service', 'root.target'), edge('root.target', 'inactive.service', 'Requires'),
  ];
  const idx = C.index({ ...small, units, relations });
  const graph = C.neighborhood(idx, 'root.target', 4, effective, { activeOnly: true });
  assert.deepEqual(graph.nodes.map(n => n.unit.name), ['root.target', 'active.service', 'incoming.service']);
  assert.equal(graph.hiddenByState, 5); // Unique names, not duplicated relationships.
  assert.equal(graph.edges.length, 3);
  assert(!graph.truncated);
  const restored = C.neighborhood(idx, 'root.target', 4, effective);
  assert.equal(restored.nodes.length, 9);
  assert.equal(restored.hiddenByState, 0);
});
test('state filtering happens before graph caps and respects evidence and zero hops', () => {
  const units = [{ name: 'root.target' }, ...Array.from({ length: 200 }, (_, i) => ({ name: `inactive-${i}.service`, active_state: 'inactive' })), { name: 'active.service', active_state: 'active' }];
  const relations = units.slice(1).map(u => ({ from: 'root.target', to: u.name, kind: 'Wants', evidence: 'effective' }));
  const idx = C.index({ ...small, units, relations });
  const options = { activeOnly: true, maxNodes: 2, maxEdges: 1 };
  const graph = C.neighborhood(idx, 'root.target', 1, effective, options);
  assert.equal(graph.nodes.length, 2); assert.equal(graph.edges.length, 1);
  assert.equal(graph.hiddenByState, 200); assert(!graph.truncated);
  assert.equal(C.neighborhood(idx, 'root.target', 0, effective, options).nodes.length, 1);
  assert.equal(C.neighborhood(idx, 'root.target', 1, () => false, options).hiddenByState, 0);
});
test('direct relation groups preserve property direction and separate evidence and sources', () => {
  const edge = (from, to, kind, evidence = 'effective', source = 'fixture') => ({ from, to, kind, evidence, source });
  const idx = C.index({ ...small, units: [
    { name: 'root.target', active_state: 'inactive' },
    { name: 'worker.service', active_state: 'active', description: 'Fictitious report worker' },
    { name: 'other.service', active_state: 'inactive' },
  ], relations: [
    edge('root.target', 'worker.service', 'Wants'),
    edge('root.target', 'worker.service', 'Wants', 'effective', 'another source'),
    edge('root.target', 'worker.service', 'Wants', 'disk_symlink'),
    edge('worker.service', 'root.target', 'After'),
    edge('root.target', 'unknown.service', 'Requires'),
    edge('other.service', 'root.target', 'Wants'),
    edge('root.target', 'root.target', 'PartOf'),
  ] });
  const all = C.relationGroups(idx, 'root.target', () => true);
  const effectiveWants = all.outgoing.find(g => g.kind === 'Wants' && g.evidence === 'effective');
  assert.equal(effectiveWants.rows.length, 1);
  assert.equal(effectiveWants.relationCount, 2);
  assert.equal(effectiveWants.rows[0].relations[1].source, 'another source');
  assert(all.outgoing.some(g => g.evidence === 'disk_symlink'));
  assert(all.incoming.some(g => g.kind === 'After' && g.rows[0].unit.name === 'worker.service'));
  assert(!all.outgoing.some(g => g.kind === 'After'));
  assert(all.outgoing.some(g => g.rows.some(r => r.unit.unresolved)));
  assert.equal(all.matchingRelations, 7); // Self-reference counts once despite appearing on both sides.
  assert(all.incoming.some(g => g.kind === 'PartOf'));
  assert(all.outgoing.some(g => g.kind === 'PartOf'));
  const filtered = C.relationGroups(idx, 'root.target', effective, { activeOnly: true, query: 'REPORT' });
  assert.equal(filtered.matchingRelations, 3);
  assert.equal(filtered.hiddenByState, 2);
  assert.equal(filtered.outgoing.length, 1);
  assert.equal(filtered.incoming[0].kind, 'After');
});
test('direct lists retain high-fanout relationships beyond graph caps and search all rows', () => {
  const idx = C.index(medium);
  const list = C.relationGroups(idx, 'demo.target', effective);
  const wants = list.outgoing.find(g => g.kind === 'Wants');
  assert.equal(wants.rows.filter(r => r.unit.name.startsWith('worker-')).length, 280);
  assert(C.neighborhood(idx, 'demo.target', 1, effective).truncated);
  const found = C.relationGroups(idx, 'demo.target', effective, { query: 'WORKER-279' });
  assert.equal(found.matchingRelations, 1);
  assert.equal(found.outgoing[0].rows[0].unit.name, 'worker-279.service');
  assert.equal(C.relationGroups(idx, 'demo.target', () => false).matchingRelations, 0);
  assert.equal(C.relationGroups(idx, 'absent.service', effective).totalRelations, 0);
});
