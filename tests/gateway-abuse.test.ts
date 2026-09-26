import { test } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { createServer } from 'node:http';
import { createApp } from '../server/app';
import { ApiError, IrisClient } from '../server/upstream';

function fixture() {
  let time = 0;
  let upstreamCalls = 0;
  const client = {
    async request(auth: string) {
      upstreamCalls++;
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (Buffer.from(auth.slice(6), 'base64').toString().endsWith(':wrong'))
        throw new ApiError(401, 'Rejected');
      return { data: { apiVersion: 2, username: 'test' }, status: 200, console: [] };
    },
  } as unknown as IrisClient;
  const app = createApp({
    irisUrl: 'http://iris',
    origin: 'http://portal.test',
    client,
    now: () => time,
  });
  return { app, advance: (ms: number) => (time += ms), calls: () => upstreamCalls };
}

test('parallel mixed logins and spoofed forwarding headers share one bounded budget', async () => {
  const f = fixture();
  const results = await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      supertest(f.app)
        .post('/api/login')
        .set('X-Forwarded-For', `198.51.100.${i + 1}`)
        .send({ username: 'test', password: i % 2 ? 'wrong' : 'valid' }),
    ),
  );
  assert.equal(f.calls(), 10);
  assert.equal(results.filter((r) => r.status === 429).length, 6);
});

test('oversized, malformed and cross-site login bodies do not reach the upstream', async () => {
  const f = fixture();
  await supertest(f.app)
    .post('/api/login')
    .send({ username: 'test', password: 'x'.repeat(270000) })
    .expect(413);
  const malformed = await supertest(f.app)
    .post('/api/login')
    .set('Content-Type', 'application/json')
    .send('{"password":"private-fixture"');
  assert.ok(malformed.status >= 400);
  assert.ok(!JSON.stringify(malformed.body).includes('private-fixture'));
  await supertest(f.app)
    .post('/api/login')
    .set('Origin', 'http://portal.test')
    .set('Sec-Fetch-Site', 'cross-site')
    .send({ username: 'test', password: 'valid' })
    .expect(403);
  await supertest(f.app)
    .post('/api/login')
    .type('form')
    .send({ username: 'test', password: 'valid' })
    .expect(415);
  assert.equal(f.calls(), 0);
});

test('login rotates credentials, rejects previous CSRF tokens, and prevents caching', async () => {
  const f = fixture();
  const agent = supertest.agent(f.app);
  const first = await agent
    .post('/api/login')
    .send({ username: 'test', password: 'valid' })
    .expect(200);
  const oldCookie = first.headers['set-cookie'][0].split(';')[0];
  const second = await agent
    .post('/api/login')
    .send({ username: 'test', password: 'valid' })
    .expect(200);
  assert.notEqual(first.body.csrf, second.body.csrf);
  await supertest(f.app).get('/api/session').set('Cookie', oldCookie).expect(401);
  await agent
    .post('/api/iris')
    .set('X-CSRF-Token', first.body.csrf)
    .send({ path: '/info', method: 'GET' })
    .expect(403);
  const current = await agent.get('/api/session').expect(200);
  assert.equal(current.headers['cache-control'], 'no-store');
  assert.equal(current.headers['x-content-type-options'], 'nosniff');
  assert.match(current.headers['content-security-policy'], /script-src 'self'/);
});

test('activity cannot extend a session beyond its absolute eight-hour lifetime', async () => {
  const f = fixture();
  const agent = supertest.agent(f.app);
  await agent.post('/api/login').send({ username: 'test', password: 'valid' }).expect(200);
  for (let i = 0; i < 16; i++) {
    f.advance(29 * 60000);
    await agent.get('/api/session').expect(200);
  }
  f.advance(17 * 60000);
  await agent.get('/api/session').expect(401);
});

test('native fetch refuses upstream redirects without transmitting credentials to another target', async () => {
  let redirectedRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/capture') {
      redirectedRequests++;
      res.end('{}');
      return;
    }
    res.writeHead(302, { Location: '/capture' });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const client = new IrisClient(`http://127.0.0.1:${address.port}`);
    await assert.rejects(
      () => client.request('Basic fixture-only', { path: '/info', method: 'GET' }),
      { status: 502 },
    );
    assert.equal(redirectedRequests, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('an unconfigured origin does not trust attacker-controlled Host headers', async () => {
  let calls = 0;
  const client = {
    async request() {
      calls++;
      return { data: { apiVersion: 2, username: 'test' }, status: 200 };
    },
  } as unknown as IrisClient;
  const app = createApp({ irisUrl: 'http://iris', client });
  await supertest(app)
    .post('/api/login')
    .set('Host', 'attacker.test:3100')
    .set('Origin', 'http://attacker.test:3100')
    .send({ username: 'test', password: 'valid' })
    .expect(403);
  assert.equal(calls, 0);
  await supertest(app)
    .post('/api/login')
    .set('Host', 'localhost:3100')
    .set('Origin', 'http://localhost:3100')
    .send({ username: 'test', password: 'valid' })
    .expect(200);
});

test('aggregate and per-account upstream concurrency are bounded and released', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = new IrisClient('http://iris', async () => {
    calls++;
    await gate;
    return Response.json({ result: {} });
  });
  const first = Array.from({ length: 8 }, () =>
    client.request('account-one', { path: '/info', method: 'GET' }),
  );
  const overflow = client.request('account-one', { path: '/info', method: 'GET' });
  // Attach rejection handlers immediately while existing operations are intentionally paused.
  const accountRejected = assert.rejects(() => overflow, { status: 429 });
  const second = Array.from({ length: 8 }, (_, i) =>
    client.request(`account-${i + 2}`, { path: '/info', method: 'GET' }),
  );
  const globallyRejected = assert.rejects(
    () => client.request('account-other', { path: '/info', method: 'GET' }),
    { status: 429 },
  );
  release();
  await Promise.all([...first, ...second, accountRejected, globallyRejected]);
  assert.equal(calls, 16);
  await client.request('account-one', { path: '/info', method: 'GET' });
  assert.equal(calls, 17);
});

test('deeply nested request bodies are refused before any upstream mutation', async () => {
  let calls = 0;
  const client = new IrisClient('http://iris', async () => {
    calls++;
    return Response.json({ result: {} });
  });
  let body: Record<string, unknown> = {};
  for (let i = 0; i < 100; i++) body = { nested: body };
  await assert.rejects(
    () =>
      client.request('account-one', {
        path: '/v2/security/user',
        method: 'PUT',
        query: { name: 'test' },
        body,
      }),
    { status: 400 },
  );
  assert.equal(calls, 0);
});
