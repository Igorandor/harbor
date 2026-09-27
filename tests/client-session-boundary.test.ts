import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const compiled = build({
  entryPoints: ['src/api.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
async function harness() {
  const subscriptions: Array<{
    name: string;
    owner: string;
    receive: (event: { data: unknown }) => void;
  }> = [];
  const messages: Array<{ owner: string; data: unknown }> = [];
  const source = (await compiled).outputFiles[0].text;
  function client(
    owner: string,
    channelMode: 'available' | 'unavailable' | 'denied' = 'available',
  ) {
    const calls: Array<{ path: string; init: RequestInit; resolve: (value: any) => void }> = [];
    const timers: Array<() => void> = [];
    const window = new EventTarget();
    let ended = 0;
    window.addEventListener('session-ended', () => {
      ended++;
    });
    class Channel {
      constructor(private name: string) {}
      addEventListener(_type: string, receive: (event: { data: unknown }) => void) {
        subscriptions.push({ name: this.name, owner, receive });
      }
      postMessage(data: unknown) {
        messages.push({ owner, data });
        for (const entry of subscriptions)
          if (entry.name === this.name && entry.owner !== owner)
            queueMicrotask(() => entry.receive({ data }));
      }
    }
    const module = { exports: {} as typeof import('../src/api.js') };
    runInNewContext(source, {
      module,
      exports: module.exports,
      window,
      Event,
      CustomEvent,
      BroadcastChannel:
        channelMode === 'available'
          ? Channel
          : channelMode === 'unavailable'
            ? undefined
            : class {
                constructor() {
                  throw new Error('Channel unavailable');
                }
              },
      fetch(path: string, init: RequestInit) {
        const pending = deferred<any>();
        calls.push({ path, init, resolve: pending.resolve });
        return pending.promise;
      },
      setTimeout(callback: () => void) {
        timers.push(callback);
        return timers.length;
      },
    });
    async function login(name: string) {
      const pending = module.exports.request('login', { username: name, password: 'fixture-only' });
      calls.at(-1)!.resolve(Response.json({ info: { username: name }, csrf: name + '-csrf' }));
      await pending;
      await settle();
    }
    async function logout() {
      const pending = module.exports.request('logout', {});
      calls.at(-1)!.resolve(Response.json({ ok: true }));
      await pending;
      await settle();
    }
    function receive(data: unknown = 'session-changed') {
      for (const entry of subscriptions.filter((entry) => entry.owner === owner))
        entry.receive({ data });
    }
    return {
      api: module.exports,
      calls,
      timers,
      window,
      login,
      logout,
      receive,
      ended: () => ended,
    };
  }
  return { client, messages };
}

test('two isolated clients invalidate local session views on peer login/logout without sending identity or echoing messages', async () => {
  const f = await harness(),
    a = f.client('tab-a'),
    b = f.client('tab-b');
  await a.login('Alice');
  // App handles this event by removing session and unmounting its protected tree.
  let protectedView: string | undefined = 'Alice diagnostic bundle';
  a.window.addEventListener('session-ended', () => {
    protectedView = undefined;
  });
  const callsBefore = a.calls.length;
  await b.login('Bob');
  assert.equal(protectedView, undefined);
  assert.equal(a.calls.length, callsBefore, 'A peer login must not silently load another identity');
  assert.equal(f.messages.length, 2, 'Received invalidations must not be broadcast again');
  assert.deepEqual(
    f.messages.map((message) => message.data),
    ['session-changed', 'session-changed'],
  );
  assert.ok(!JSON.stringify(f.messages).includes('csrf'));
  const ended = a.ended();
  await b.logout();
  assert.equal(a.ended(), ended + 1);
  assert.equal(f.messages.length, 3);
});

for (const status of [200, 401])
  test(
    'an old ' + status + ' response cannot return prior data, overwrite CSRF or end a new login',
    async () => {
      const f = await harness(),
        a = f.client('tab-a');
      await a.login('Alice');
      const old = a.api.request('investigations/old');
      const rejected = assert.rejects(old, /session changed/i);
      const oldCall = a.calls.at(-1)!;
      await a.logout();
      await a.login('Bob');
      const ended = a.ended(),
        broadcastCount = f.messages.length;
      oldCall.resolve(
        Response.json(
          { csrf: 'Alice-stale-csrf', data: 'Alice private report', error: 'Old session ended' },
          { status },
        ),
      );
      await rejected;
      assert.equal(a.ended(), ended);
      assert.equal(f.messages.length, broadcastCount);
      const current = a.api.request('diagnostics', { sources: ['identity'] });
      assert.equal(
        (a.calls.at(-1)!.init.headers as Record<string, string>)['X-CSRF-Token'],
        'Bob-csrf',
      );
      a.calls.at(-1)!.resolve(Response.json({ current: true }));
      await current;
    },
  );

test('a response whose JSON arrives after invalidation cannot restore a stale token', async () => {
  const f = await harness(),
    a = f.client('tab-a');
  await a.login('Alice');
  const body = deferred<unknown>(),
    old = a.api.request('session');
  const rejected = assert.rejects(old, /session changed/i);
  a.calls.at(-1)!.resolve({ ok: true, status: 200, json: () => body.promise });
  await settle();
  await a.login('Bob');
  body.resolve({ info: { username: 'Alice' }, csrf: 'Alice-stale-csrf' });
  await rejected;
  const current = a.api.request('diagnostics', {});
  assert.equal(
    (a.calls.at(-1)!.init.headers as Record<string, string>)['X-CSRF-Token'],
    'Bob-csrf',
  );
  a.calls.at(-1)!.resolve(Response.json({}));
  await current;
});

for (const first of [0, 1])
  test(
    'concurrent startup session responses remain valid when response ' + first + ' arrives first',
    async () => {
      const f = await harness(),
        a = f.client('tab-a');
      const pending = [a.api.request('session'), a.api.request('session')];
      const calls = [...a.calls];
      calls[first].resolve(Response.json({ info: { username: 'Alice' }, csrf: 'Alice-csrf' }));
      assert.equal((await pending[first]).info.username, 'Alice');
      calls[1 - first].resolve(Response.json({ info: { username: 'Alice' }, csrf: 'Alice-csrf' }));
      assert.equal((await pending[1 - first]).info.username, 'Alice');
      assert.equal(a.ended(), 0);
      assert.equal(f.messages.length, 0);
    },
  );

test('a current 401 invalidates both clients once while a rejected login does not broadcast', async () => {
  const f = await harness(),
    a = f.client('tab-a'),
    b = f.client('tab-b');
  await a.login('Alice');
  const beforeA = a.ended(),
    beforeB = b.ended(),
    beforeMessages = f.messages.length;
  const failed = a.api.request('investigations');
  const rejected = assert.rejects(failed, /Current session ended/);
  a.calls.at(-1)!.resolve(Response.json({ error: 'Current session ended' }, { status: 401 }));
  await rejected;
  await settle();
  assert.equal(a.ended(), beforeA + 1);
  assert.equal(b.ended(), beforeB + 1);
  assert.equal(f.messages.length, beforeMessages + 1);
  const login = a.api.request('login', { username: 'Alice', password: 'incorrect' });
  const loginRejected = assert.rejects(login, /Invalid credentials/);
  a.calls.at(-1)!.resolve(Response.json({ error: 'Invalid credentials' }, { status: 401 }));
  await loginRejected;
  assert.equal(f.messages.length, beforeMessages + 1);
});

test('an unreadable current 401 ends the session but an unreadable stale 401 cannot end a newer session', async () => {
  const f = await harness(),
    a = f.client('tab-a'),
    b = f.client('tab-b');
  await a.login('Alice');
  const stale = a.api.request('investigations/old');
  const staleRejected = assert.rejects(stale, /session changed/i);
  const staleCall = a.calls.at(-1)!;
  await a.login('Bob');
  const before = a.ended(),
    peerBefore = b.ended();
  staleCall.resolve(new Response('not JSON', { status: 401 }));
  await staleRejected;
  assert.equal(a.ended(), before);
  const current = a.api.request('investigations');
  const currentRejected = assert.rejects(current, /unreadable response/);
  a.calls.at(-1)!.resolve(new Response('not JSON', { status: 401 }));
  await currentRejected;
  await settle();
  assert.equal(a.ended(), before + 1);
  assert.equal(b.ended(), peerBefore + 1);
});

for (const mode of ['unavailable', 'denied'] as const)
  test('local login and logout still work when BroadcastChannel is ' + mode, async () => {
    const f = await harness(),
      a = f.client('tab-a', mode);
    await a.login('Alice');
    assert.equal(a.ended(), 1);
    await a.logout();
    assert.equal(a.ended(), 2);
    assert.equal(f.messages.length, 0);
  });

test('iris async polling stops before a new request when its original session changes', async () => {
  const f = await harness(),
    a = f.client('tab-a');
  await a.login('Alice');
  const operation = a.api.iris('/v2/security/audit/records');
  const rejected = assert.rejects(operation, /session changed/i);
  a.calls
    .at(-1)!
    .resolve(Response.json({ data: {}, status: 202, console: [], asyncId: 'Alice-job' }));
  await settle();
  assert.equal(a.timers.length, 1);
  await a.login('Bob');
  const calls = a.calls.length;
  a.timers.shift()!();
  await rejected;
  assert.equal(a.calls.length, calls, 'Old async jobs must not be polled with new credentials');
});

test('iris cannot execute a prepared write after invalidation between prepare and execute', async () => {
  const f = await harness(),
    a = f.client('tab-a');
  await a.login('Alice');
  const operation = a.api.iris('/v2/security/role', { name: 'FixtureRole' }, 'PUT', {
    Description: 'New',
  });
  const rejected = assert.rejects(operation, /session changed/i);
  const prepared = { id: 'prepared', revision: 1, target: 'FixtureRole', state: 'prepared' };
  a.calls.at(-1)!.resolve({
    ok: true,
    status: 201,
    json() {
      return {
        then(resolve: (value: unknown) => void) {
          resolve(prepared);
          // Runs after request's JSON continuation, before iris resumes from prepareChange.
          queueMicrotask(() => a.receive());
        },
      };
    },
  });
  await rejected;
  assert.equal(a.calls.filter((call) => call.path.includes('/execute')).length, 0);
});

test('an explicitly initiated execute in a new session still uses that session and completes', async () => {
  const f = await harness(),
    a = f.client('tab-a');
  await a.login('Alice');
  await a.login('Bob');
  const result = a.api.executeChange({
    id: 'bob-review',
    revision: 1,
    target: 'Bob target',
  } as any);
  assert.equal(
    (a.calls.at(-1)!.init.headers as Record<string, string>)['X-CSRF-Token'],
    'Bob-csrf',
  );
  a.calls.at(-1)!.resolve(Response.json({ id: 'bob-review', state: 'verified' }));
  assert.equal((await result).state, 'verified');
});
