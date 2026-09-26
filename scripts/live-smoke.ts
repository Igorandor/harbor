import 'dotenv/config';

import assert from 'node:assert/strict';

import { IrisClient } from '../server/upstream';

import { entities } from '../shared/catalog';

const username = process.env.IRIS_TEST_USER,
  password = process.env.IRIS_TEST_PASSWORD;

if (!username || !password)
  throw new Error(
    'Set IRIS_TEST_USER and IRIS_TEST_PASSWORD for a disposable local test instance.',
  );

const client = new IrisClient(process.env.IRIS_URL ?? 'http://127.0.0.1:52773');

const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

const suffix = Date.now().toString(36),
  name = 'HarborTest' + suffix;

let failures = 0;

for (const entity of Object.values(entities).filter(
  (e) => !['secrets', 'oauthClients'].includes(e.id),
)) {
  try {
    const result = await client.request(auth, { path: entity.list, method: 'GET', query: {} });
    assert.ok(Array.isArray(result.data));
    console.log('PASS list', entity.id, result.data.length);

    if (result.data.length && entity.detail && !entity.noDetail) {
      const row = result.data[0];
      if (row[entity.key] === undefined)
        throw new Error(`Missing row identity ${entity.key}; keys: ${Object.keys(row)}`);
      await client.request(auth, {
        path: entity.detail,
        method: 'GET',
        query: { [entity.param!]: String(row[entity.key]) },
      });
      console.log('PASS detail', entity.id);
    }
  } catch (e) {
    console.error('FAIL', entity.id, (e as Error).message);
    failures++;
  }
}

const workflows = [
  {
    path: '/v2/security/resource',
    name,
    body: { Description: 'Temporary Harbor integration test', PublicPermission: 'R' },
    edit: { Description: 'Updated test resource' },
  },

  {
    path: '/v2/security/role',
    name,
    body: {
      Description: 'Temporary Harbor integration test',
      Resources: [{ Name: '%DB_USER', Permissions: 'R' }],
      GrantedRoles: [],
    },
    edit: { Description: 'Updated test role' },
  },

  {
    path: '/v2/web-app',
    name: '/harbor-test-' + suffix,
    body: {
      NameSpace: 'USER',
      Enabled: true,
      AutheEnabled: 32,
      DispatchClass: 'Harbor.Rest',
      Description: 'Temporary integration test',
    },
    edit: { Description: 'Updated test app' },
  },

  {
    path: '/v2/wallet/collection',
    name,
    body: { EditResource: '%Admin_Wallet:USE', UseResource: '%Admin_Wallet:USE' },
    edit: { UseResource: '%Admin_Operate:USE' },
  },

  {
    path: '/v2/device',
    name,
    body: {
      PhysicalDevice: '/tmp/harbor-test.txt',
      Type: 'OTH',
      SubType: 'M/UX',
      Description: 'Temporary test device',
    },
    edit: { Description: 'Updated test device' },
  },

  {
    path: '/v2/security/ssl-configuration',
    name,
    body: { Enabled: true, Type: 0, VerifyPeer: 1, CAFile: '%OSCertificateStore' },
    edit: { Description: 'Updated test TLS' },
  },
];

for (const flow of workflows) {
  let created = false;
  try {
    await client.request(auth, {
      path: flow.path,
      method: 'PUT',
      query: { name: flow.name },
      body: flow.body,
    });
    created = true;

    await client.request(auth, {
      path: flow.path,
      method: 'PUT',
      query: { name: flow.name },
      body: flow.edit,
    });

    const read = await client.request(auth, {
      path: flow.path,
      method: 'GET',
      query: { name: flow.name },
    });

    for (const [key, value] of Object.entries(flow.edit)) assert.deepEqual(read.data[key], value);

    console.log('PASS create/update/read', flow.path);
  } catch (e) {
    console.error('FAIL CRUD', flow.path, (e as Error).message);
    failures++;
  } finally {
    if (created)
      try {
        await client.request(auth, {
          path: flow.path,
          method: 'DELETE',
          query: { name: flow.name },
        });
        console.log('PASS cleanup', flow.path);
      } catch (e) {
        failures++;
        console.error('Cleanup required:', flow.path, flow.name, (e as Error).message);
      }
  }
}

for (const path of [
  '/extension/telemetry',
  '/extension/logs',
  '/v2/task/history',
  '/v2/journal/files',
  '/v2/security/audit/records',
]) {
  try {
    const r = await client.request(auth, {
      path,
      method: path === '/v2/security/audit/records' ? 'POST' : 'GET',
    });
    console.log('PASS observability', path, r.status, r.asyncId ?? '');
  } catch (e) {
    failures++;
    console.error('FAIL observability', path, (e as Error).message);
  }
}

console.log(failures ? 'FAILURES: ' + failures : 'All live smoke checks passed.');
process.exitCode = failures ? 1 : 0;
