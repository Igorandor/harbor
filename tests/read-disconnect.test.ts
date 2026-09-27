import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server/app';
import { IrisClient } from '../server/upstream';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }, read: typeof fetch) {
  const client = new IrisClient('http://controlled.invalid', async (url, init) => {
    if (new URL(String(url)).pathname.endsWith('/info'))
      return Response.json({ result: { apiVersion: 2, username: 'Fixture' } });
    return read(url, init);
  });
  const server = http.createServer(createApp({ irisUrl: 'http://controlled.invalid', client }));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const login = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Fixture', password: 'fixture-only' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(';')[0],
    session = await login.json();
  function request(method: 'GET' | 'POST' = 'GET') {
    const body = JSON.stringify({
      path: method === 'GET' ? '/v2/monitor/dashboard/main' : '/v2/security/audit/records',
      method,
    });
    const pending = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/iris',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Cookie: cookie,
        'X-CSRF-Token': session.csrf,
      },
    });
    pending.on('error', () => {});
    pending.end(body);
    return pending;
  }
  async function activity() {
    const response = await fetch(`http://127.0.0.1:${port}/api/activity`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  return { server, request, activity };
}

test(
  'closing a real gateway GET aborts its controlled native transport',
  { timeout: 3000 },
  async (t) => {
    const started = deferred<AbortSignal>(),
      cancelled = deferred<void>(),
      responseClosed = deferred<void>();
    const f = await fixture(t, async (_url, init) => {
      const signal = init!.signal!;
      started.resolve(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            cancelled.resolve();
            reject(new DOMException('Controlled cancellation', 'AbortError'));
          },
          { once: true },
        );
      });
    });
    let response: http.ServerResponse | undefined;
    f.server.on('request', (req, res) => {
      if (req.url === '/api/iris') {
        response = res;
        res.once('close', () => responseClosed.resolve());
      }
    });
    const pending = f.request(),
      signal = await started.promise;
    assert.equal(signal.aborted, false);
    pending.destroy();
    await Promise.all([responseClosed.promise, cancelled.promise]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(signal.aborted, true);
    assert.equal(response!.listenerCount('close'), 0);
    assert.deepEqual(await f.activity(), []);
  },
);

test(
  'normal gateway completion returns JSON without aborting its completed read',
  { timeout: 3000 },
  async (t) => {
    let signal: AbortSignal | undefined, response: http.ServerResponse | undefined;
    const f = await fixture(t, async (_url, init) => {
      signal = init!.signal!;
      return Response.json({ result: { marker: 'Completed observation' } });
    });
    f.server.on('request', (req, res) => {
      if (req.url === '/api/iris') response = res;
    });
    const [received] = (await once(f.request(), 'response')) as [http.IncomingMessage];
    let text = '';
    for await (const chunk of received) text += chunk;
    assert.equal(received.statusCode, 200);
    assert.equal(JSON.parse(text).data.marker, 'Completed observation');
    assert.equal(signal!.aborted, false);
    assert.equal(response!.listenerCount('close'), 0);
  },
);

test('already-cancelled GET never dispatches but cancellation is not applied to a POST', async () => {
  let calls = 0;
  const client = new IrisClient('http://controlled.invalid', async (_url, init) => {
    calls++;
    assert.equal(init!.signal!.aborted, false);
    return Response.json({ result: {} });
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.request('synthetic', { path: '/info', method: 'GET' }, controller.signal),
    { status: 499 },
  );
  assert.equal(calls, 0);
  await client.request(
    'synthetic',
    { path: '/v2/security/audit/records', method: 'POST' },
    controller.signal,
  );
  assert.equal(calls, 1);
});

test(
  'disconnecting the POST audit operation does not acquire GET cancellation semantics',
  { timeout: 3000 },
  async (t) => {
    const started = deferred<AbortSignal>(),
      release = deferred<void>(),
      closed = deferred<void>();
    const f = await fixture(t, async (_url, init) => {
      started.resolve(init!.signal!);
      await release.promise;
      return Response.json({ result: [] });
    });
    f.server.on('request', (req, res) => {
      if (req.url === '/api/iris') res.once('close', () => closed.resolve());
    });
    const pending = f.request('POST'),
      signal = await started.promise;
    pending.destroy();
    await closed.promise;
    try {
      assert.equal(signal.aborted, false);
    } finally {
      release.resolve();
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    const activity = await f.activity();
    assert.equal(activity.length, 1);
    assert.equal(activity[0].method, 'POST');
    assert.equal(activity[0].status, 200);
  },
);
