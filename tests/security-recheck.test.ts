import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { createApp } from '../server/app';
import { IrisClient } from '../server/upstream';

test('fallback response data cannot contain an unmasked duplicate of the console', async () => {
  for (const password of ['fallback-secret-fixture', 'a'])
    for (const path of ['/info', '/extension/logs'])
      for (const result of [undefined, null]) {
        const client = new IrisClient('http://iris', async () =>
          Response.json({ result, Name: password, console: [password] }),
        );
        const response = await client.request(
          'Basic ' + Buffer.from('reader:' + password).toString('base64'),
          { path, method: 'GET' },
        );
        assert.deepEqual(response.console, ['[redacted]']);
        assert.deepEqual(response.data.console, ['[redacted]']);
        if (path === '/info')
          assert.equal(response.data.Name, password, 'ordinary identifiers remain exact');
      }
});

test('invalid native identity or API version cannot create an authenticated session', async () => {
  for (const data of [
    {},
    { apiVersion: 2 },
    { apiVersion: 2, username: '' },
    { apiVersion: 2, username: '   ' },
    { apiVersion: 2, username: 42 },
    { apiVersion: 2, username: {} },
    { apiVersion: 2, username: 'x'.repeat(129) },
    { apiVersion: 'unknown', username: 'reader' },
    { apiVersion: [2], username: 'reader' },
    { apiVersion: 2.5, username: 'reader' },
    { apiVersion: 'Infinity', username: 'reader' },
    { username: 'reader' },
    null,
  ]) {
    const client = {
      async request() {
        return { data, status: 200, console: [] };
      },
    } as unknown as IrisClient;
    const agent = supertest.agent(
      createApp({
        irisUrl: 'http://iris',
        origin: 'http://portal.test',
        client,
      }),
    );
    const response = await agent
      .post('/api/login')
      .send({ username: 'reader', password: 'fixture' })
      .expect(502);
    assert.equal(response.headers['set-cookie'], undefined);
    await agent.get('/api/session').expect(401);
  }
});

test('valid native canonical identity is preserved and older API versions remain unsupported', async () => {
  for (const apiVersion of [1, 2, '2']) {
    const client = {
      async request() {
        return { data: { apiVersion, username: 'CanonicalReader' }, status: 200, console: [] };
      },
    } as unknown as IrisClient;
    const agent = supertest.agent(
      createApp({
        irisUrl: 'http://iris',
        origin: 'http://portal.test',
        client,
      }),
    );
    const response = await agent
      .post('/api/login')
      .send({ username: 'reader', password: 'fixture' })
      .expect(apiVersion === 1 ? 409 : 200);
    if (apiVersion !== 1) {
      assert.equal(response.body.info.username, 'CanonicalReader');
      assert.equal(
        (await agent.get('/api/session').expect(200)).body.info.username,
        'CanonicalReader',
      );
    }
  }
});
