import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { createApp } from '../server/app';
import { IrisClient } from '../server/upstream';
import { consolePreview } from '../server/activity';
import { redact } from '../shared/redaction';

test('credential masking processes original text once and treats secret patterns literally', () => {
  assert.equal(redact('dear', ['d', 'e', 'a', 'r']), '[redacted]'.repeat(4));
  assert.equal(redact('a.* + [x]', ['a.*', '[x]']), '[redacted] + [redacted]');
  assert.equal(redact('long-secret secret', ['secret', 'long-secret']), '[redacted] [redacted]');
  assert.deepEqual(redact({ a: 'fixture', b: 'fixture' }, ['fixture']), {
    a: '[redacted]',
    b: '[redacted]',
  });
});

test('excessive credential matchers are rejected before any native write', async () => {
  let calls = 0;
  const client = new IrisClient('http://iris', async () => {
    calls++;
    return Response.json({ result: {} });
  });
  for (const Password of [Array.from({ length: 129 }, (_, i) => `secret-${i}`), 'x'.repeat(32769)])
    await assert.rejects(
      () =>
        client.request('fixture', {
          path: '/v2/security/user/password',
          method: 'POST',
          query: { name: 'fixture' },
          body: { Password },
        }),
      /Credential fields exceed/,
    );
  assert.equal(calls, 0);
});

test('async task diagnostics mask authentication echoes without changing result identities', async () => {
  const password = 'private-async-fixture';
  const username = 'operator-' + password;
  const client = new IrisClient('http://iris', async () =>
    Response.json({
      result: {
        State: 'Finished',
        Console: [`Echo: ${password}`],
        FailureReason: `Rejected ${password}`,
        Result: [{ Name: username }],
      },
    }),
  );
  const response = await client.request(
    'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
    {
      path: '/v2/async-result',
      method: 'GET',
      query: { id: 'fixture-task' },
    },
  );
  assert.doesNotMatch(response.data.Console.join(' '), /private-async-fixture/);
  assert.doesNotMatch(response.data.FailureReason, /private-async-fixture/);
  assert.equal(response.data.Result[0].Name, username);
});

test('activity retains a bounded console preview instead of the complete native output', async () => {
  const console = ['🙂'.repeat(12000), ...Array.from({ length: 300 }, () => 'native diagnostic')];
  const client = {
    async request(_auth: string, op: { path: string }) {
      return {
        data: op.path === '/info' ? { apiVersion: 2, username: 'reader' } : [],
        status: 200,
        console: op.path === '/info' ? [] : console,
      };
    },
  } as unknown as IrisClient;
  const agent = supertest.agent(
    createApp({ irisUrl: 'http://iris', origin: 'http://portal.test', client }),
  );
  const login = await agent
    .post('/api/login')
    .send({ username: 'reader', password: 'fixture' })
    .expect(200);
  const response = await agent
    .post('/api/iris')
    .set('X-CSRF-Token', login.body.csrf)
    .send({ path: '/v2/tasks', method: 'GET' })
    .expect(200);
  assert.deepEqual(response.body.console, console, 'the requested response must remain intact');
  const activity = await agent.get('/api/activity').expect(200);
  const preview = activity.body[0].console;
  assert.ok(Buffer.byteLength(JSON.stringify(preview), 'utf8') <= 16384);
  assert.ok(preview.length <= 101);
  assert.match(preview.at(-1), /truncated/i);
});

test('async job lists mask encoded diagnostics and retain job and result identifiers', async () => {
  const password = 'quoted "secret" + value';
  const client = new IrisClient('http://iris', async () =>
    Response.json({
      result: [
        {
          ID: password,
          State: 'Failed',
          Console: [JSON.stringify(password).slice(1, -1)],
          FailureReason: encodeURIComponent(password),
          Result: { Name: password },
        },
      ],
    }),
  );
  const { data } = await client.request(
    'Basic ' + Buffer.from(`reader:${password}`).toString('base64'),
    { path: '/v2/async-results', method: 'GET' },
  );
  assert.deepEqual(data[0].Console, ['[redacted]']);
  assert.equal(data[0].FailureReason, '[redacted]');
  assert.equal(data[0].ID, password);
  assert.equal(data[0].Result.Name, password);
});

test('console previews bound escaping, multibyte content and line count and preserve small output', () => {
  for (const input of [
    ['"\\\n'.repeat(10000)],
    ['🙂'.repeat(12000)],
    Array.from({ length: 500 }, () => ''),
    Array.from({ length: 100 }, () => 'line'.repeat(100)),
  ]) {
    const preview = consolePreview(input);
    assert.ok(Buffer.byteLength(JSON.stringify(preview), 'utf8') <= 16384);
    assert.ok(preview.length <= 101);
    assert.match(preview.at(-1)!, /truncated/i);
  }
  const small = ['first line', '', 'a quoted "value"'];
  assert.deepEqual(consolePreview(small), small);
  assert.deepEqual(consolePreview([]), []);
  assert.deepEqual(consolePreview(null), []);
});
