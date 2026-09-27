import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, realpath, lstat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import supertest from 'supertest';
import { workspaceRoutes } from '../server/workspace-routes.js';
import { ApiError, type IrisClient, type Operation } from '../server/upstream.js';

const families = [
  ['/v2/security/role', '/v2/security/users'],
  ['/v2/security/oauth2/resource-server', '/v2/security/users'],
  ['/v2/security/oauth2/client/server-definition', '/v2/security/oauth2/client/server-definitions'],
  ['/v2/wallet/collection', '/v2/wallet/collections'],
  ['/v2/device', '/v2/devices'],
  ['/v2/web-app', '/v2/web-apps'],
  ['/v2/task', '/v2/tasks'],
  ['/v2/process/suspend', '/v2/processes'],
];

async function fixture(t: TestContext, path = '/v2/security/role') {
  const temporaryRoot = await realpath(tmpdir());
  const prefix = 'harbor-linked-auth-';
  const root = await mkdtemp(join(temporaryRoot, prefix));
  t.after(async () => {
    const entry = await lstat(root);
    assert.ok(entry.isDirectory() && !entry.isSymbolicLink());
    const resolved = await realpath(root);
    assert.equal(resolved, root, 'Cleanup must use the original fixture directory');
    assert.equal(dirname(resolved), temporaryRoot, 'Cleanup must stay directly inside tmpdir');
    assert.ok(basename(resolved).startsWith(prefix) && basename(resolved).length > prefix.length);
    await rm(resolved, { recursive: true });
  });
  const actor = { owner: 'alice', instance: 'one', auth: 'fixture-only' };
  let deniedPath = '',
    deniedStatus = 403;
  const probes: string[] = [];
  const client = {
    async request(_auth: string, operation: Operation) {
      assert.equal(operation.method, 'GET', 'Access checks must never replay a native mutation');
      probes.push(operation.path);
      if (operation.path === deniedPath) throw new ApiError(deniedStatus, 'Source access ended');
      if (operation.path === '/info')
        return { data: { username: actor.owner, privileges: { Operate: { use: true } } } };
      return { data: [] };
    },
  } as unknown as IrisClient;
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.session = { info: { username: actor.owner }, auth: actor.auth };
    next();
  });
  const services = workspaceRoutes(app, client, root, actor.instance);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error instanceof ApiError ? error.status : 500).json({ error: error.message }),
  );
  async function change(owner = actor.owner, instance = actor.instance) {
    return services.store.create({ owner, instance }, 'changes', {
      version: 1 as const,
      owner,
      instance,
      path,
      method: 'PUT',
      state: 'verified',
      title: 'Restricted configuration change',
      target: 'RestrictedPayrollRole',
      query: { name: 'RestrictedPayrollRole' },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      explanation: 'Synthetic receipt for source authorization checks.',
      verification: 'fields',
      fields: [],
      events: [],
      observation: { Description: 'Restricted recorded readback' },
    });
  }
  async function investigation(title: string) {
    return services.investigations.create(actor, {
      title,
      description: 'Access regression',
      severity: 'minor',
    });
  }
  function sourceFile(id: string, owner = actor.owner, instance = actor.instance) {
    const scope = createHash('sha256')
      .update(instance + '\0' + owner)
      .digest('hex');
    return join(root, 'changes', scope, id + '.json');
  }
  return {
    ...services,
    api: supertest(app),
    actor,
    probes,
    change,
    investigation,
    sourceFile,
    deny(source: string, status = 403) {
      deniedPath = source;
      deniedStatus = status;
    },
  };
}

