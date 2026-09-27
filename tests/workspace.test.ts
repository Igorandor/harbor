import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../server/workspace-store.js';
import { ChangeService } from '../server/change-service.js';
import { InvestigationService } from '../server/investigation-service.js';
import { ApiError, IrisClient, type Operation } from '../server/upstream.js';
import { runtimeConfiguration } from '../server/configuration.js';

const actor = { owner: 'alice', instance: 'iris-a', auth: 'Basic private-credential' };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'harbor-workspace-'));
  const store = new WorkspaceStore(root);
  let record: any = { Name: 'ReviewRole', Description: 'Before', GrantedRoles: [] };
  let writes = 0,
    denyRead = false,
    loseResponse = false;
  const client = {
    request: async (_auth: string, op: Operation) => {
      if (op.method === 'GET') {
        if (denyRead) throw new ApiError(403, 'denied');
        if (!record) throw new ApiError(404, 'missing');
        return { data: structuredClone(record), status: 200, console: [] };
      }
      writes++;
      record = op.method === 'DELETE' ? undefined : { ...record, ...op.body };
      if (loseResponse) throw new ApiError(504, 'response lost');
      return { data: { ok: true }, status: 200, console: [] };
    },
  } as unknown as IrisClient;
  return {
    root,
    store,
    client,
    service: new ChangeService(store, client),
    get record() {
      return record;
    },
    set record(value: any) {
      record = value;
    },
    get writes() {
      return writes;
    },
    set denyRead(value: boolean) {
      denyRead = value;
    },
    set loseResponse(value: boolean) {
      loseResponse = value;
    },
  };
}
const edit: Operation = {
  path: '/v2/security/role',
  method: 'PUT',
  query: { name: 'ReviewRole' },
  body: { Description: 'After' },
};

test('record reads reject oversized files and symbolic links before parsing', async (t) => {
  const f = await fixture();
  const record = await f.service.prepare(actor, edit);
  const scope = (await readdir(join(f.root, 'changes')))[0];
  const path = join(f.root, 'changes', scope, record.id + '.json');
  await writeFile(path, Buffer.alloc(4_000_001, 32));
  await assert.rejects(() => f.store.read(actor, 'changes', record.id), /could not be read/);
  await unlink(path);
  const target = join(f.root, 'target.json');
  await writeFile(target, JSON.stringify(record));
  try { await symlink(target, path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.diagnostic('Symlink fixture unavailable under this Windows account; oversized check passed.');
      return;
    }
    throw error;
  }
  await assert.rejects(() => f.store.read(actor, 'changes', record.id), /could not be read/);
});

