import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdtemp, mkdir, cp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const payload = resolve(root, 'ipm/harbor-gateway');

test('every shipped IPM artifact matches the release inventory and version', async () => {
  const inventory = JSON.parse(await readFile(resolve(payload, 'payload.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  assert.equal(inventory.version, pkg.version);
  assert.match(await readFile(resolve(root, 'module.xml'), 'utf8'), new RegExp(`<Version>${pkg.version.replaceAll('.', '\\.')}</Version>`));
  const manifest = await readFile(resolve(root, 'module.xml'), 'utf8');
  const copyNames = [...manifest.matchAll(/<FileCopy Name="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(copyNames, ['ipm/harbor-gateway/', 'docs/HARBOR_IPM.md']);
  assert.match(manifest, /Phase="Compile" When="After" CheckStatus="true"/);
  const actual = [];
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(resolve(directory, entry.name), prefix + entry.name + '/');
      else actual.push(prefix + entry.name);
    }
  }
  await walk(payload);
  assert.deepEqual(actual.filter(name => name !== 'payload.json').sort(), Object.keys(inventory.files).sort());
  for (const [name, digest] of Object.entries(inventory.files)) {
    assert.equal(createHash('sha256').update(await readFile(resolve(payload, name))).digest('hex'), digest, name);
    assert.ok(!name.includes('node_modules') && !name.startsWith('.env') && !name.startsWith('data/'), name);
  }
  assert.ok((await readFile(resolve(payload, 'THIRD_PARTY_LICENSES.txt'), 'utf8')).includes('Permission is hereby granted'));
});

test('copied gateway runs outside the checkout and refuses unsafe investigation locations', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'harbor-ipm-'));
  const installed = resolve(temporary, 'lib/harbor/1.1.0');
  const data = resolve(temporary, 'investigations');
  await cp(payload, installed, { recursive: true });
  await mkdir(data);
  const env = { ...process.env, IRIS_URL: 'http://127.0.0.1:9', IRIS_INSTANCE_ID: 'ipm-package-test',
    HARBOR_DATA_DIR: data, PUBLIC_ORIGIN: 'http://localhost:33987', COOKIE_SECURE: 'false', HOST: '127.0.0.1', PORT: '33987' };
  const start = resolve(installed, 'start.mjs');
  let child;
  try {
    for (const directory of ['relative-data', installed, resolve(installed, '..')]) {
      const rejected = spawnSync(process.execPath, [start], { env: { ...env, HARBOR_DATA_DIR: directory }, encoding: 'utf8', timeout: 10000 });
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /outside the installed package/);
    }
    const link = resolve(temporary, 'linked-data');
    await symlink(installed, link, process.platform === 'win32' ? 'junction' : 'dir');
    const linked = spawnSync(process.execPath, [start], { env: { ...env, HARBOR_DATA_DIR: link }, encoding: 'utf8', timeout: 10000 });
    assert.match(linked.stderr, /outside the installed package/);
    for (const name of ['IRIS_URL', 'IRIS_INSTANCE_ID', 'HARBOR_DATA_DIR', 'PUBLIC_ORIGIN', 'COOKIE_SECURE']) {
      const missing = spawnSync(process.execPath, [start], { env: { ...env, [name]: '' }, encoding: 'utf8', timeout: 10000 });
      assert.notEqual(missing.status, 0);
      assert.ok(missing.stderr.includes(`Set ${name}`));
    }
    child = spawn(process.execPath, [start], { cwd: tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    const base = 'http://127.0.0.1:33987';
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw Error(logs);
      try { ready = (await fetch(base + '/api/health')).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, logs);
    assert.match(await (await fetch(base)).text(), /<title>Harbor/);
    assert.equal((await fetch(base + '/api/investigations')).status, 401);
    assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://foreign.invalid' }, body: '{}' })).status, 403);
    assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
    assert.deepEqual(await readdir(data), []);
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    // Only this test's fresh OS temporary directory is removed.
    assert.ok(temporary.startsWith(resolve(tmpdir(), 'harbor-ipm-')));
    await rm(temporary, { recursive: true, force: true });
  }
});
