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

async function rejectedNestedCase(f: Awaited<ReturnType<typeof fixture>>, patch: object) {
  const bytes = JSON.stringify({ ...f.candidate, ...patch });
  await writeFile(f.filename, bytes);
  const listing = await f.http.get('/api/investigations').expect(200);
  assert.deepEqual(
    listing.body.records.map((row: any) => row.id),
    [f.healthy.id],
  );
  assert.deepEqual(listing.body.unreadable, [f.candidate.id]);
  await f.http.get('/api/investigations/' + f.candidate.id).expect(500);
  await f.http
    .post('/api/investigations/' + f.candidate.id + '/notes')
    .send({ revision: 1, text: 'Must not change corrupted evidence.' })
    .expect(500);
  await f.http
    .post('/api/investigations/' + f.candidate.id + '/status')
    .send({ revision: 1, status: 'resolved', reason: 'Must not bypass a required decision.' })
    .expect(500);
  assert.equal(await readFile(f.filename, 'utf8'), bytes);
  assert.deepEqual(await readFile(f.healthyPath), f.healthyBytes);
  await f.http.get('/api/investigations/' + f.healthy.id).expect(200);
}

function nestedRecord(f: Awaited<ReturnType<typeof fixture>>) {
  const at = f.candidate.createdAt;
  const decision = {
    differenceId: 'difference-1',
    disposition: 'explained',
    note: 'Reviewed',
    at,
    author: f.actor.owner,
  };
  return {
    ...f.candidate,
    notes: [{ id: 'note-1', at, author: f.actor.owner, kind: 'note', text: 'Retained note' }],
    checklist: [
      {
        id: 'step-1',
        title: 'Check evidence',
        instruction: 'Inspect the source',
        required: true,
        state: 'open',
      },
    ],
    captures: [
      {
        id: 'capture-1',
        title: 'Identity',
        sources: ['identity'],
        capturedBy: f.actor.owner,
        bundle: {
          version: 1,
          instance: f.actor.instance,
          startedAt: at,
          finishedAt: at,
          limits: ['Point in time'],
          sections: [
            {
              id: 'identity',
              title: 'Identity',
              path: '/info',
              observedAt: at,
              elapsedMs: 0,
              status: 'collected',
              httpStatus: 200,
              data: { arbitrary: [null, { key: 42 }] },
            },
          ],
        },
      },
    ],
    evidenceReviews: [
      {
        id: 'review-1',
        comparisonVersion: 1,
        title: 'Review',
        beforeId: 'capture-1',
        afterId: 'capture-2',
        createdAt: at,
        createdBy: f.actor.owner,
        updatedAt: at,
        decisions: [decision],
        history: [{ ...decision, eventId: 'event-1' }],
      },
    ],
  };
}

test('malformed timeline and checklist members cannot be returned, edited or resolved', async (t) => {
  const f = await fixture(t),
    record = nestedRecord(f);
  for (const patch of [
    { notes: [null] },
    { notes: [{ ...record.notes[0], text: { unexpected: true } }] },
    { notes: [{ ...record.notes[0], at: '2026-02-30T00:00:00Z' }] },
    { checklist: [null] },
    { checklist: {} },
    { checklist: [{ ...record.checklist[0], state: 'corrupt' }] },
    { checklist: [{ ...record.checklist[0], required: 'false' }] },
    { linkedChanges: [null] },
    { profile: { id: 'profile-1', title: {}, revision: 1, sources: [] } },
  ])
    await rejectedNestedCase(f, patch);
});

test('malformed review and capture structures are isolated before their consumers run', async (t) => {
  const f = await fixture(t),
    record = nestedRecord(f),
    review = record.evidenceReviews[0],
    capture = record.captures[0];
  for (const patch of [
    { evidenceReviews: [null] },
    { evidenceReviews: [{ ...review, decisions: null }] },
    { evidenceReviews: [{ ...review, decisions: [null] }] },
    {
      evidenceReviews: [
        { ...review, decisions: [{ ...review.decisions[0], disposition: 'corrupt' }] },
      ],
    },
    { evidenceReviews: [{ ...review, history: [{ ...review.history[0], eventId: null }] }] },
    {
      evidenceReviews: [
        {
          ...review,
          conclusion: {
            text: 'Done',
            at: f.candidate.createdAt,
            author: f.actor.owner,
            limitsAcknowledged: false,
          },
        },
      ],
    },
    { captures: [null] },
    { captures: [{ ...capture, bundle: { ...capture.bundle, sections: [null] } }] },
    { captures: [{ ...capture, bundle: { ...capture.bundle, limits: {} } }] },
    {
      captures: [
        {
          ...capture,
          bundle: {
            ...capture.bundle,
            sections: [{ ...capture.bundle.sections[0], status: 'corrupt' }],
          },
        },
      ],
    },
  ])
    await rejectedNestedCase(f, patch);
});

