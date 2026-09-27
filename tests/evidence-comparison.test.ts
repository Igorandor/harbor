import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import supertest from 'supertest';
import {
  compareEvidence,
  comparisonCsv,
  comparisonReport,
  defaultEvidenceFilter,
  filterDifferences,
  reviewProgress,
} from '../shared/evidence-comparison.js';
import type { CaseCapture, Investigation } from '../shared/investigation.js';
import { summarizeCase } from '../shared/investigation.js';
import { diagnosticSources, type DiagnosticId } from '../shared/diagnostics.js';
import { InvestigationService } from '../server/investigation-service.js';
import { WorkspaceStore } from '../server/workspace-store.js';
import { ApiError, IrisClient } from '../server/upstream.js';
import { workspaceRoutes } from '../server/workspace-routes.js';

function capture(data: unknown, source: DiagnosticId = 'health'): CaseCapture {
  const known = diagnosticSources.find((item) => item.id === source)!;
  return {
    id: randomUUID(),
    title: 'Captured data',
    sources: [source],
    capturedBy: 'alice',
    bundle: {
      version: 1,
      instance: 'one',
      startedAt: '2026-09-27T01:00:00Z',
      finishedAt: '2026-09-27T01:00:01Z',
      limits: [],
      sections: [
        {
          ...known,
          observedAt: '2026-09-27T01:00:00Z',
          elapsedMs: 2,
          status: 'collected',
          httpStatus: 200,
          data,
        },
      ],
    },
  };
}

test('evidence distinguishes absence, null, type changes and numeric deltas', () => {
  const result = compareEvidence(
    capture({ remove: null, type: '1', metric: 3 }),
    capture({ add: null, type: 1, metric: 8 }),
  );
  const rows = result.sources[0].differences;
  assert.equal(rows.find((row) => row.path === '/remove')?.kind, 'removed');
  assert.equal(rows.find((row) => row.path === '/remove')?.before?.type, 'null');
  assert.equal(rows.find((row) => row.path === '/add')?.before, undefined);
  assert.equal(rows.find((row) => row.path === '/add')?.after?.type, 'null');
  assert.equal(rows.find((row) => row.path === '/type')?.kind, 'type changed');
  assert.equal(rows.find((row) => row.path === '/metric')?.numericDelta, 5);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
});

test('only known root inventory identities ignore ordering; nested configuration preserves precedence', () => {
  const tasks = [
    { Id: 1, Name: 'First' },
    { Id: 2, Name: 'Second' },
  ];
  assert.equal(
    compareEvidence(capture(tasks, 'tasks'), capture([...tasks].reverse(), 'tasks'))
      .differenceCount,
    0,
  );
  const before = capture({ Settings: tasks }, 'tasks');
  const after = capture({ Settings: [...tasks].reverse() }, 'tasks');
  assert.ok(compareEvidence(before, after).differenceCount > 0);
  const duplicate = [
    { Id: 1, Name: 'First' },
    { Id: 1, Name: 'Second' },
  ];
  const result = compareEvidence(
    capture(duplicate, 'tasks'),
    capture([...duplicate].reverse(), 'tasks'),
  );
  assert.ok(result.differenceCount > 0);
  assert.match(result.sources[0].notices.join(' '), /no unique stable identity/);
});

test('PID reuse with observed generation is an add/remove, never the same process', () => {
  const before = capture([{ Pid: 10, StartTimeUTC: 'old', JobNumber: 1 }], 'processes');
  const after = capture([{ Pid: 10, StartTimeUTC: 'new', JobNumber: 2 }], 'processes');
  assert.deepEqual(
    compareEvidence(before, after)
      .sources[0].differences.map((row) => row.kind)
      .sort(),
    ['added', 'removed'],
  );
  // Native inventory may omit generation: do not invent process identity from PID.
  const positional = compareEvidence(
    capture([{ Pid: 10 }], 'processes'),
    capture([{ Pid: 11 }], 'processes'),
  );
  assert.match(positional.sources[0].notices.join(' '), /array positions/);
});

test('unavailable and omitted sources do not become removed configuration or healthy equality', () => {
  const before = capture({ value: true });
  const after = capture(undefined);
  assert.equal(compareEvidence(before, after).sources[0].status, 'unavailable');
  after.bundle.sections[0].status = 'unavailable';
  after.bundle.sections[0].notice = 'Permission denied';
  const result = compareEvidence(before, after);
  assert.equal(result.differenceCount, 0);
  assert.equal(result.unavailableCount, 1);
  assert.match(result.sources[0].notices.join(' '), /Permission denied/);
  after.bundle.sections = [];
  assert.equal(compareEvidence(before, after).sources[0].afterStatus, 'not selected');
});

