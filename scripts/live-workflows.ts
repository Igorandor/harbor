import 'dotenv/config';

import assert from 'node:assert/strict';

import { taskDefaults } from '../shared/task-defaults';

import { IrisClient, type Operation } from '../server/upstream';

const { IRIS_TEST_USER: user, IRIS_TEST_PASSWORD: password } = process.env;

if (!user || !password)
  throw new Error(
    'Set IRIS_TEST_USER and IRIS_TEST_PASSWORD. Use only a disposable test IRIS instance.',
  );

const client = new IrisClient(process.env.IRIS_URL ?? 'http://127.0.0.1:52773'),
  auth = 'Basic ' + Buffer.from(user + ':' + password).toString('base64');

const call = (
  path: string,
  method: Operation['method'] = 'GET',
  query: Record<string, string> = {},
  body?: Record<string, unknown>,
) => client.request(auth, { path, method, query, body });

const suffix = Date.now().toString(36),
  name = 'HarborWorkflow' + suffix;

const cleanup: Array<() => Promise<unknown>> = [];

try {
  await call(
    '/v2/security/user',
    'POST',
    { name },
    {
      User: {
        FullName: 'Temporary workflow test',
        Enabled: true,
        Roles: [],
        ChangePassword: false,
      },
      Password: 'Temporary-Only!49' + suffix,
    },
  );
  cleanup.push(() => call('/v2/security/user', 'DELETE', { name }));

  await call('/v2/security/user', 'PUT', { name }, { Enabled: false });
  assert.equal((await call('/v2/security/user', 'GET', { name })).data.Enabled, false);
  console.log('PASS user create, disable and read');

  await call(
    '/v2/wallet/collection',
    'PUT',
    { name },
    { EditResource: '%Admin_Wallet:USE', UseResource: '%Admin_Wallet:USE' },
  );
  cleanup.push(() => call('/v2/wallet/collection', 'DELETE', { name }));

  await call(
    '/v2/wallet/secret',
    'PUT',
    { name: name + '.ApiKey' },
    {
      Type: '%Wallet.KeyValue',
      WalletSecretConfig: {
        AllowedHosts: ['example.invalid'],
        RequireTLS: true,
        Usage: ['HTTP'],
        Secret: { apiKey: 'NotARealSecret' },
      },
    },
  );
  cleanup.push(() => call('/v2/wallet/secret', 'DELETE', { name: name + '.ApiKey' }));

  const secrets = await call('/v2/wallet/secrets', 'GET', { collection: name });
  assert.equal(secrets.data.length, 1);
  assert.ok(!JSON.stringify(secrets.data).includes('NotARealSecret'));
  console.log(
    'PASS wallet secret creation and metadata-only listing',
    JSON.stringify(secrets.data),
  );

  await call(
    '/v2/task',
    'POST',
    {},
    {
      ...taskDefaults(user),
      Name: name,
      TaskClass: 'Harbor.DemoTask',
      NameSpace: '%SYS',
      TimePeriod: 'Daily',
      TimePeriodEvery: '1',
      Description: 'Disposable integration task',
    },
  );

  const tasks = await call('/v2/tasks', 'GET', { filter: name });
  const id = String(tasks.data.find((t: any) => t.Name === name).Id);
  cleanup.push(() => call('/v2/task', 'DELETE', { id }));

  // Editing sends only changed fields: preserve a concurrent update to another field.
  const taskBefore = (await call('/v2/task', 'GET', { id })).data;
  await call('/v2/task', 'PUT', { id }, { Description: 'Concurrent description update' });
  await call('/v2/task', 'PUT', { id }, { SuspendOnError: !taskBefore.SuspendOnError });
  const taskAfter = (await call('/v2/task', 'GET', { id })).data;
  assert.equal(taskAfter.Description, 'Concurrent description update');
  assert.equal(taskAfter.SuspendOnError, !taskBefore.SuspendOnError);
  assert.equal(taskAfter.Name, taskBefore.Name);
  assert.equal(taskAfter.TaskClass, taskBefore.TaskClass);
  console.log('PASS task partial edit preserves unrelated configuration');

  await call('/v2/task/suspend', 'POST', { id }, { LeaveInQueue: true });
  assert.equal((await call('/v2/task/info', 'GET', { id })).data.Suspended, true);

  await call('/v2/task/resume', 'POST', { id });
  assert.equal((await call('/v2/task/info', 'GET', { id })).data.Suspended, false);
  await call('/v2/task/run', 'POST', { id }, { RunNow: true });
  console.log('PASS task creation, suspension, resumption and on-demand run');

  await call(
    '/v2/security/ssl-configuration',
    'PUT',
    { name },
    { Enabled: true, Type: 0, VerifyPeer: 1, CAFile: '%OSCertificateStore' },
  );
  cleanup.push(() => call('/v2/security/ssl-configuration', 'DELETE', { name }));

  await call(
    '/v2/security/oauth2/client/server-definition',
    'POST',
    {},
    {
      IssuerEndpoint: 'https://example.invalid/' + name,
      SSLConfiguration: '',
      Metadata: {
        issuer: 'https://example.invalid/' + name,
        authorization_endpoint: 'https://example.invalid/authorize',
        token_endpoint: 'https://example.invalid/token',
      },
    },
  );

  const servers = await call('/v2/security/oauth2/client/server-definitions');
  const server = servers.data.find((s: any) => s.IssuerEndpoint.includes(name));
  console.log('OAuth server identity', JSON.stringify(server));
  const serverId = String(server.ID);
  cleanup.push(() => call('/v2/security/oauth2/client/server-definition', 'DELETE', { serverId }));

  await call(
    '/v2/security/oauth2/client/client-configuration',
    'PUT',
    { applicationName: name },
    {
      OAuth2ServerDefinition: serverId,
      SSLConfiguration: name,
      Enabled: false,
      Description: 'Disposable OAuth client',
      ClientType: 'confidential',
      RedirectionEndpoint: 'https://example.invalid/callback',
      DefaultScope: 'openid',
    },
  );
  cleanup.push(() =>
    call('/v2/security/oauth2/client/client-configuration', 'DELETE', { applicationName: name }),
  );

  const clients = await call('/v2/security/oauth2/client/client-configurations', 'GET', {
    serverId,
  });
  assert.ok(clients.data.some((c: any) => c.ApplicationName === name));
  console.log('PASS OAuth server and client configuration');

  await call(
    '/v2/security/oauth2/client/client-configuration/secrets',
    'POST',
    { applicationName: name },
    { ClientSecret: 'NotARealOAuthSecret' },
  );
  console.log('PASS OAuth secret update');

  const audit = await call('/v2/security/audit/records', 'POST', { maxRows: '10' });
  assert.ok(audit.asyncId);

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const result = await call('/v2/async-result', 'GET', { id: audit.asyncId! });
    if (result.data.State === 'Finished') {
      console.log('PASS asynchronous audit job');
      break;
    }
    if (i === 19) throw new Error('Audit job did not finish');
  }

  console.log('All extended live workflows passed.');
} finally {
  for (const clean of cleanup.reverse()) {
    try {
      await clean();
    } catch (error) {
      console.error('CLEANUP ERROR', (error as Error).message);
      process.exitCode = 1;
    }
  }
}
