import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureDiagnostics } from '../server/diagnostics.js';
import { IrisClient } from '../server/upstream.js';
import supertest from 'supertest';
import { createApp } from '../server/app.js';
test('malformed request JSON is a non-cacheable client error without echoing the body', async () => {
  const response = await supertest(createApp({ irisUrl: 'http://iris' }))
    .post('/api/diagnostics')
    .set('Content-Type', 'application/json')
    .send('{secret:broken');
  assert.equal(response.status, 400);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(!response.text.includes('secret'));
});
test('diagnostic capture keeps successful evidence beside forbidden sources and masks credentials', async () => {
  let active = 0,
    peak = 0;
  const client = new IrisClient('http://iris', async (input, init) => {
    assert.equal(init?.method, 'GET');
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    if (String(input).includes('/processes')) return new Response('', { status: 403 });
    return Response.json({ result: { Password: 'hidden', Name: 'example' } });
  });
  const report = await captureDiagnostics(client, 'Basic test', 'local', [
    'identity',
    'processes',
    'tasks',
  ]);
  assert.equal(report.sections[1].status, 'unavailable');
  assert.equal(report.sections[1].httpStatus, 403);
  assert.equal(report.sections[2].status, 'collected');
  assert.ok(peak <= 2);
  assert.ok(!JSON.stringify(report).includes('hidden'));
});
test('reports omit oversized source data and never mislabel pending responses as completed', async () => {
  const large = new IrisClient('http://iris', async () =>
    Response.json({ result: { text: 'x'.repeat(210000) } }),
  );
  const report = await captureDiagnostics(large, 'Basic test', 'local', ['identity']);
  assert.equal(report.sections[0].status, 'too large');
  assert.equal(report.sections[0].data, undefined);
  const pending = {
    request: async () => ({ status: 202, asyncId: 'job', data: {} }),
  } as unknown as IrisClient;
  assert.equal(
    (await captureDiagnostics(pending, 'Basic test', 'local', ['identity'])).sections[0].status,
    'pending',
  );
});
test('invalid and duplicate selections fail before any native request', async () => {
  const client = {
    request: async () => {
      throw Error('must not run');
    },
  } as unknown as IrisClient;
  for (const selection of [[], ['identity', 'identity'], ['/v2/security/user']])
    await assert.rejects(
      () => captureDiagnostics(client, 'Basic test', 'local', selection as any),
      /Choose/,
    );
});
