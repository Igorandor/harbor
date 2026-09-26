import test from 'node:test';
import assert from 'node:assert/strict';
import { IrisClient } from '../server/upstream';

test('empty, HTML and primitive access denials retain 401/403 without leaking their body', async () => {
  for (const status of [401, 403]) {
    for (const body of ['', '<html>private-diagnostic</html>', 'null', '"private-diagnostic"']) {
      let calls = 0;
      const client = new IrisClient('http://iris', async () => {
        calls++;
        return new Response(body, { status });
      });
      await assert.rejects(
        () => client.request('fixture', { path: '/extension/telemetry', method: 'GET' }),
        (error: any) => {
          assert.equal(error.status, status);
          assert.doesNotMatch(error.message, /private-diagnostic|non-JSON/);
          return true;
        },
      );
      assert.equal(calls, 1);
    }
  }
});

test('primitive upstream documents are rejected as protocol failures', async () => {
  for (const data of [null, false, 42, 'not-an-envelope']) {
    const client = new IrisClient('http://iris', async () => Response.json(data));
    await assert.rejects(() => client.request('fixture', { path: '/info', method: 'GET' }), {
      status: 502,
    });
  }
});

test('accepted background operations require a usable job identifier', async () => {
  for (const location of [
    undefined,
    '/api/admin/v2/async-result',
    '/api/admin/v2/async-result?id=',
    'http://[invalid',
  ]) {
    const client = new IrisClient('http://iris', async () =>
      Response.json(
        { result: {} },
        { status: 202, headers: location ? { Location: location } : {} },
      ),
    );
    await assert.rejects(
      () => client.request('fixture', { path: '/v2/security/audit/records', method: 'POST' }),
      { status: 502 },
    );
  }
  const client = new IrisClient('http://iris', async () =>
    Response.json(
      { result: {} },
      { status: 202, headers: { Location: '/api/admin/v2/async-result?id=job-fixture' } },
    ),
  );
  assert.equal(
    (await client.request('fixture', { path: '/v2/security/audit/records', method: 'POST' }))
      .asyncId,
    'job-fixture',
  );
});

test('nonempty native error lists never become successful writes or parser crashes', async () => {
  for (const errors of [[''], [{ message: '' }], [null], [null, 'Access denied'], [false], [0]]) {
    let calls = 0;
    const client = new IrisClient('http://iris', async () => {
      calls++;
      return Response.json({ status: { errors, summary: 'OK' }, result: {} });
    });
    await assert.rejects(
      () =>
        client.request('fixture', {
          path: '/v2/security/user/password',
          method: 'POST',
          query: { name: 'fixture' },
          body: { Password: 'fixture-secret' },
        }),
      (error: any) => {
        assert.equal(error.status, 422);
        assert.ok(error.message.trim().length > 0);
        return true;
      },
    );
    assert.equal(calls, 1, 'a failed write is never automatically retried');
  }
});

test('empty native error lists preserve success and informative errors remain readable', async () => {
  for (const key of ['errors', 'Errors']) {
    const success = new IrisClient('http://iris', async () =>
      Response.json({ status: { [key]: [], summary: 'OK' }, result: { Name: 'fixture' } }),
    );
    assert.equal(
      (await success.request('fixture', { path: '/info', method: 'GET' })).data.Name,
      'fixture',
    );
    const failure = new IrisClient('http://iris', async () =>
      Response.json({ status: { [key]: [{ message: 'Access denied' }] } }),
    );
    await assert.rejects(() => failure.request('fixture', { path: '/info', method: 'GET' }), {
      status: 422,
      message: 'Access denied',
    });
  }
});
