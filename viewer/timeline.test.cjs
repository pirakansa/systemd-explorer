const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('./timeline-core.js');
const C = require('./core.js');
const base = { schema_version: 1, metadata: {}, units: [], relations: [], timings: [], devices: [], warnings: [] };
const point = (unit, time, extra = {}) => ({ unit, event: 'ActiveEnterTimestampMonotonic', value: time === null ? null : time * 1000000, clock: 'boot_monotonic', unit_of_time: 'microseconds', certainty: time === null ? 'unknown' : 'observed', ...extra });
test('timeline normalizes observations and counts missing data without inventing intervals', () => {
  const data = { ...base, units: [{ name: 'a.service', unit_type: 'service', active_state: 'inactive' }, { name: 'missing.service', unit_type: 'service' }], timings: [
    point('a.service', 2), point('a.service', 1, { event: 'InactiveExitTimestampMonotonic' }),
    point('a.service', 6, { event: 'ActiveExitTimestampMonotonic' }), point('a.service', 7, { event: 'InactiveEnterTimestampMonotonic' }),
    point('a.service', null), point('a.service', 0), point('a.service', 3, { certainty: 'estimated' }),
    point('a.service', 4, { clock: 'wall' }), point('unknown.mount', 5),
  ] };
  const idx = C.index(data), model = T.build(data, idx.units);
  assert(idx.units.get('unknown.mount').unresolved);
  assert.equal(model.observed, 5); assert.equal(model.unknown, 4); assert.equal(model.missingUnits, 1);
  assert.equal(model.totalUnits, 3); assert.equal(model.bins.reduce((a, b) => a + b, 0), 5);
  const row = model.groups.find(g => g.type === 'service').records.find(r => r.unit.name === 'a.service');
  assert.deepEqual(row.events.map(e => e.time), [1, 2, 6, 7]);
  assert(!Object.hasOwn(row, 'duration'));
  assert.equal(row.unit.active_state, 'inactive');
});
test('time ranges, unknown inclusion, type folding and full-name search compose', () => {
  const data = { ...base, units: [{ name: 'early.service', unit_type: 'service', description: 'Fictitious daemon' }, { name: 'late.service', unit_type: 'service' }, { name: 'missing.device', unit_type: 'device' }], timings: [point('early.service', 1), point('late.service', 90)] };
  const model = T.build(data);
  let result = T.entries(model, { start: 0, end: 2, includeUnknown: false });
  assert.equal(result.matchingUnits, 1); assert.equal(result.rows[1].record.unit.name, 'early.service');
  assert.equal(T.entries(model, { start: 0, end: 2 }).matchingUnits, 2);
  assert.equal(T.entries(model, { query: 'DAEMON', includeUnknown: false }).matchingUnits, 1);
  result = T.entries(model, { collapsed: new Set(['service']) });
  assert.equal(result.matchingUnits, 3); assert(!result.rows.some(r => r.kind === 'unit' && r.record.unit.unit_type === 'service'));
  assert.equal(T.entries(model, { start: 90, end: 90, includeUnknown: false }).matchingUnits, 1); // Inclusive point boundary.
});
test('virtual viewport remains bounded across thousands of units', () => {
  const units = Array.from({ length: 10000 }, (_, i) => ({ name: `worker-${i}.service`, unit_type: 'service' }));
  const model = T.build({ ...base, units, timings: units.map((u, i) => point(u.name, i + 1)) });
  const flat = T.entries(model);
  assert.equal(flat.matchingUnits, 10000);
  const visible = T.visible(flat.rows, 36 + 64 * 5000, 480);
  assert(visible.length < 16); assert(visible.some(r => r.record?.unit.name === 'worker-5000.service'));
  assert(T.visible(flat.rows, flat.totalHeight - 480, 480).some(r => r.record?.unit.name === 'worker-9999.service'));
  assert.deepEqual(T.visible([], 0, 480), []);
});
test('range validation and zoom/pan boundaries reject invalid comparisons', () => {
  for (const [a, b] of [[-1, 5], [5, 5], [6, 5], [0, 11], [NaN, 5], [0, Infinity]]) assert.equal(T.windowRange(a, b, 10), null);
  assert.deepEqual(T.windowRange(0, 10, 10), { start: 0, end: 10 });
  assert.deepEqual(T.zoomRange({ start: 0, end: 10 }, .5, 10), { start: 2.5, end: 7.5 });
  assert.deepEqual(T.zoomRange({ start: 2, end: 8 }, 2, 10), { start: 0, end: 10 });
  assert(T.build({ ...base, metadata: { boot_id: 'a', boot_id_at_end: 'b' } }).crossBoot);
  const empty = T.build(base); assert.equal(empty.observed, 0); assert.equal(empty.domainEnd, 1);
});
