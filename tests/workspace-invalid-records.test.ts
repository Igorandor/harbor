import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, lstat, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import express from 'express';
import supertest from 'supertest';
import { WorkspaceStore } from '../server/workspace-store';
import { InvestigationService } from '../server/investigation-service';
import { workspaceRoutes } from '../server/workspace-routes';
import { ApiError, type IrisClient, type Operation } from '../server/upstream';

async function fixture(t: TestContext) {
  const temporaryRoot = await realpath(tmpdir()),
    prefix = 'harbor-invalid-record-';
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
  const client = {
    async request(_auth: string, operation: Operation) {
      assert.equal(operation.method, 'GET');
      assert.equal(operation.path, '/info', 'No native transport participates in these tests');
      return {
        data: { username: actor.owner, privileges: { Operate: { use: true } } },
        status: 200,
        console: [],
      };
    },
  } as unknown as IrisClient;
  const store = new WorkspaceStore(root),
    service = new InvestigationService(store, client);
  const healthy = await service.create(actor, {
    title: 'Healthy sibling',
    description: 'Synthetic stored case',
    severity: 'minor',
  });
  const candidate = await service.create(actor, {
    title: 'Candidate case',
    description: 'Synthetic stored case',
    severity: 'minor',
  });
  const scope = (await readdir(join(root, 'investigations')))[0];
  const filename = join(root, 'investigations', scope, candidate.id + '.json');
  const healthyPath = join(root, 'investigations', scope, healthy.id + '.json');
  const healthyBytes = await readFile(healthyPath);
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.session = { auth: actor.auth, info: { username: actor.owner } };
    next();
  });
  workspaceRoutes(app, client, root, actor.instance);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error instanceof ApiError ? error.status : 500).json({ error: error.message }),
  );
  return {
    actor,
    store,
    service,
    healthy,
    candidate,
    filename,
    healthyPath,
    healthyBytes,
    http: supertest(app),
  };
}
async function rejectedCase(f: Awaited<ReturnType<typeof fixture>>, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value));
  await writeFile(f.filename, bytes);
  await assert.rejects(
    f.service.get(f.actor, f.candidate.id),
    (error: any) => error instanceof ApiError && error.status === 500,
  );
  const listing = await f.service.list(f.actor);
  assert.deepEqual(
    listing.records.map((record) => record.id),
    [f.healthy.id],
  );
  assert.deepEqual(listing.unreadable, [f.candidate.id]);
  assert.equal(listing.total, 2);
  await assert.rejects(
    f.service.note(f.actor, f.candidate.id, f.candidate.revision, 'Must not be saved.'),
    (error: any) => error instanceof ApiError && error.status === 500,
  );
  assert.deepEqual(
    await readFile(f.filename),
    bytes,
    'Rejected data must remain byte-for-byte available for inspection',
  );
  assert.deepEqual(await readFile(f.healthyPath), f.healthyBytes);
}

test('invalid stored timestamps are isolated before sorting and cannot be silently repaired by an update', async (t) => {
  const f = await fixture(t);
  for (const field of ['createdAt', 'updatedAt']) {
    for (const value of [
      42,
      null,
      undefined,
      '',
      'not-a-date',
      '2026-02-30T10:00:00.000Z',
      '2026-09-27T25:00:00Z',
      '2026-09-27T10:00:00',
    ]) {
      await rejectedCase(f, { ...f.candidate, [field]: value });
      await assert.rejects(
        f.store.read(f.actor, 'investigations', f.candidate.id),
        /Stored data could not be read/,
      );
    }
  }
});

test('stored case basics use the existing input contract without supplying missing defaults', async (t) => {
  const f = await fixture(t);
  const variants: Record<string, unknown>[] = [
    ...['title', 'description', 'severity', 'tags', 'status'].map((field) => ({
      [field]: undefined,
    })),
    { title: 42 },
    { title: '  ' },
    { title: 'x'.repeat(161) },
    { description: '' },
    { severity: 'unknown' },
    { tags: null },
    { tags: [''] },
    { status: 'unknown' },
    { notes: null },
    { captures: {} },
    { linkedChanges: null },
  ];
  for (const patch of variants) await rejectedCase(f, { ...f.candidate, ...patch });
});

test('case routes consistently isolate a malformed title and block detail and note updates', async (t) => {
  const f = await fixture(t);
  const bytes = JSON.stringify({ ...f.candidate, title: undefined });
  await writeFile(f.filename, bytes);
  const listing = await f.http.get('/api/investigations').expect(200);
  assert.deepEqual(
    listing.body.records.map((record: any) => record.id),
    [f.healthy.id],
  );
  assert.deepEqual(listing.body.unreadable, [f.candidate.id]);
  await f.http.get('/api/investigations/' + f.candidate.id).expect(500);
  await f.http
    .post('/api/investigations/' + f.candidate.id + '/notes')
    .send({ revision: f.candidate.revision, text: 'Must not be saved.' })
    .expect(500);
  await f.http.get('/api/investigations/' + f.healthy.id).expect(200);
  assert.equal(await readFile(f.filename, 'utf8'), bytes);
  assert.deepEqual(await readFile(f.healthyPath), f.healthyBytes);
});

test('existing UTC timestamps and optional investigation evidence survive validation unchanged', async (t) => {
  const f = await fixture(t);
  for (const timestamp of [
    f.candidate.createdAt,
    '2026-09-27T10:00:00Z',
    '2026-09-27T10:00:00.123456Z',
  ]) {
    const record = {
      ...f.candidate,
      createdAt: timestamp,
      updatedAt: timestamp,
      resolution: 'Retained optional explanation',
      evidenceReviews: [],
      checklist: [],
      profile: { id: 'fixture-profile', revision: 1, title: 'Retained profile', sources: [] },
    };
    const bytes = JSON.stringify(record);
    await writeFile(f.filename, bytes);
    assert.deepEqual(await f.service.get(f.actor, f.candidate.id), record);
    const listing = await f.service.list(f.actor);
    assert.equal(listing.records.length, 2);
    assert.deepEqual(listing.unreadable, []);
    assert.equal(await readFile(f.filename, 'utf8'), bytes);
  }
});
