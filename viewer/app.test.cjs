// DOM smoke harness, not a replacement for the documented real-browser checks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = {}; this.style = {}; this.value = ''; this.checked = false; this.hidden = false; this._text = ''; this.clientWidth = 600; this.clientHeight = 480; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
  insertBefore(node, sibling) { const i = this.children.indexOf(sibling); if (i < 0) throw Error('Missing sibling'); this.children.splice(i, 0, node); }
  get firstChild() { return this.children[0]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type, event = {}) { for (const fn of this.listeners[type] || []) fn({ target: this, ...event }); }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (child.tagName === 'input' && child.checked && selector === 'input:checked') result.push(child);
      if (child.querySelectorAll) result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0 }; }
  getContext() { return new Proxy({}, { get: (_, name) => () => {}, set: () => true }); }
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