for (const [path, source] of families)
  test('linked investigation records require fresh source access: ' + path, async (t) => {
    const f = await fixture(t, path),
      change = await f.change();
    const linked = await f.investigation('Previously linked case'),
      empty = await f.investigation('Unlinked case');
    const created = await f.api
      .post('/api/investigations/' + linked.id + '/changes')
      .send({ revision: linked.revision, changeId: change.id, note: '' })
      .expect(200);
    assert.ok(created.body.notes[0].text.includes(change.target));
    await f.api.get('/api/changes/' + change.id).expect(200);
    f.deny(source);
    await f.api.get('/api/changes/' + change.id).expect(403);
    const blocked = await f.api
      .post('/api/investigations/' + empty.id + '/changes')
      .send({ revision: empty.revision, changeId: change.id, note: '' })
      .expect(403);
    assert.ok(!JSON.stringify(blocked.body).includes(change.target));
    const untouched = await f.investigations.get(f.actor, empty.id);
    assert.equal(untouched.revision, empty.revision);
    assert.equal(untouched.notes.length, 0);
    assert.equal(untouched.linkedChanges.length, 0);
    // Export/report buttons use this same JSON detail response; no separate export route exists.
    const detail = await f.api
      .get('/api/investigations/' + linked.id)
      .set('Accept', 'application/json')
      .expect(403);
    assert.ok(!JSON.stringify(detail.body).includes(change.target));
    const list = await f.api.get('/api/investigations').expect(200);
    assert.deepEqual(
      list.body.records.map((record: any) => record.id),
      [empty.id],
    );
    assert.ok(!JSON.stringify(list.body).includes(linked.title));
    await f.api
      .post('/api/investigations/' + linked.id + '/notes')
      .send({ revision: created.body.revision, text: 'Must not return cached linked evidence' })
      .expect(403);
    f.deny('');
    const restored = await f.api.get('/api/investigations/' + linked.id).expect(200);
    assert.equal(restored.body.revision, created.body.revision);
    assert.ok(f.probes.includes(source));
  });

for (const corrupt of ['missing', 'unreadable'] as const)
  test('a ' + corrupt + ' linked source fails closed for link, detail and listing', async (t) => {
    const f = await fixture(t),
      change = await f.change();
    const linked = await f.investigation('Previously linked case'),
      empty = await f.investigation('Unlinked case');
    await f.api
      .post('/api/investigations/' + linked.id + '/changes')
      .send({ revision: linked.revision, changeId: change.id, note: '' })
      .expect(200);
    if (corrupt === 'missing') await unlink(f.sourceFile(change.id));
    else await writeFile(f.sourceFile(change.id), '{not JSON');
    const status = corrupt === 'missing' ? 404 : 500;
    for (const route of [
      '/api/changes/' + change.id,
      '/api/investigations/' + linked.id,
      '/api/investigations',
    ]) {
      const response = await f.api.get(route).expect(status);
      assert.ok(!JSON.stringify(response.body).includes(change.target));
    }
    await f.api
      .post('/api/investigations/' + empty.id + '/changes')
      .send({ revision: empty.revision, changeId: change.id, note: '' })
      .expect(status);
    assert.equal((await f.investigations.get(f.actor, empty.id)).revision, empty.revision);
  });

test('linked source authentication failures never return stored evidence', async (t) => {
  const f = await fixture(t),
    change = await f.change(),
    record = await f.investigation('Linked case');
  await f.api
    .post('/api/investigations/' + record.id + '/changes')
    .send({ revision: record.revision, changeId: change.id, note: '' })
    .expect(200);
  f.deny('/v2/security/users', 401);
  await f.api.get('/api/changes/' + change.id).expect(401);
  await f.api.get('/api/investigations/' + record.id).expect(401);
  const list = await f.api.get('/api/investigations').expect(200);
  assert.deepEqual(list.body.records, []);
});

for (const scope of ['owner', 'instance'] as const)
  test('link authorization preserves ' + scope + ' isolation', async (t) => {
    const f = await fixture(t);
    const change = await f.change(
      scope === 'owner' ? 'bob' : 'alice',
      scope === 'instance' ? 'two' : 'one',
    );
    const record = await f.investigation('Scoped case');
    await f.api
      .post('/api/investigations/' + record.id + '/changes')
      .send({ revision: record.revision, changeId: change.id, note: '' })
      .expect(404);
    assert.equal((await f.investigations.get(f.actor, record.id)).linkedChanges.length, 0);
  });
