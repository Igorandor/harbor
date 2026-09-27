import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { WorkspaceStore, workspaceRecordByteLimit } from '../server/workspace-store';
import { ChangeService } from '../server/change-service';
import type { IrisClient, Operation } from '../server/upstream';
import type { ChangeRecord } from '../shared/change-record';

const actor = { owner: 'Fixture', instance: 'synthetic-quota', auth: 'Basic fixture-only' };
const operation: Operation = {
  path: '/v2/security/role',
  method: 'PUT',
  query: { name: 'FixtureRole' },
  body: { Description: 'After' },
};
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'harbor-outcome-cap-'));
  t.after(async () => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('harbor-outcome-cap-'));
    await rm(target, { recursive: true, force: true });
  });
  let current: Record<string, unknown> = { Name: 'FixtureRole', Description: 'Before' };
  let after: Record<string, unknown> | undefined;
  let response: unknown = { ok: true };
  let asyncId: string | undefined;
  let writes = 0;
  const client = {
    async request(_auth: string, op: Operation) {
      if (op.method === 'GET') return { data: structuredClone(current), status: 200, console: [] };
      writes++;
      current = after ?? { ...current, ...op.body };
      return { data: response, status: 200, console: [], asyncId };
    },
  } as unknown as IrisClient;
  const store = new WorkspaceStore(root),
    service = new ChangeService(store, client);
  return {
    store,
    service,
    current: (value: Record<string, unknown>) => {
      current = value;
    },
    after: (value: Record<string, unknown>) => {
      after = value;
    },
    response: (value: unknown) => {
      response = value;
    },
    writes: () => writes,
    async: () => {
      asyncId = 'fixture-job';
    },
    async bytes(id: string) {
      const scope = (await readdir(join(root, 'changes')))[0];
      return readFile(join(root, 'changes', scope, id + '.json'));
    },
  };
}

test('oversized duplicate readback keeps the verified outcome, baseline and readable field evidence', async (t) => {
  const f = await fixture(t);
  f.current({ Name: 'FixtureRole', Description: 'Before', NativeDetails: 'x'.repeat(2_050_000) });
  const prepared = await f.service.prepare(actor, operation);
  const result = await f.service.execute(actor, prepared.id, prepared.revision, prepared.target);
  assert.equal(result.state, 'verified');
  assert.equal(result.nativeStatus, 200);
  assert.equal(f.writes(), 1);
  assert.deepEqual(result.baseline, prepared.baseline);
  assert.deepEqual(result.result, { ok: true });
  assert.equal(result.observation, undefined);
  assert.equal(result.fields[0].observed, 'After');
  assert.equal(result.fields[0].matches, true);
  assert.deepEqual(result.events.slice(0, prepared.events.length), prepared.events);
  assert.deepEqual(
    result.evidenceOmissions?.map((item) => item.source),
    ['observation'],
  );
  assert.equal(result.evidenceOmissions?.[0].previousRetained, false);
  assert.ok(result.evidenceOmissions![0].bytes > 2_050_000);
  assert.ok((await f.bytes(result.id)).length <= workspaceRecordByteLimit);
  assert.equal(
    JSON.stringify(await f.service.get(actor, result.id)),
    JSON.stringify(JSON.parse(JSON.stringify(result))),
  );
  await assert.rejects(() => f.service.execute(actor, result.id, result.revision, result.target), {
    status: 409,
  });
  assert.equal(f.writes(), 1);
});

test('oversized newly returned native result is explicitly omitted without losing acknowledgement', async (t) => {
  const f = await fixture(t);
  f.response({ NativeDetails: 'x'.repeat(4_050_000) });
  const prepared = await f.service.prepare(actor, {
    path: '/v2/security/user/password',
    method: 'POST',
    query: { name: 'OtherUser' },
    body: { NewPassword: 'synthetic-secret' },
  });
  const result = await f.service.execute(actor, prepared.id, prepared.revision, prepared.target);
  assert.equal(result.state, 'acknowledged');
  assert.equal(result.nativeStatus, 200);
  assert.equal(result.result, undefined);
  assert.deepEqual(
    result.evidenceOmissions?.map((item) => item.source),
    ['result'],
  );
  assert.equal(f.writes(), 1);
  assert.ok(!(await f.bytes(result.id)).toString().includes('synthetic-secret'));
  assert.equal((await f.service.get(actor, result.id)).state, 'acknowledged');
});

