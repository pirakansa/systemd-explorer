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
  const graph = C.neighborhood(C.index(medium), 'demo.target', 4, () => true, 30, 40);
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
