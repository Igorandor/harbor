import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, lstat, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import express from 'express';
import supertest from 'supertest';
import { workspaceRoutes } from '../server/workspace-routes.js';
import { ChangeService } from '../server/change-service.js';
import { ApiError, type IrisClient, type Operation } from '../server/upstream.js';

async function fixture(t: TestContext) {
  const temporaryRoot = await realpath(tmpdir()),
    prefix = 'harbor-invalid-receipt-';
  const root = await mkdtemp(join(temporaryRoot, prefix));
  t.after(async () => {
    const entry = await lstat(root),
      resolved = await realpath(root);
    assert.ok(entry.isDirectory() && !entry.isSymbolicLink());
    assert.equal(resolved, root);
    assert.equal(dirname(resolved), temporaryRoot);
    assert.ok(basename(resolved).startsWith(prefix) && basename(resolved).length > prefix.length);
    await rm(resolved, { recursive: true });
  });
  const actor = { owner: 'FixtureOwner', instance: 'FixtureInstance', auth: 'fixture-only' };
  const requests: Operation[] = [];
  const client = {
    async request(_auth: string, operation: Operation) {
      requests.push(operation);
      assert.equal(operation.method, 'GET', 'Corruption tests must never dispatch a native write');
      return {
        data:
          operation.path === '/info'
            ? { username: actor.owner, privileges: { Operate: { use: true } } }
            : { Name: 'FixtureRole', Description: 'Before' },
        status: 200,
        console: [],
      };
    },
  } as unknown as IrisClient;
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.session = { auth: actor.auth, info: { username: actor.owner } };
    next();
  });
  const services = workspaceRoutes(app, client, root, actor.instance);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error instanceof ApiError ? error.status : 500).json({ error: error.message }),
  );
  const edit: Operation = {
    path: '/v2/security/role',
    method: 'PUT',
    query: { name: 'FixtureRole' },
    body: { Description: 'After' },
  };
  const healthy = await services.changes.prepare(actor, edit),
    candidate = await services.changes.prepare(actor, edit);
  const scope = (await readdir(join(root, 'changes')))[0];
  const filename = join(root, 'changes', scope, candidate.id + '.json');
  const healthyPath = join(root, 'changes', scope, healthy.id + '.json'),
    healthyBytes = await readFile(healthyPath);
  return {
    ...services,
    root,
    actor,
    client,
    requests,
    healthy,
    candidate,
    filename,
    healthyPath,
    healthyBytes,
    http: supertest(app),
  };
}

test('receipt corruption blocks recovery, cancellation, execution and reconciliation without changing bytes', async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { state: 'sending', events: [null] },
    { state: 'sending', fields: [null] },
    { state: 'prepared', events: [null] },
    { state: 'prepared', fields: [{ name: 'Description', readable: 'false' }] },
    { state: 'verified', impact: { ...f.candidate.impact, related: [null] } },
    { state: 'uncertain', readback: { path: 42, query: [] } },
    {
      state: 'uncertain',
      evidenceOmissions: [
        { source: 'result', bytes: 5, at: f.candidate.createdAt, previousRetained: 'false' },
      ],
    },
    { state: 'prepared', expiresAt: '2026-02-30T10:00:00Z' },
    { state: 'corrupt' },
    { verification: 'corrupt' },
    { query: { name: {} } },
    { events: [{ at: f.candidate.createdAt, action: 'prepared', message: {} }] },
  ]) {
    const bytes = JSON.stringify({ ...f.candidate, ...patch });
    await writeFile(f.filename, bytes);
    const listing = await f.http.get('/api/changes').expect(200);
    assert.deepEqual(
      listing.body.records.map((row: any) => row.id),
      [f.healthy.id],
    );
    assert.deepEqual(listing.body.unreadable, [f.candidate.id]);
    f.requests.length = 0;
    await f.http.get('/api/changes/' + f.candidate.id).expect(500);
    for (const route of ['cancel', 'execute', 'reconcile'])
      await f.http
        .post('/api/changes/' + f.candidate.id + '/' + route)
        .send({ revision: 1, ...(route === 'execute' ? { confirmation: f.candidate.target } : {}) })
        .expect(500);
    assert.ok(
      f.requests.every((operation) => operation.path === '/info'),
      'No receipt-selected source is requested after validation fails',
    );
    // Recovery after a restart uses the same read guard, even without a pending ticket.
    await assert.rejects(
      new ChangeService(f.store, f.client).get(f.actor, f.candidate.id),
      /could not be read/,
    );
    assert.equal(await readFile(f.filename, 'utf8'), bytes);
    assert.deepEqual(await readFile(f.healthyPath), f.healthyBytes);
    await f.http.get('/api/changes/' + f.healthy.id).expect(200);
  }
});

