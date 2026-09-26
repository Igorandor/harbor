import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const base = process.env.PORTAL_URL ?? 'http://127.0.0.1:3100';
const origin = process.env.PORTAL_ORIGIN ?? 'http://localhost:3100';
const native = process.env.IRIS_URL ?? 'http://127.0.0.1:52773';
const username = process.env.IRIS_TEST_USER,
  password = process.env.IRIS_TEST_PASSWORD;
if (!username || !password)
  throw new Error('Set credentials for a disposable local test instance.');
type Session = { cookie: string; csrf: string };
const sessions: Session[] = [];
const name = 'PortalAuth' + randomBytes(6).toString('hex'),
  roleName = name + 'Role';
const temporaryPassword = randomBytes(24).toString('base64url') + '!4a';
const resources = [
  { Name: '%Admin_Operate', Permissions: 'U' },
  { Name: '%DB_IRISSYS', Permissions: 'R' },
];
async function request(path: string, body?: unknown, session?: Session) {
  const response = await fetch(base + '/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
async function login(username: string, password: string) {
  const r = await request('login', { username, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const session = { cookie: r.headers.get('set-cookie')!.split(';')[0], csrf: r.data.csrf };
  sessions.push(session);
  return session;
}
const admin = await login(username, password);
const call = (session: Session, path: string, method = 'GET', query = {}, body?: unknown) =>
  request('iris', { path, method, query, body }, session);
async function adminCall(path: string, method: string, query: object, body?: unknown) {
  const r = await call(admin, path, method, query, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.data;
}
let createdRole = false,
  createdUser = false;
try {
  await adminCall(
    '/v2/security/role',
    'PUT',
    { name: roleName },
    {
      Description: 'Disposable authorization regression',
      GrantedRoles: [],
      Resources: resources,
    },
  );
  createdRole = true;
  await adminCall(
    '/v2/security/user',
    'POST',
    { name },
    {
      User: { Enabled: true, ChangePassword: false, Roles: [roleName] },
      Password: temporaryPassword,
    },
  );
  createdUser = true;
  const operator = await login(name, temporaryPassword);
  assert.equal((await call(operator, '/extension/telemetry')).status, 200);
  const denied = await call(
    operator,
    '/v2/security/role',
    'PUT',
    { name: roleName },
    {
      Resources: [{ Name: '%Admin_Secure', Permissions: 'U' }],
    },
  );
  assert.equal(denied.status, 403, JSON.stringify(denied.data));
  assert.deepEqual(
    (await adminCall('/v2/security/role', 'GET', { name: roleName })).Resources,
    resources,
  );
  console.log('PASS limited operator can read telemetry but cannot grant security privileges');

  // Leave native operating permission in place but remove database read access.
  // Web Gateway returns an empty 403 before dispatching our extension.
  await adminCall(
    '/v2/security/role',
    'PUT',
    { name: roleName },
    { Resources: resources.slice(0, 1) },
  );
  const databaseDenied = await call(operator, '/extension/telemetry');
  assert.equal(databaseDenied.status, 403, JSON.stringify(databaseDenied.data));
  console.log('PASS native database-access denial remains 403, not a gateway protocol failure');

  await adminCall('/v2/security/user', 'PUT', { name }, { Roles: [] });
  const revoked = await call(operator, '/extension/telemetry');
  assert.ok([401, 403].includes(revoked.status), JSON.stringify(revoked.data));
  const direct = await fetch(new URL('/api/harbor/telemetry', native), {
    headers: {
      Authorization: 'Basic ' + Buffer.from(name + ':' + temporaryPassword).toString('base64'),
    },
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  });
  await direct.body?.cancel();
  assert.ok([401, 403].includes(direct.status));
  console.log(
    'PASS revoked privileges take effect in the same session and at the direct extension',
  );
} finally {
  // Attempt every cleanup even if another removal fails, then report failures.
  const cleanup = [];
  if (createdUser)
    cleanup.push(
      await adminCall('/v2/security/user', 'DELETE', { name }).then(
        () => null,
        (error) => error,
      ),
    );
  if (createdRole)
    cleanup.push(
      await adminCall('/v2/security/role', 'DELETE', { name: roleName }).then(
        () => null,
        (error) => error,
      ),
    );
  for (const session of sessions)
    cleanup.push(
      await request('logout', {}, session).then(
        (r) => (r.status === 200 ? null : new Error('Logout failed')),
        (error) => error,
      ),
    );
  const errors = cleanup.filter(Boolean);
  if (errors.length)
    throw new AggregateError(errors, `Clean up disposable account ${name} and role ${roleName}.`);
  console.log('PASS cleanup: temporary account and role removed; gateway sessions closed');
}
