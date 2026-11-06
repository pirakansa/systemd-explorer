const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { releaseMetadata } = require('./release-metadata.cjs');
const manifest = path.resolve('Cargo.toml');
const metadata = version => ({ packages: [
  { manifest_path: '/unrelated/Cargo.toml', version: '99.0.0' },
  { manifest_path: manifest, version },
] });
test('release version comes from the root package, with a v-prefixed tag', () => {
  assert.deepEqual(releaseMetadata(metadata('0.1.0'), manifest), {
    version: '0.1.0', tag: 'v0.1.0', prerelease: false,
  });
});
test('SemVer prereleases are distinguished from stable build metadata', () => {
  assert.equal(releaseMetadata(metadata('1.2.3-rc.1+build.2'), manifest).prerelease, true);
  assert.equal(releaseMetadata(metadata('1.2.3+build-2'), manifest).prerelease, false);
});
test('missing packages and unsafe output/ref values fail closed', () => {
  assert.throws(() => releaseMetadata({ packages: [] }, manifest), /Root package/);
  for (const version of ['01.2.3', '1.0', '1.0.0\ntag=other', '1.0.0;echo', '1.0.0/branch', undefined]) {
    assert.throws(() => releaseMetadata(metadata(version), manifest), /SemVer/);
  }
});
test('CLI emits exact workflow outputs and rejects invalid metadata without output injection', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-release-test-'));
  try {
    const input = path.join(dir, 'metadata.json');
    const output = path.join(dir, 'outputs');
    fs.writeFileSync(input, JSON.stringify(metadata('1.2.3-rc.1')));
    const run = () => spawnSync(process.execPath, [path.join(__dirname, 'release-metadata.cjs'), input, manifest], { env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8' });
    assert.equal(run().status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), 'version=1.2.3-rc.1\ntag=v1.2.3-rc.1\nprerelease=true\n');
    fs.writeFileSync(input, JSON.stringify(metadata('1.2.3\nother=unsafe')));
    assert.notEqual(run().status, 0);
    assert(!fs.readFileSync(output, 'utf8').includes('unsafe'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