test('large field observations retain mismatch truth and later small reconciliation clears omissions without replay', async (t) => {
  const f = await fixture(t);
  f.after({ Name: 'FixtureRole', Description: 'x'.repeat(4_050_000) });
  const prepared = await f.service.prepare(actor, operation);
  const result = await f.service.execute(actor, prepared.id, prepared.revision, prepared.target);
  assert.equal(result.state, 'uncertain');
  assert.equal(result.fields[0].matches, false);
  assert.equal(result.fields[0].observed, undefined);
  assert.deepEqual(
    result.evidenceOmissions?.map((item) => item.source),
    ['observation', 'field observations'],
  );
  assert.equal(result.fields[0].requested, 'After');
  assert.deepEqual(result.baseline, prepared.baseline);
  assert.ok((await f.bytes(result.id)).length <= workspaceRecordByteLimit);
  f.current({ Name: 'FixtureRole', Description: 'After' });
  const recovered = await f.service.reconcile(actor, result.id, result.revision);
  assert.equal(recovered.state, 'verified');
  assert.equal(recovered.fields[0].observed, 'After');
  assert.equal(recovered.fields[0].matches, true);
  assert.equal(recovered.evidenceOmissions, undefined);
  assert.equal(f.writes(), 1);
});

test('omitting a fresh oversized reconciliation preserves all earlier saved evidence and identifies its age', async (t) => {
  const f = await fixture(t);
  f.after({ Name: 'FixtureRole', Description: 'Earlier mismatch' });
  const prepared = await f.service.prepare(actor, operation);
  const prior = await f.service.execute(actor, prepared.id, prepared.revision, prepared.target);
  f.current({ Name: 'FixtureRole', Description: 'x'.repeat(4_050_000) });
  const next = await f.service.reconcile(actor, prior.id, prior.revision);
  assert.equal(next.state, 'uncertain');
  assert.equal(next.fields[0].matches, false);
  assert.deepEqual(next.baseline, prior.baseline);
  assert.deepEqual(next.result, prior.result);
  assert.deepEqual(next.observation, prior.observation);
  assert.equal(next.fields[0].observed, 'Earlier mismatch');
  assert.deepEqual(next.events.slice(0, prior.events.length), prior.events);
  assert.deepEqual(
    next.evidenceOmissions?.map((item) => [item.source, item.previousRetained]),
    [
      ['observation', true],
      ['field observations', true],
    ],
  );
  assert.deepEqual(await f.store.read<ChangeRecord>(actor, 'changes', prior.id), next);
  assert.equal(f.writes(), 1);
});

test('an almost-full prepared receipt fails before any native write and keeps its exact saved bytes', async (t) => {
  const f = await fixture(t);
  f.current({ Name: 'FixtureRole', Description: 'Before', NativeDetails: 'x'.repeat(3_996_000) });
  const prepared = await f.service.prepare(actor, operation);
  const before = await f.bytes(prepared.id);
  assert.ok(before.length > 3_990_000 && before.length <= workspaceRecordByteLimit);
  await assert.rejects(
    () => f.service.execute(actor, prepared.id, prepared.revision, prepared.target),
    (error: any) => {
      assert.equal(error.status, 413);
      assert.match(error.message, /No native write was sent/);
      return true;
    },
  );
  assert.equal(f.writes(), 0);
  assert.deepEqual(await f.bytes(prepared.id), before);
  assert.equal((await f.service.get(actor, prepared.id)).state, 'prepared');
});

test('an oversized unknown async state cannot inflate the outcome narrative or remove earlier native response', async (t) => {
  const f = await fixture(t);
  f.async();
  const prepared = await f.service.prepare(actor, operation);
  const initial = await f.service.execute(actor, prepared.id, prepared.revision, prepared.target);
  assert.equal(initial.state, 'uncertain');
  f.current({ State: 'x'.repeat(4_050_000) });
  const next = await f.service.reconcile(actor, initial.id, initial.revision);
  assert.equal(next.state, 'uncertain');
  assert.match(next.explanation, /unrecognized state/);
  assert.ok(next.explanation.length < 200);
  assert.deepEqual(next.result, initial.result);
  assert.deepEqual(
    next.evidenceOmissions?.map((item) => [item.source, item.previousRetained]),
    [['result', true]],
  );
  assert.equal(next.asyncId, 'fixture-job');
  assert.equal(f.writes(), 1);
  assert.ok((await f.bytes(next.id)).length <= workspaceRecordByteLimit);
});

test('a new raw response cannot consume the reserved outcome and history space below the file cap', async (t) => {
  const f = await fixture(t);
  f.response({ NativeDetails: 'x'.repeat(3_980_000) });
  const prepared = await f.service.prepare(actor, operation);
  const result = await f.service.execute(actor, prepared.id, prepared.revision, prepared.target);
  assert.equal(result.state, 'verified');
  assert.equal(result.result, undefined);
  assert.deepEqual(
    result.evidenceOmissions?.map((item) => item.source),
    ['result'],
  );
  assert.equal(result.observation && (result.observation as any).Description, 'After');
  assert.equal(f.writes(), 1);
  assert.ok((await f.bytes(result.id)).length < 10000);
});
