import { test } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { createApp } from '../server/app';
import { ApiError, IrisClient, irisError, redact, validateOperation } from '../server/upstream';
const info = { apiVersion: 2, username: 'test', privileges: { Operate: { use: true } } };
function fixture() {
  let clock = 0;
  const calls: any[] = [];
  const client = {
    async request(auth: string, op: any) {
      calls.push(op);
      if (auth === 'Basic ' + Buffer.from('test:wrong').toString('base64'))
        throw new ApiError(401, 'Invalid credentials.');
      return { data: op.path === '/info' ? info : [], status: 200, console: [] };
    },
  } as unknown as IrisClient;
  const app = createApp({
    irisUrl: 'http://iris:52773',
    origin: 'http://portal.test',
    client,
    now: () => clock,
  });
  return {
    agent: supertest.agent(app),
    calls,
    advance: (n: number) => {
      clock += n;
    },
  };
}
test('anonymous users cannot reach admin operations', async () => {
  const { agent } = fixture();
  await agent.post('/api/iris').send({ path: '/v2/users', method: 'GET' }).expect(401);
});
test('session cookie is HttpOnly and SameSite Strict; no upstream password in response', async () => {
  const { agent } = fixture();
  const res = await agent
    .post('/api/login')
    .send({ username: 'test', password: 'safe-test-password' })
    .expect(200);
  assert.match(res.headers['set-cookie'][0], /HttpOnly/);
  assert.match(res.headers['set-cookie'][0], /SameSite=Strict/);
  assert.doesNotMatch(JSON.stringify(res.body), /safe-test-password/);
  await agent.get('/api/session').expect(200);
});
test('cross-origin login and mutation attempts are rejected', async () => {
  const { agent } = fixture();
  await agent
    .post('/api/login')
    .set('Origin', 'https://evil.example')
    .send({ username: 'test', password: 'test' })
    .expect(403);
});
test('CSRF token is mandatory and logout destroys the session', async () => {
  const { agent, calls } = fixture();
  const res = await agent.post('/api/login').send({ username: 'test', password: 'test' });
  await agent.post('/api/iris').send({ path: '/v2/tasks', method: 'GET' }).expect(403);
  assert.equal(calls.length, 1);
  await agent
    .post('/api/iris')
    .set('X-CSRF-Token', res.body.csrf)
    .send({ path: '/v2/tasks', method: 'GET' })
    .expect(200);
  await agent.post('/api/logout').set('X-CSRF-Token', res.body.csrf).send({}).expect(200);
  await agent.get('/api/session').expect(401);
});
test('idle sessions expire after 30 minutes', async () => {
  const { agent, advance } = fixture();
  await agent.post('/api/login').send({ username: 'test', password: 'test' });
  advance(30 * 60000 + 1);
  await agent.get('/api/session').expect(401);
});
test('login attempts are rate limited', async () => {
  const { agent } = fixture();
  for (let i = 0; i < 10; i++)
    await agent.post('/api/login').send({ username: 'test', password: 'wrong' }).expect(401);
  await agent.post('/api/login').send({ username: 'test', password: 'wrong' }).expect(429);
});
test('arbitrary hosts, paths and unapproved writes never reach IRIS', () => {
  for (const path of [
    'https://evil.example',
    '//evil.example',
    '/v2/../login',
    '/v2/database-dir/../security/user',
  ])
    assert.throws(() => validateOperation({ path, method: 'GET' }));
  assert.throws(() =>
    validateOperation({ path: '/v2/database', method: 'DELETE', query: { name: 'USER' } }),
  );
});
test('required identifiers and bounded lists are validated', () => {
  assert.throws(() => validateOperation({ path: '/v2/security/user', method: 'PUT' }));
  assert.throws(() =>
    validateOperation({ path: '/v2/users', method: 'GET', query: { maxRows: '100000' } }),
  );
  assert.throws(() =>
    validateOperation({ path: '/v2/tasks', method: 'GET', query: { maxRows: '-1' } }),
  );
  assert.throws(() =>
    validateOperation({ path: '/v2/tasks', method: 'GET', query: { redirect: 'http://evil' } }),
  );
  assert.doesNotThrow(() =>
    validateOperation({ path: '/v2/tasks', method: 'GET', query: { maxRows: '250' } }),
  );
});
test('credentials are recursively redacted without losing configuration names', () => {
  assert.deepEqual(
    redact({
      Name: 'example',
      Password: 'secret',
      nested: { access_token: 'token', PrivateKeyPassword: 'key', Description: 'fine' },
    }),
    {
      Name: 'example',
      Password: '[redacted]',
      nested: { access_token: '[redacted]', PrivateKeyPassword: '[redacted]', Description: 'fine' },
    },
  );
});
test('IRIS error envelopes are not mistaken for successful writes', () => {
  assert.equal(
    irisError({ status: { errors: [{ error: 'Access denied' }], summary: '' } }),
    'Access denied',
  );
  assert.equal(irisError({ status: { errors: [], summary: '' } }), undefined);
});
test('upstream non-JSON error, timeout, and failed 200 envelope are surfaced', async () => {
  const html = new IrisClient(
    'http://iris',
    async () => new Response('<html>login</html>', { status: 401 }),
  );
  await assert.rejects(() => html.request('x', { path: '/info', method: 'GET' }), { status: 401 });
  const failed = new IrisClient('http://iris', async () =>
    Response.json({ status: { errors: ['Rejected'] } }),
  );
  await assert.rejects(() => failed.request('x', { path: '/info', method: 'GET' }), /Rejected/);
  const timeout = new IrisClient('http://iris', async () => {
    throw new Error('timeout');
  });
  await assert.rejects(() => timeout.request('x', { path: '/info', method: 'GET' }), {
    status: 502,
  });
});
test('query encoding preserves app names without creating new parameters', async () => {
  let called = '';
  const client = new IrisClient('http://iris:52773', async (input) => {
    called = String(input);
    return Response.json({ result: {} });
  });
  await client.request('x', { path: '/v2/web-app', method: 'GET', query: { name: '/api/a&x=1' } });
  assert.equal(new URL(called).searchParams.get('name'), '/api/a&x=1');
  assert.equal(new URL(called).searchParams.has('x'), false);
});