test('read validation preserves legacy optional fields, unknown metadata and arbitrary native evidence', async (t) => {
  const f = await fixture(t);
  const record = nestedRecord(f);
  // No recent input-length limits are applied to historical generated timeline entries.
  record.notes[0].text = 'Historical generated explanation '.repeat(200);
  const value = {
    ...record,
    futureMetadata: { retained: true },
    profile: { id: 'legacy-profile', title: 'Legacy profile', revision: 1, sources: [] },
    captures: record.captures.map((capture) => ({
      ...capture,
      futureCapture: [1, 2],
      bundle: {
        ...capture.bundle,
        sections: capture.bundle.sections.map((section) => ({
          ...section,
          futureSection: { retained: true },
          data: JSON.parse(
            '{"__proto__":{"keep":true},"constructor":{"prototype":[null,42,"value"]},"native":{"any":{"shape":true}}}',
          ),
        })),
      },
    })),
  };
  const bytes = JSON.stringify(value);
  await writeFile(f.filename, bytes);
  assert.deepEqual(await f.service.get(f.actor, f.candidate.id), value);
  const detail = await f.http.get('/api/investigations/' + f.candidate.id).expect(200);
  assert.deepEqual(detail.body, value);
  const listing = await f.http.get('/api/investigations').expect(200);
  assert.deepEqual(listing.body.unreadable, []);
  assert.equal(
    listing.body.records.find((row: any) => row.id === f.candidate.id).openRequiredItems,
    1,
  );
  assert.equal(await readFile(f.filename, 'utf8'), bytes);
  await f.http
    .post('/api/investigations/' + f.candidate.id + '/status')
    .send({ revision: 1, status: 'resolved', reason: 'Still requires checklist decision.' })
    .expect(409);
  assert.equal(await readFile(f.filename, 'utf8'), bytes);
  const edited = await f.http
    .post('/api/investigations/' + f.candidate.id + '/notes')
    .send({ revision: 1, text: 'New valid note' })
    .expect(200);
  assert.deepEqual(edited.body.captures, value.captures);
  assert.deepEqual(edited.body.evidenceReviews, value.evidenceReviews);
  assert.deepEqual(edited.body.checklist, value.checklist);
  assert.deepEqual(edited.body.futureMetadata, value.futureMetadata);
  assert.equal(edited.body.notes[0].text, value.notes[0].text);
  assert.deepEqual(await readFile(f.healthyPath), f.healthyBytes);
});

test('service-generated captures and timeline entries remain readable and editable', async (t) => {
  const f = await fixture(t);
  const captured = await f.service.capture(
    f.actor,
    f.candidate.id,
    1,
    ['identity'],
    'Current identity',
  );
  assert.equal(captured.captures[0].bundle.sections[0].status, 'collected');
  assert.equal(captured.notes[0].kind, 'capture');
  const bytes = await readFile(f.filename);
  assert.deepEqual(await f.service.get(f.actor, f.candidate.id), captured);
  const detail = await f.http.get('/api/investigations/' + f.candidate.id).expect(200);
  assert.deepEqual(detail.body, captured);
  assert.deepEqual(await readFile(f.filename), bytes);
  const resolved = await f.http
    .post('/api/investigations/' + f.candidate.id + '/status')
    .send({
      revision: captured.revision,
      status: 'resolved',
      reason: 'Identity collected and reviewed.',
    })
    .expect(200);
  assert.deepEqual(resolved.body.captures, captured.captures);
  assert.deepEqual(resolved.body.notes[0], captured.notes[0]);
  assert.equal(resolved.body.notes[1].kind, 'status');
  assert.deepEqual(await f.service.get(f.actor, f.candidate.id), resolved.body);
});