test('comparison bounds report limited coverage and retain deep differences', () => {
  const left = Object.fromEntries(Array.from({ length: 205 }, (_, index) => ['k' + index, 0]));
  const right = Object.fromEntries(Array.from({ length: 205 }, (_, index) => ['k' + index, 1]));
  const limited = compareEvidence(capture(left), capture(right));
  assert.equal(limited.differenceCount, 200);
  assert.equal(limited.limitedCount, 1);
  let a: unknown = 'before',
    b: unknown = 'after';
  for (let index = 0; index < 20; index++) {
    a = { nested: a };
    b = { nested: b };
  }
  const deep = compareEvidence(capture(a), capture(b));
  assert.equal(deep.differenceCount, 1);
  assert.match(deep.sources[0].differences[0].context ?? '', /depth limit/);
  const clipped = compareEvidence(capture('a'.repeat(1700)), capture('b'.repeat(1700)));
  assert.equal(clipped.sources[0].differences[0].before?.preview.length, 1600);
  assert.equal(clipped.sources[0].differences[0].before?.clipped, true);
});

test('same capture or different instance is rejected before comparison', () => {
  const one = capture({});
  assert.throws(() => compareEvidence(one, one), /different captures/);
  const two = capture({});
  two.bundle.instance = 'two';
  assert.throws(() => compareEvidence(one, two), /different instances/);
});

test('path escaping and compact identifiers remain usable for large upstream keys', () => {
  const result = compareEvidence(capture({}), capture({ ['a/b~c' + 'x'.repeat(5000)]: 1 }));
  const row = result.sources[0].differences[0];
  assert.ok(row.path.startsWith('/a~1b~0c'));
  assert.ok(row.id.length < 128);
});

test('review filters use current dispositions and opt in to value search', () => {
  const comparison = compareEvidence(capture({ port: 'before' }), capture({ port: 'AFTER' }));
  const row = comparison.sources[0].differences[0];
  const decisions = [
    {
      differenceId: row.id,
      disposition: 'expected' as const,
      note: 'Approved',
      author: 'alice',
      at: 'now',
    },
  ];
  assert.equal(
    filterDifferences(comparison, decisions, { ...defaultEvidenceFilter, query: 'after' }).length,
    0,
  );
  assert.equal(
    filterDifferences(comparison, decisions, {
      ...defaultEvidenceFilter,
      query: 'after',
      searchValues: true,
    }).length,
    1,
  );
  assert.equal(
    filterDifferences(comparison, decisions, {
      ...defaultEvidenceFilter,
      disposition: 'unreviewed',
    }).length,
    0,
  );
  assert.equal(
    filterDifferences(comparison, decisions, { ...defaultEvidenceFilter, source: 'tasks' }).length,
    0,
  );
  assert.equal(reviewProgress(comparison).unreviewed, 1);
});

test('HTML and CSV exports escape source values and analyst text', () => {
  const comparison = compareEvidence(
    capture('safe'),
    capture(' \t=HYPERLINK("bad")<script>alert(1)</script>'),
  );
  const csv = comparisonCsv(comparison, []);
  assert.ok(csv.includes('"\' \t=HYPERLINK(""bad"")'));
  const html = comparisonReport(comparison);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('not an atomic snapshot'));
});

const actor = { owner: 'alice', instance: 'one', auth: 'Basic private' };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'harbor-evidence-'));
  const store = new WorkspaceStore(root);
  const service = new InvestigationService(store, {} as IrisClient);
  const record: Investigation = await service.create(actor, {
    title: 'Evidence review',
    description: 'Check retained observations',
    severity: 'minor',
    tags: [],
  });
  const before = capture({ metric: 1 });
  const after = capture({ metric: 2 });
  record.captures = [before, after];
  record.revision++;
  await store.write(record, 'investigations', record.revision - 1);
  return { root, store, service, record, before, after };
}

test('review decisions persist, reject stale revisions and retain superseded reasoning', async () => {
  const f = await fixture();
  const started = await f.service.startReview(
    actor,
    f.record.id,
    f.record.revision,
    'Maintenance result',
    f.before.id,
    f.after.id,
  );
  const review = started.evidenceReviews![0];
  const difference = compareEvidence(f.before, f.after).sources[0].differences[0];
  const first = await f.service.decideEvidence(
    actor,
    started.id,
    started.revision,
    review.id,
    difference.id,
    'investigate',
    'Needs checking',
  );
  await assert.rejects(
    () =>
      f.service.decideEvidence(
        actor,
        started.id,
        started.revision,
        review.id,
        difference.id,
        'expected',
        'Stale',
      ),
    /changed/,
  );
  await assert.rejects(
    () => f.service.concludeReview(actor, first.id, first.revision, review.id, 'Done'),
    /each retained difference/,
  );
  const second = await f.service.decideEvidence(
    actor,
    first.id,
    first.revision,
    review.id,
    difference.id,
    'explained',
    'Confirmed by native history',
  );
  const concluded = await f.service.concludeReview(
    actor,
    second.id,
    second.revision,
    review.id,
    'Metric changed following the reviewed action.',
  );
  const reopenedService = new InvestigationService(new WorkspaceStore(f.root), {} as IrisClient);
  const saved = await reopenedService.get(actor, concluded.id);
  assert.equal(saved.evidenceReviews![0].decisions.length, 1);
  assert.equal(saved.evidenceReviews![0].history.length, 2);
  assert.equal(saved.evidenceReviews![0].history[0].note, 'Needs checking');
  assert.equal(saved.evidenceReviews![0].conclusion?.author, 'alice');
  assert.equal(summarizeCase(saved).reviewCount, 1);
  assert.ok(!('evidenceReviews' in summarizeCase(saved)));
  await assert.rejects(
    () => reopenedService.get({ ...actor, owner: 'bob' }, saved.id),
    /not found/,
  );
  await assert.rejects(
    () => reopenedService.get({ ...actor, instance: 'other' }, saved.id),
    /not found/,
  );
});