test('oversized upstream streams are cancelled before parsing', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1_000_000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const client = new IrisClient('http://iris', async () => new Response(stream));
  await assert.rejects(
    () => client.request('x', { path: '/info', method: 'GET' }),
    /too much data/,
  );
  assert.equal(cancelled, true);
});

test('successful logins cannot reset the password-guessing budget', async () => {
  const { agent, advance } = fixture();
  for (let i = 0; i < 9; i++)
    await agent.post('/api/login').send({ username: 'test', password: 'wrong' }).expect(401);
  await agent.post('/api/login').send({ username: 'test', password: 'valid' }).expect(200);
  await agent.post('/api/login').send({ username: 'test', password: 'wrong' }).expect(429);
  advance(60001);
  await agent.post('/api/login').send({ username: 'test', password: 'valid' }).expect(200);
});

test('OAuth and separator-spelled credentials are redacted without hiding metadata', () => {
  assert.deepEqual(
    redact({
      ClientSecret: 'oauth-secret',
      private_key: 'pem',
      client_secret: 'secret',
      ClientSecretInterval: 60,
      SecretName: 'display-name',
    }),
    {
      ClientSecret: '[redacted]',
      private_key: '[redacted]',
      client_secret: '[redacted]',
      ClientSecretInterval: 60,
      SecretName: 'display-name',
    },
  );
});

test('upstream error envelopes cannot disclose structured credentials', async () => {
  const client = new IrisClient('http://iris', async () =>
    Response.json(
      {
        error: {
          Password: 'sensitive-password',
          ClientSecret: 'sensitive-client-secret',
          message: 'Rejected',
        },
      },
      { status: 400 },
    ),
  );
  await assert.rejects(
    () => client.request('x', { path: '/info', method: 'GET' }),
    (error: any) => {
      assert.doesNotMatch(error.message, /sensitive-password|sensitive-client-secret/);
      assert.match(error.message, /Rejected/);
      return true;
    },
  );
});

test('upstream diagnostics cannot echo submitted passwords or client secrets', async () => {
  const auth = 'Basic ' + Buffer.from('tester:authentication-password').toString('base64');
  const client = new IrisClient('http://iris', async () =>
    Response.json({
      status: {
        errors: ['Invalid client secret submitted-client-secret using authentication-password'],
      },
    }),
  );
  await assert.rejects(
    () =>
      client.request(auth, {
        path: '/v2/security/oauth2/client/client-configuration/secrets',
        method: 'POST',
        query: { applicationName: 'example' },
        body: { ClientSecret: 'submitted-client-secret' },
      }),
    (error: any) => {
      assert.doesNotMatch(error.message, /submitted-client-secret|authentication-password/);
      assert.match(error.message, /Invalid client secret/);
      return true;
    },
  );
});

test('serialized and URL-encoded credential echoes are removed from diagnostics', async () => {
  const password = 'audit "quoted" + value';
  const encoded = [JSON.stringify(password).slice(1, -1), encodeURIComponent(password)];
  const client = new IrisClient('http://iris', async () =>
    Response.json({ error: `Invalid credentials: ${encoded.join(' or ')}` }, { status: 401 }),
  );
  await assert.rejects(
    () =>
      client.request('Basic ' + Buffer.from(`tester:${password}`).toString('base64'), {
        path: '/info',
        method: 'GET',
      }),
    (error: any) => {
      for (const value of encoded) assert.ok(!error.message.includes(value));
      assert.match(error.message, /Invalid credentials/);
      return true;
    },
  );
});

test('diagnostic masking cannot rewrite a canonical username or resource identifier', async () => {
  for (const username of ['reader-one', 'reader-two']) {
    const client = new IrisClient('http://iris', async () =>
      Response.json({
        result: { username, apiVersion: 2, Password: username },
        console: [`Signed in with ${username}`],
      }),
    );
    const response = await client.request(
      'Basic ' + Buffer.from(`${username}:${username}`).toString('base64'),
      { path: '/info', method: 'GET' },
    );
    assert.equal(response.data.username, username);
    assert.equal(response.data.Password, '[redacted]');
    assert.ok(!JSON.stringify(response.console).includes(username));
  }
});
