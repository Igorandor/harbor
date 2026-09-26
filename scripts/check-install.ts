import 'dotenv/config';
import assert from 'node:assert/strict';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const base = process.env.PORTAL_URL ?? 'http://localhost:3100';
const origin = process.env.PORTAL_ORIGIN ?? base;
const username = process.env.IRIS_TEST_USER,
  password = process.env.IRIS_TEST_PASSWORD;
if (!username || !password) throw new Error('Set IRIS_TEST_USER and IRIS_TEST_PASSWORD.');
const root = await fetch(base);
assert.equal(root.status, 200);
assert.match(await root.text(), /Harbor/);
assert.ok(root.headers.get('content-security-policy'));
const login = await fetch(base + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify({ username, password }),
});
assert.equal(login.status, 200, await login.clone().text());
const session = await login.json(),
  cookie = login.headers.get('set-cookie')!.split(';')[0];
for (const path of [
  '/info',
  '/v2/web-apps',
  '/v2/tasks',
  '/extension/telemetry',
  '/extension/logs',
]) {
  const response = await fetch(base + '/api/iris', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Cookie: cookie,
      'X-CSRF-Token': session.csrf,
    },
    body: JSON.stringify({ path, method: 'GET' }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  console.log('PASS installed gateway', path);
}
const logout = await fetch(base + '/api/logout', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: origin,
    Cookie: cookie,
    'X-CSRF-Token': session.csrf,
  },
  body: '{}',
});
assert.equal(logout.status, 200);
console.log('Clean-install gateway checks passed.');