test('review lifecycle protects concluded and archived evidence while retaining prior conclusion in timeline', async () => {
  const f = await fixture();
  let record = await f.service.startReview(
    actor,
    f.record.id,
    f.record.revision,
    'Review changes',
    f.before.id,
    f.after.id,
  );
  const id = record.evidenceReviews![0].id;
  const difference = compareEvidence(f.before, f.after).sources[0].differences[0];
  record = await f.service.decideEvidence(
    actor,
    record.id,
    record.revision,
    id,
    difference.id,
    'expected',
    'Expected counter growth',
  );
  record = await f.service.concludeReview(
    actor,
    record.id,
    record.revision,
    id,
    'Original conclusion',
  );
  await assert.rejects(
    () =>
      f.service.decideEvidence(
        actor,
        record.id,
        record.revision,
        id,
        difference.id,
        'unreviewed',
        'Recheck',
      ),
    /Reopen the review/,
  );
  record = await f.service.reopenReview(actor, record.id, record.revision, id, 'Need more context');
  assert.equal(record.evidenceReviews![0].conclusion, undefined);
  assert.ok(record.notes.some((entry) => entry.text.includes('Original conclusion')));
  record = await f.service.status(actor, record.id, record.revision, 'resolved', 'Review complete');
  await assert.rejects(
    () =>
      f.service.concludeReview(actor, record.id, record.revision, id, 'Cannot alter closed case'),
    /Reopen the investigation/,
  );
});

test('review cannot reference another case, duplicate pair or non-existent difference', async () => {
  const f = await fixture();
  await assert.rejects(
    () =>
      f.service.startReview(
        actor,
        f.record.id,
        f.record.revision,
        'Wrong capture',
        randomUUID(),
        f.after.id,
      ),
    /not part/,
  );
  await assert.rejects(
    () =>
      f.service.startReview(
        actor,
        f.record.id,
        f.record.revision,
        'Same capture',
        f.before.id,
        f.before.id,
      ),
    /different/,
  );
  const started = await f.service.startReview(
    actor,
    f.record.id,
    f.record.revision,
    'One pair',
    f.before.id,
    f.after.id,
  );
  await assert.rejects(
    () =>
      f.service.startReview(actor, started.id, started.revision, 'Again', f.before.id, f.after.id),
    /already exists/,
  );
  await assert.rejects(
    () =>
      f.service.decideEvidence(
        actor,
        started.id,
        started.revision,
        started.evidenceReviews![0].id,
        'health:999',
        'expected',
        'Unknown',
      ),
    /does not belong/,
  );
});

test('review routes require current source privileges and explicit limit acknowledgement', async () => {
  const f = await fixture();
  let denied = false;
  const client = {
    request: async (_auth: string, op: { path: string }) => {
      if (op.path === '/info')
        return { data: { username: actor.owner, privileges: { Operate: { use: true } } } };
      if (denied) throw new ApiError(403, 'Access revoked');
      return { data: {} };
    },
  } as unknown as IrisClient;
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.session = { info: { username: actor.owner }, auth: actor.auth };
    next();
  });
  workspaceRoutes(app, client, f.root, actor.instance);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error instanceof ApiError ? error.status : 400).json({ error: error.message }),
  );
  const api = supertest(app);
  const base = '/api/investigations/' + f.record.id;
  const created = await api
    .post(base + '/evidence-reviews')
    .send({
      revision: f.record.revision,
      title: 'Route review',
      beforeId: f.before.id,
      afterId: f.after.id,
    })
    .expect(200);
  const value = created.body as Investigation;
  const reviewId = value.evidenceReviews![0].id;
  await api
    .post(base + `/evidence-reviews/${reviewId}/conclusion`)
    .send({ revision: value.revision, text: 'No acknowledgement' })
    .expect(400);
  denied = true;
  await api.get(base).expect(403);
  await api
    .post(base + `/evidence-reviews/${reviewId}/decisions`)
    .send({
      revision: value.revision,
      differenceId: 'health:0',
      disposition: 'expected',
      note: 'Cannot write after revocation',
    })
    .expect(403);
  assert.equal((await f.service.get(actor, f.record.id)).revision, value.revision);
});
