// DOM smoke harness, not a replacement for the documented real-browser checks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.style = {}; this.value = ''; this.checked = false; this.hidden = false; this._text = ''; this.clientWidth = 600; this.clientHeight = 480; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
  insertBefore(node, sibling) { const i = this.children.indexOf(sibling); if (i < 0) throw Error('Missing sibling'); this.children.splice(i, 0, node); }
  get firstChild() { return this.children[0]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  fire(type, event = {}) { for (const fn of this.listeners[type] || []) fn({ target: this, ...event }); }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (child.tagName === selector || (child.tagName === 'input' && child.checked && selector === 'input:checked')) result.push(child);
      if (child.querySelectorAll) result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0 }; }
  getContext() { this.drawCalls = []; return new Proxy({}, { get: (_, name) => (...args) => this.drawCalls.push({ name, args }), set: () => true }); }
}
function setup() {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const document = new Element('document');
  document.getElementById = get;
  document.createElement = tag => new Element(tag);
  document.createTextNode = text => { const e = new Element('text'); e.textContent = text; return e; };
  const window = new Element('window'); window.devicePixelRatio = 1;
  get('hops').value = '1';
  for (const value of ['effective', 'disk_symlink', 'install_hint']) {
    const input = new Element('input'); input.value = value; input.checked = value === 'effective'; get('evidence').append(input);
  }
  const context = vm.createContext({ document, window, console });
  for (const script of ['core.js', 'app.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + script, 'utf8'), context, { filename: script });
  async function load(text, name = 'test.json') {
    get('file').fire('change', { target: { files: [{ name, size: text.length, text: async () => text }] } });
    await new Promise(resolve => setImmediate(resolve));
  }
  return { get, load, document };
}
const small = fs.readFileSync(__dirname + '/samples/small.json', 'utf8');
test('UI imports local data, navigates relationships, searches and switches evidence', async () => {
  const { get, load } = setup();
  assert.equal(get('units').children.length, 0);
  await load(small);
  assert.match(get('message').textContent, /Loaded test.json/);
  assert.match(get('overview').textContent, /type device: 1/);
  const service = get('units').children.find(b => b.textContent.startsWith('demo.service'));
  service.fire('click');
  assert.match(get('detail').textContent, /demo.service/);
  assert.match(get('detail').textContent, /After/);
  assert.match(get('graph-status').textContent, /demo.service/);
  get('hops').value = '2'; get('hops').fire('change');
  get('evidence').children[1].checked = true; get('evidence').fire('change');
  get('search').value = 'not-loaded'; get('search').fire('input');
  assert.equal(get('units').children.length, 1);
  get('units').children[0].fire('click');
  assert.match(get('detail').textContent, /Unknown \/ not collected/);
  assert.match(get('detail').textContent, /not establish a manager dependency/);
  for (const id of ['zoom-in', 'zoom-out', 'fit']) get(id).fire('click');
});
test('UI clears stale data for invalid JSON and unsupported versions, and handles empty data', async () => {
  const { get, load } = setup();
  await load(small); await load('{broken');
  assert.match(get('message').textContent, /Could not load/); assert.equal(get('units').children.length, 0);
  await load(JSON.stringify({ schema_version: 99 })); assert.match(get('message').textContent, /Unsupported schema/);
  const empty = JSON.parse(small);
  for (const key of ['units', 'relations', 'timings', 'devices', 'warnings']) empty[key] = [];
  await load(JSON.stringify(empty));
  assert.match(get('message').textContent, /no units/); assert.match(get('timeline').textContent, /No comparable/);
});
test('UI announces graph caps for medium sample and rejects a cross-boot timeline', async () => {
  const { get, load } = setup();
  await load(fs.readFileSync(__dirname + '/samples/medium.json', 'utf8'));
  get('units').children.find(b => b.textContent.startsWith('demo.target')).fire('click');
  assert.match(get('graph-status').textContent, /TRUNCATED/);
  const changed = JSON.parse(small); changed.metadata.boot_id_at_end = 'different-boot';
  await load(JSON.stringify(changed));
  assert.match(get('timeline').textContent, /Boot ID changed/);
});
test('graph request and active toggles combine and restore without changing inventory or details', async () => {
  const { get, load } = setup();
  const data = JSON.parse(small);
  data.units.find(u => u.name === 'demo.target').active_state = 'inactive';
  data.units.push({ name: 'ordering-only.service', unit_type: 'service', active_state: 'active' });
  data.relations.push(
    { from: 'demo.target', to: 'ordering-only.service', kind: 'After', evidence: 'effective' },
    { from: 'demo.target', to: 'shutdown.target', kind: 'Wants', evidence: 'effective' });
  await load(JSON.stringify(data));
  get('units').children.find(b => b.textContent.startsWith('demo.target')).fire('click');
  const initial = get('graph-status').textContent;
  assert.match(initial, /4 nodes \/ 5 edges/);
  const inventoryCount = get('units').children.length;
  const after = get('kinds').querySelectorAll('input').find(i => i.value === 'After');
  const wants = get('kinds').querySelectorAll('input').find(i => i.value === 'Wants');
  get('requests-only').checked = true; get('requests-only').fire('change');
  assert.match(get('graph-status').textContent, /3 nodes \/ 2 edges/);
  assert.match(get('graph-status').textContent, /Activation requests only/);
  assert.equal(after.disabled, true); assert.equal(wants.disabled, false);
  get('active-only').checked = true; get('active-only').fire('change');
  assert.match(get('graph-status').textContent, /2 nodes \/ 1 edges/);
  assert.match(get('graph-status').textContent, /1 neighboring units hidden; selected unit kept/);
  assert.equal(get('units').children.length, inventoryCount);
  assert.match(get('detail').textContent, /ordering-only.service/);
  assert.match(get('detail').textContent, /shutdown.target/);
  get('requests-only').checked = false; get('requests-only').fire('change');
  assert.equal(after.disabled, false);
  assert.match(get('graph-status').textContent, /3 nodes \/ 3 edges/);
  get('active-only').checked = false; get('active-only').fire('change');
  assert.equal(get('graph-status').textContent, initial);
  // An individual kind selection is preserved across preset toggles.
  after.checked = false; after.fire('change');
  get('requests-only').checked = true; get('requests-only').fire('change');
  get('requests-only').checked = false; get('requests-only').fire('change');
  assert.equal(after.checked, false);
  assert.match(get('graph-status').textContent, /3 nodes \/ 4 edges/);
});
test('list is the default, paginates every direct target beyond graph caps and navigates search results', async () => {
  const { get, load } = setup();
  assert.equal(get('graph-panel').hidden, true);
  assert.equal(get('relations-panel').hidden, false);
  assert.equal(get('view-list').getAttribute('aria-pressed'), 'true');
  await load(fs.readFileSync(__dirname + '/samples/medium.json', 'utf8'));
  get('units').children.find(b => b.textContent.startsWith('demo.target')).fire('click');
  assert.match(get('relations-focus').textContent, /demo.target/);
  assert.match(get('relations-incoming').textContent, /PartOf/);
  const wants = get('relations-outgoing').children.find(g => g.firstChild?.textContent.startsWith('Wants'));
  assert.match(wants.firstChild.textContent, /281 units \/ 281 records/);
  const unitButtons = group => group.querySelectorAll('button').filter(b => b.className === 'related-unit');
  assert.equal(unitButtons(wants).length, 40);
  wants.children.find(c => c.tagName === 'button').fire('click');
  assert.equal(unitButtons(wants).length, 80);
  assert.match(get('graph-status').textContent, /TRUNCATED/);
  get('graph').drawCalls = []; get('view-graph').fire('click');
  const boxes = get('graph').drawCalls.filter(c => c.name === 'fillRect').map(c => c.args);
  assert.equal(boxes.length, 25);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [x, y, w, h] = boxes[i], [a, b, c, d] = boxes[j];
    assert(!(x < a + c && x + w > a && y < b + d && y + h > b), 'Node label rectangles must not overlap.');
  }
  assert(get('graph').drawCalls.some(c => c.name === 'scale' && c.args[0] === 1 && c.args[1] === 1));
  let prevented = false;
  const wheel = { deltaY: 100, clientX: 100, clientY: 100, preventDefault() { prevented = true; } };
  get('graph').fire('wheel', wheel); assert.equal(prevented, false);
  get('graph').fire('wheel', { ...wheel, ctrlKey: true }); assert.equal(prevented, true);
  get('view-list').fire('click');
  get('relations-search').value = 'WORKER-279'; get('relations-search').fire('input');
  assert.match(get('relations-status').textContent, /1 of 284 direct relation records/);
  const result = get('relations-outgoing').querySelectorAll('button').find(b => b.className === 'related-unit');
  assert.equal(result.textContent, 'worker-279.service');
  result.fire('click');
  assert.equal(get('relations-search').value, '');
  assert.match(get('relations-focus').textContent, /worker-279.service/);
  assert.match(get('relations-incoming').textContent, /demo.target/);
  assert.match(get('relations-outgoing').textContent, /data.mount/);
  get('view-graph').fire('click');
  assert.equal(get('graph-panel').hidden, false);
  assert.equal(get('relations-panel').hidden, true);
  assert.equal(get('view-graph').getAttribute('aria-pressed'), 'true');
  assert(parseFloat(get('graph').style.height) >= 480);
  get('view-list').fire('click');
  assert.equal(get('graph-panel').hidden, true);
  assert.match(get('relations-focus').textContent, /worker-279.service/);
});
test('list keeps evidence layers separate, applies active/request filters and explains no matches', async () => {
  const { get, load } = setup();
  const data = JSON.parse(small), longName = 'worker@' + 'long-instance-'.repeat(6) + '.service';
  data.units.push({ name: longName, unit_type: 'service', active_state: 'active' });
  data.relations.push({ from: 'demo.target', to: longName, kind: 'Wants', evidence: 'effective' });
  await load(JSON.stringify(data));
  get('units').children.find(b => b.textContent.startsWith('demo.target')).fire('click');
  assert(get('relations-outgoing').querySelectorAll('button').some(b => b.textContent === longName));
  get('evidence').children[1].checked = true; get('evidence').fire('change');
  assert.match(get('relations-outgoing').textContent, /Effective manager relations/);
  assert.match(get('relations-outgoing').textContent, /Disk symlink hints/);
  const wantsGroups = get('relations-outgoing').children.filter(g => g.firstChild?.textContent.startsWith('Wants'));
  assert.equal(wantsGroups.length, 2);
  get('requests-only').checked = true; get('requests-only').fire('change');
  assert(!get('relations-incoming').textContent.includes('PartOf'));
  assert.match(get('relations-incoming').textContent, /No direct relationships match/);
  get('active-only').checked = true; get('active-only').fire('change');
  assert.match(get('relations-status').textContent, /Active only \(snapshot\)/);
  get('relations-search').value = 'no-such-related-unit'; get('relations-search').fire('input');
  assert.match(get('relations-status').textContent, /0 of/);
  assert.match(get('relations-outgoing').textContent, /No direct relationships match/);
  assert.match(get('detail').textContent, /demo.service/);
  await load('{malformed');
  assert.equal(get('relations-incoming').children.length, 0);
  assert.equal(get('relations-outgoing').children.length, 0);
  assert.match(get('relations-status').textContent, /No snapshot loaded/);
});
