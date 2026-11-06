// Tooling only. All topology and timestamps are fictitious.
const fs = require('node:fs');
const path = require('node:path');
const destination = process.argv[2];
if (!destination) throw Error('Usage: node viewer/generate-samples.cjs <new-output-directory>');
fs.mkdirSync(destination, { recursive: true });
function unit(name, state = 'active') {
  const type = name.split('.').pop();
  const sub = { service: 'running', target: 'active', device: 'plugged', mount: 'mounted', socket: 'listening', timer: 'waiting', path: 'waiting' };
  return { name, unit_type: type, description: 'Fictitious ' + name, load_state: 'loaded', active_state: state, sub_state: state === 'active' ? sub[type] : state === 'failed' ? 'failed' : 'dead', unit_file_state: type === 'device' ? null : 'static', loaded: true, installed: type !== 'device', unresolved: false, fragment_path: type === 'device' ? null : '/usr/lib/systemd/system/' + name, drop_in_paths: [], source_path: null, generator_hint: false, default_dependencies: type === 'device' ? false : true, need_daemon_reload: false, install_wanted_by: [], config_notes: ['Fictitious data. Effective origins are undetermined; disk files can differ from loaded configuration.'] };
}
function edge(from, to, kind, evidence = 'effective') {
  return { from, to, kind, evidence, source: evidence === 'effective' ? 'systemctl show: ' + kind + ' (fictional)' : '/etc/systemd/system/demo.target.wants/demo.service (fictional)', confidence: 'observed', origin: 'undetermined' };
}
function timing(name, value) { return { unit: name, event: 'ActiveEnterTimestampMonotonic', value, clock: 'boot_monotonic', unit_of_time: 'microseconds', certainty: value === null ? 'unknown' : 'observed', source: 'Fictitious manager timestamp' }; }
function sample(medium) {
  const units = ['demo.target','demo.service','network.target','data.mount','sys-devices-demo.device','demo.socket','demo.timer','demo.path','shutdown.target','not-loaded.service'].map(n => unit(n, n === 'shutdown.target' ? 'inactive' : 'active'));
  units[1].drop_in_paths = ['/etc/systemd/system/demo.service.d/override.conf'];
  units[3].fragment_path = '/run/systemd/generator/data.mount'; units[3].source_path = '/etc/fstab'; units[3].generator_hint = true;
  units[9] = { ...units[9], active_state: null, sub_state: null, load_state: null, loaded: false, unit_file_state: 'disabled', install_wanted_by: ['demo.target'], config_notes: ['Installed only. Runtime state unknown. WantedBy is an installation hint, not an effective dependency.'] };
  const relations = [edge('demo.target','demo.service','Wants'),edge('demo.service','network.target','After'),edge('demo.service','data.mount','Requires'),edge('demo.service','data.mount','After'),edge('data.mount','sys-devices-demo.device','BindsTo'),edge('data.mount','sys-devices-demo.device','After'),edge('demo.service','demo.target','PartOf'),edge('demo.service','shutdown.target','Conflicts'),edge('demo.socket','demo.service','Triggers'),edge('demo.service','demo.socket','TriggeredBy'),edge('demo.timer','demo.service','Triggers'),edge('demo.path','demo.service','Triggers'),edge('demo.target','demo.service','Wants','disk_symlink'),edge('demo.target','not-loaded.service','Wants','install_hint'),edge('demo.service','unknown-helper.service','Requisite')];
  const timings = units.map((u, i) => timing(u.name, i === 9 || i === 8 ? null : (i + 1) * 430000));
  if (medium) for (let i = 0; i < 280; i++) {
    const name = 'worker-' + String(i).padStart(3, '0') + '.service'; units.push(unit(name, i % 13 === 0 ? 'failed' : 'active'));
    relations.push(edge('demo.target', name, 'Wants'), edge(name, i % 2 ? 'data.mount' : 'network.target', i % 2 ? 'Requires' : 'After'));
    timings.push(timing(name, i % 11 === 0 ? null : 4100000 + i * 55000));
  }
  return { schema_version: 1, metadata: { collected_at_unix_ms: 1700000000000, finished_at_unix_ms: 1700000005000, systemd_version: 'systemd 257 (fictional)', boot_id: '00000000-0000-4000-8000-000000000001', boot_id_at_end: '00000000-0000-4000-8000-000000000001', scope: 'system', history: 'Fictitious latest transition observations, not complete boot history.', diagnostics: [{ item: 'fixture', status: 'partial', detail: 'Fictional device and unit data. Unknown helper is intentionally unresolved.' }] }, units, relations, timings, devices: [{ unit: 'sys-devices-demo.device', sysfs_path: '/sys/devices/fictitious-demo', properties: { SYSTEMD_WANTS: 'demo.service', SYSTEMD_READY: '1', TAGS: ':systemd:' }, source: 'fictitious fixture', rule_origin: 'undetermined; no event history' }], warnings: [{ item: 'fixture', unit: null, message: 'All data is fictitious. Missing timing is unknown, not evidence that a unit never started.' }, { item: 'properties', unit: 'not-loaded.service', message: 'Runtime properties not queried for an unloaded installed unit.' }] };
}
for (const [name, medium] of [['small', false], ['medium', true]]) fs.writeFileSync(path.join(destination, name + '.json'), JSON.stringify(sample(medium), null, 2) + '\n', { flag: 'wx' });