test('a corrupt linked receipt blocks case reads and new links without rewriting either case', async (t) => {
  const f = await fixture(t);
  const input = { title: 'Linked case', description: 'Synthetic evidence', severity: 'minor' };
  const linked = await f.investigations.create(f.actor, input),
    empty = await f.investigations.create(f.actor, { ...input, title: 'Unlinked healthy case' });
  await f.http
    .post('/api/investigations/' + linked.id + '/changes')
    .send({ revision: 1, changeId: f.candidate.id, note: '' })
    .expect(200);
  const scope = (await readdir(join(f.root, 'investigations')))[0];
  const casePath = (id: string) => join(f.root, 'investigations', scope, id + '.json');
  const linkedBytes = await readFile(casePath(linked.id)),
    emptyBytes = await readFile(casePath(empty.id));
  const bytes = JSON.stringify({ ...f.candidate, state: 'sending', events: [null] });
  await writeFile(f.filename, bytes);
  await f.http.get('/api/investigations/' + linked.id).expect(500);
  await f.http.get('/api/investigations').expect(500); // Existing fail-closed linked-source policy.
  await f.http
    .post('/api/investigations/' + empty.id + '/changes')
    .send({ revision: 1, changeId: f.candidate.id, note: '' })
    .expect(500);
  await assert.rejects(
    f.investigations.link(f.actor, empty.id, 1, f.candidate.id, ''),
    /could not be read/,
  );
  await f.http.get('/api/investigations/' + empty.id).expect(200);
  assert.equal(await readFile(f.filename, 'utf8'), bytes);
  assert.deepEqual(await readFile(casePath(linked.id)), linkedBytes);
  assert.deepEqual(await readFile(casePath(empty.id)), emptyBytes);
  assert.deepEqual(await readFile(f.healthyPath), f.healthyBytes);
});

test('legacy optional receipt fields and arbitrary evidence remain unchanged, including normal recovery', async (t) => {
  const f = await fixture(t);
  const native = JSON.parse(
    '{"__proto__":{"retained":true},"constructor":[null,42,{"native":"value"}]}',
  );
  const { impact: _impact, ...legacy } = f.candidate;
  const value = {
    ...legacy,
    state: 'verified',
    baseline: native,
    result: native,
    observation: native,
    fields: [
      {
        name: 'Description',
        before: native,
        requested: native,
        observed: native,
        readable: true,
        matches: true,
        futureField: { kept: true },
      },
    ],
    futureMetadata: native,
    events: [
      {
        at: f.candidate.createdAt,
        action: 'legacy action',
        message: 'Retained generated history '.repeat(200),
      },
    ],
  };
  const bytes = JSON.stringify(value);
  await writeFile(f.filename, bytes);
  const response = await f.http.get('/api/changes/' + f.candidate.id).expect(200);
  assert.deepEqual(response.body, value);
  assert.equal(await readFile(f.filename, 'utf8'), bytes);
  assert.deepEqual((await f.http.get('/api/changes').expect(200)).body.unreadable, []);
  await writeFile(f.filename, JSON.stringify({ ...value, state: 'sending' }));
  const recovered = await f.http.get('/api/changes/' + f.candidate.id).expect(200);
  assert.equal(recovered.body.state, 'uncertain');
  assert.equal(recovered.body.revision, 2);
  assert.deepEqual(recovered.body.fields, value.fields);
  assert.deepEqual(recovered.body.baseline, native);
  assert.deepEqual(recovered.body.result, native);
  assert.deepEqual(recovered.body.observation, native);
  assert.deepEqual(recovered.body.futureMetadata, native);
  assert.deepEqual(recovered.body.events[0], value.events[0]);
  const healthy = await f.http.get('/api/changes/' + f.healthy.id).expect(200);
  assert.deepEqual(
    healthy.body,
    f.healthy,
    'Current service-generated impact and receipt remain valid',
  );
  const canceled = await f.http
    .post('/api/changes/' + f.healthy.id + '/cancel')
    .send({ revision: 1 })
    .expect(200);
  assert.equal(canceled.body.state, 'canceled');
  assert.deepEqual(
    (await f.http.get('/api/changes/' + f.healthy.id).expect(200)).body,
    canceled.body,
  );
});
