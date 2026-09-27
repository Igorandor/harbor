import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, lstat, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChangeService } from '../server/change-service.js';
import { WorkspaceStore } from '../server/workspace-store.js';
import type { IrisClient, Operation } from '../server/upstream.js';

const fields = ['ChangePassword', 'PasswordNeverExpires', 'HOTPKeyDisplay'];
const actor = { owner: 'operator', instance: 'fixture', auth: 'fixture-only' };
const operation = (body: Record<string, unknown>): Operation => ({
  path: '/v2/security/user',
  method: 'PUT',
  query: { name: 'PolicyUser' },
  body,
});
async function fixture(t: TestContext) {
  const temporaryRoot = await realpath(tmpdir()),
    prefix = 'harbor-policy-readback-';
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
  const state = { record: {} as Record<string, unknown>, writes: 0, reads: 0, apply: true };
  const client = {
    async request(_auth: string, op: Operation) {
      assert.equal(op.path, '/v2/security/user');
      if (op.method === 'GET') {
        state.reads++;
        return { data: structuredClone(state.record), status: 200, console: [] };
      }
      assert.equal(op.method, 'PUT');
      state.writes++;
      if (state.apply) Object.assign(state.record, op.body);
      return { data: structuredClone(state.record), status: 200, console: [] };
    },
  } as unknown as IrisClient;
  const store = new WorkspaceStore(root);
  return { state, store, service: new ChangeService(store, client) };
}

test('each exact boolean policy field is reviewed, conflict-checked and verified by fresh readback', async (t) => {
  const f = await fixture(t);
  for (const name of fields)
    for (const requested of [true, false]) {
      f.state.record = { Name: 'PolicyUser', [name]: !requested };
      const initialReads = f.state.reads;
      const review = await f.service.prepare(actor, operation({ [name]: requested }));
      assert.equal(review.impact?.level, 'high');
      assert.match(review.impact?.summary ?? '', /sign-in or expiration policy/);
      assert.equal(review.verification, 'fields');
      assert.deepEqual(review.fields, [{ name, before: !requested, requested, readable: true }]);
      const done = await f.service.execute(actor, review.id, review.revision, review.target);
      assert.equal(done.state, 'verified');
      assert.equal(done.fields[0].observed, requested);
      assert.equal(done.fields[0].matches, true);
      assert.equal(
        f.state.reads - initialReads,
        3,
        'Prepare, conflict check and readback must each read',
      );
    }
  assert.equal(f.state.writes, 6);
});

test('a changed policy boolean prevents dispatch instead of bypassing the selected-field conflict check', async (t) => {
  const f = await fixture(t);
  for (const name of fields) {
    f.state.record = { [name]: false };
    const review = await f.service.prepare(actor, operation({ [name]: true }));
    f.state.record[name] = true;
    const done = await f.service.execute(actor, review.id, review.revision, review.target);
    assert.equal(done.state, 'conflict');
    assert.equal(f.state.writes, 0);
  }
});

test('mismatched or nonboolean policy readback stays unresolved and reconciliation never repeats the write', async (t) => {
  const f = await fixture(t);
  f.state.apply = false;
  for (const name of fields) {
    f.state.record = { [name]: false };
    const review = await f.service.prepare(actor, operation({ [name]: true }));
    let result = await f.service.execute(actor, review.id, review.revision, review.target);
    assert.equal(result.state, 'uncertain');
    assert.equal(result.fields[0].matches, false);
    const writes = f.state.writes;
    f.state.record[name] = 'unexpected-sensitive-native-value';
    result = await f.service.reconcile(actor, review.id, result.revision);
    assert.equal(result.state, 'uncertain');
    assert.equal(result.fields[0].observed, '[redacted]');
    assert.ok(
      !JSON.stringify(await f.store.read(actor, 'changes', review.id)).includes(
        'unexpected-sensitive-native-value',
      ),
    );
    f.state.record[name] = true;
    result = await f.service.reconcile(actor, review.id, result.revision);
    assert.equal(result.state, 'verified');
    assert.equal(f.state.writes, writes);
  }
});

test('nonboolean policy values and actual secrets remain write-only and absent from saved reviews', async (t) => {
  const f = await fixture(t);
  for (const name of fields)
    for (const value of [
      'submitted-sensitive-value',
      null,
      { data: 'submitted-sensitive-value' },
      ['submitted-sensitive-value'],
    ]) {
      f.state.record = { [name]: 'previous-sensitive-value' };
      const review = await f.service.prepare(actor, operation({ [name]: value }));
      assert.equal(review.fields[0].before, '[redacted]');
      assert.equal(review.fields[0].requested, '[redacted]');
      assert.equal(review.fields[0].readable, false);
      assert.ok(!JSON.stringify(review).includes('sensitive-value'));
    }
  f.state.record = { ChangePassword: 'previous-sensitive-value' };
  const review = await f.service.prepare(
    actor,
    operation({
      ChangePassword: false,
      HOTPKey: 'actual-sensitive-value',
      Password: 'actual-sensitive-value',
      HOTP_Key_Display: true,
      changePassword: true,
      Secret: { ChangePassword: true },
    }),
  );
  assert.equal(review.fields[0].before, '[redacted]');
  assert.equal(review.fields[0].requested, false);
  for (const field of review.fields.slice(1)) {
    assert.equal(field.requested, '[redacted]');
    assert.equal(field.readable, false);
  }
  assert.ok(
    !JSON.stringify(await f.store.read(actor, 'changes', review.id)).includes('sensitive-value'),
  );
});