test('different reviews of route aliases share one dispatch lock', async () => {
  const f = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const dispatched = new Promise<void>((resolve) => { entered = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  const client = { request: async (_auth: string, op: Operation) => {
    if (op.method === 'GET') return { data: { Name: '/Review', Description: 'Before' }, status: 200, console: [] };
    writes++;
    entered();
    await blocked;
    return { data: {}, status: 200, console: [] };
  } } as unknown as IrisClient;
  const service = new ChangeService(f.store, client);
  const a = await service.prepare(actor, { path: '/v2/web-app', method: 'PUT', query: { name: '/Review' }, body: { Description: 'After' } });
  const b = await service.prepare(actor, { path: '/v2/web-app', method: 'PUT', query: { name: '/review/' }, body: { Description: 'After' } });
  const first = service.execute(actor, a.id, a.revision, a.target);
  await dispatched;
  try {
    await assert.rejects(() => service.execute(actor, b.id, b.revision, b.target), /in progress/);
    assert.equal(writes, 1);
  } finally { release(); await first; }
});

test('workspace scope excludes native auth and rejects cross-account access', async () => {
  const f = await fixture();
  const prepared = await f.service.prepare(actor, edit);
  await assert.rejects(
    () => f.store.read({ ...actor, owner: 'bob' }, 'changes', prepared.id),
    /not found/,
  );
  await assert.rejects(
    () => f.store.read({ ...actor, instance: 'iris-b' }, 'changes', prepared.id),
    /not found/,
  );
  const scopes = await readdir(join(f.root, 'changes'));
  const text = await readFile(join(f.root, 'changes', scopes[0], prepared.id + '.json'), 'utf8');
  assert.ok(!text.includes(actor.auth));
  assert.ok(!text.includes('"auth"'));
});
test('review executes once and verifies selected fields while preserving unrelated changes', async () => {
  const f = await fixture(),
    review = await f.service.prepare(actor, edit);
  f.record.GrantedRoles = ['ExtraRole'];
  const done = await f.service.execute(actor, review.id, review.revision, review.target);
  assert.equal(done.state, 'verified');
  assert.equal(f.writes, 1);
  assert.deepEqual(f.record.GrantedRoles, ['ExtraRole']);
  await assert.rejects(
    () => f.service.execute(actor, review.id, review.revision, review.target),
    /no longer ready/,
  );
  assert.equal(f.writes, 1);
});
test('changed selected field refuses dispatch', async () => {
  const f = await fixture(),
    review = await f.service.prepare(actor, edit);
  f.record.Description = 'External';
  assert.equal(
    (await f.service.execute(actor, review.id, review.revision, review.target)).state,
    'conflict',
  );
  assert.equal(f.writes, 0);
});
test('lost response is reconciled by a read without replaying mutation', async () => {
  const f = await fixture(),
    review = await f.service.prepare(actor, edit);
  f.loseResponse = true;
  const uncertain = await f.service.execute(actor, review.id, review.revision, review.target);
  assert.equal(uncertain.state, 'uncertain');
  assert.equal(f.writes, 1);
  const checked = await f.service.reconcile(actor, review.id, uncertain.revision);
  assert.equal(checked.state, 'verified');
  assert.equal(f.writes, 1);
});
test('failed readback after successful write is unresolved, not native rejection', async () => {
  const f = await fixture();
  let reads = 0;
  const client = {
    request: async (auth: string, op: Operation) => {
      if (op.method === 'GET' && ++reads === 3) throw new ApiError(403, 'revoked');
      return f.client.request(auth, op);
    },
  } as IrisClient;
  const service = new ChangeService(f.store, client),
    review = await service.prepare(actor, edit);
  const result = await service.execute(actor, review.id, review.revision, review.target);
  assert.equal(result.state, 'uncertain');
  assert.equal(result.nativeStatus, 200);
  assert.equal(f.writes, 1);
});
test('prepared write-only credential is not persisted and is acknowledged without equality claim', async () => {
  const f = await fixture(),
    review = await f.service.prepare(actor, {
      path: '/v2/security/user/password',
      method: 'POST',
      query: { name: 'alice' },
      body: { NewPassword: 'test-secret-value' },
    });
  assert.ok(!JSON.stringify(review).includes('test-secret-value'));
  const result = await f.service.execute(actor, review.id, review.revision, review.target);
  assert.equal(result.state, 'acknowledged');
  const persisted = await f.store.read(actor, 'changes', review.id);
  assert.ok(!JSON.stringify(persisted).includes('test-secret-value'));
});
test('a restart invalidates prepared credentials and never sends their writes', async () => {
  const f = await fixture(),
    review = await f.service.prepare(actor, edit);
  const restart = new ChangeService(f.store, f.client);
  assert.equal((await restart.get(actor, review.id)).state, 'expired');
  assert.equal(f.writes, 0);
});
test('process generation mismatch rejects a reused PID before action', async () => {
  const f = await fixture();
  f.record = {
    Pid: 812,
    StartTimeUTC: '2026-09-27 10:00:00',
    JobNumber: 4,
    CanBeTerminated: true,
    State: 'RUN',
  };
  const review = await f.service.prepare(actor, {
    path: '/v2/process/terminate',
    method: 'POST',
    query: { id: '812' },
  });
  f.record.StartTimeUTC = '2026-09-27 10:01:00';
  assert.equal(
    (await f.service.execute(actor, review.id, review.revision, review.target)).state,
    'conflict',
  );
  assert.equal(f.writes, 0);
});
test('missing process identity fails closed', async () => {
  const f = await fixture();
  f.record = { Pid: 812, CanBeTerminated: true };
  await assert.rejects(
    () =>
      f.service.prepare(actor, {
        path: '/v2/process/terminate',
        method: 'POST',
        query: { id: '812' },
      }),
    /start time/,
  );
  assert.equal(f.writes, 0);
});
test('investigation notes persist with revision conflicts and controlled archive lifecycle', async () => {
  const f = await fixture(),
    service = new InvestigationService(f.store, f.client);
  const created = await service.create(actor, {
    title: 'Task failure',
    description: 'Scheduled task did not finish.',
    severity: 'major',
    tags: ['tasks'],
  });
  const noted = await service.note(actor, created.id, created.revision, 'Checked task history');
  await assert.rejects(
    () => service.note(actor, created.id, created.revision, 'Stale note'),
    /changed/,
  );
  await assert.rejects(
    () => service.status(actor, noted.id, noted.revision, 'archived', 'Complete'),
    /Resolve/,
  );
  const resolved = await service.status(
    actor,
    noted.id,
    noted.revision,
    'resolved',
    'Restored scheduling',
  );
  const archived = await service.status(
    actor,
    resolved.id,
    resolved.revision,
    'archived',
    'Retained for reference',
  );
  await assert.rejects(() => service.note(actor, archived.id, archived.revision, 'No'), /Reopen/);
  const reopened = await service.status(
    actor,
    archived.id,
    archived.revision,
    'open',
    'Recurrence',
  );
  assert.equal((await service.get(actor, reopened.id)).notes.length, 4);
});
test('deployment configuration requires deliberate secure origin and upstream choices', () => {
  assert.throws(() => runtimeConfiguration({ HARBOR_MODE: 'deployment' }), /HTTPS/);
  assert.throws(
    () => runtimeConfiguration({ IRIS_URL: 'http://user:password@iris' }),
    /credentials/,
  );
  assert.throws(
    () => runtimeConfiguration({ PUBLIC_ORIGIN: 'https://portal.example', COOKIE_SECURE: 'false' }),
    /COOKIE_SECURE/,
  );
  assert.throws(() => runtimeConfiguration({ PORT: '3.5' }), /PORT/);
  const valid = runtimeConfiguration({
    HARBOR_MODE: 'deployment',
    PUBLIC_ORIGIN: 'https://portal.example',
    COOKIE_SECURE: 'true',
    IRIS_URL: 'https://iris.example',
    IRIS_INSTANCE_ID: 'main-cluster',
  });
  assert.equal(valid.instanceId, 'main-cluster');
  assert.equal(valid.secure, true);
});
test('user creation compares nested User input with the flat native user record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harbor-user-create-'));
  let user: any;
  const client = {
    request: async (_auth: string, op: Operation) => {
      if (op.method === 'POST') {
        user = { Name: 'new-user', ...op.body?.User };
        return { data: user, status: 201, console: [] };
      }
      if (!user) throw new ApiError(404, 'not found');
      return { data: user, status: 200, console: [] };
    },
  } as unknown as IrisClient;
  const service = new ChangeService(new WorkspaceStore(root), client);
  const review = await service.prepare(actor, {
    path: '/v2/security/user',
    method: 'POST',
    query: { name: 'new-user' },
    body: { User: { Enabled: true, Roles: [] }, Password: 'private-value' },
  });
  const result = await service.execute(actor, review.id, review.revision, review.target);
  assert.equal(result.state, 'verified');
  assert.ok(!result.fields.some((field) => field.name === 'User'));
  assert.ok(!JSON.stringify(result).includes('private-value'));
});
test('process resume cannot verify an absent or unknown execution state', async () => {
  for (const missingState of [undefined, {}, 'UNKNOWN']) {
    const f = await fixture();
    f.record = { Pid: 812, StartTimeUTC: '2026-09-27 10:00:00', JobNumber: 4, State: missingState };
    const review = await f.service.prepare(actor, {
      path: '/v2/process/resume',
      method: 'POST',
      query: { id: '812' },
    });
    const result = await f.service.execute(actor, review.id, review.revision, review.target);
    assert.equal(result.state, 'uncertain');
  }
});
test('generated task identity from the native result is used for exact readback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harbor-task-create-'));
  let task: any;
  const observed: string[] = [];
  const client = {
    request: async (_auth: string, op: Operation) => {
      if (op.method === 'POST') {
        task = { Id: 841, ...op.body };
        return { data: task, status: 201, console: [] };
      }
      observed.push(op.query?.id ?? '');
      return { data: task, status: 200, console: [] };
    },
  } as unknown as IrisClient;
  const service = new ChangeService(new WorkspaceStore(root), client);
  const review = await service.prepare(actor, {
    path: '/v2/task',
    method: 'POST',
    body: { Name: 'Single task', Description: 'Observe result' },
  });
  const result = await service.execute(actor, review.id, review.revision, review.target);
  assert.equal(result.state, 'verified');
  assert.deepEqual(observed, ['841']);
});
test('active administrator access and management routes are protected before native requests', async () => {
  const f = await fixture();
  for (const operation of [
    { path: '/v2/security/user', method: 'DELETE', query: { name: 'Alice' } },
    {
      path: '/v2/security/user',
      method: 'PUT',
      query: { name: 'alice' },
      body: { Enabled: false },
    },
    {
      path: '/v2/web-app',
      method: 'PUT',
      query: { name: '/API/HARBOR/' },
      body: { Enabled: false },
    },
  ] as Operation[])
    await assert.rejects(() => f.service.prepare(actor, operation), /active account|protects/);
  assert.equal(f.writes, 0);
});
