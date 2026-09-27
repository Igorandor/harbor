import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applicationFindings,
  applicationKinds,
  applicationRelations,
  authenticationMethods,
  corsOrigin,
  serviceFindings,
  type ApplicationObservation,
} from '../shared/application-analysis.js';
import { observeApplication } from '../server/application-observations.js';
import { ApiError, IrisClient } from '../server/upstream.js';

function observation(data: Record<string, unknown>): ApplicationObservation {
  const part = { status: 'not applicable' as const, observedAt: 'now' };
  return {
    name: '/app',
    startedAt: 'now',
    finishedAt: 'now',
    application: { status: 'available', observedAt: 'now', data },
    namespace: part,
    resource: part,
    routes: part,
    databases: [],
  };
}
test('a default WSGI callable is not an installed Python handler and dispatch takes precedence', () => {
  assert.deepEqual(applicationKinds({ WSGICallable: 'app' }), [
    'No handler identified from configuration',
  ]);
  assert.deepEqual(
    applicationKinds({
      DispatchClass: 'Example.Rest',
      CSPZENEnabled: true,
      WSGICallable: 'app',
      ServeFiles: 'Always',
    }),
    ['Dispatch class'],
  );
  assert.deepEqual(applicationKinds({ WSGIAppName: 'service' }), ['Python application']);
});
test('authentication flags distinguish anonymous access, factors and unknown bits without integer truncation', () => {
  const parsed = authenticationMethods(32 + 64 + 2 ** 21 + 2 ** 40);
  assert.deepEqual(
    parsed.methods.map((method) => method.kind),
    ['identity', 'anonymous', 'factor'],
  );
  assert.equal(parsed.unknownMask, 2 ** 40);
  assert.equal(authenticationMethods('32').valid, false);
  assert.equal(authenticationMethods(-1).valid, false);
  assert.equal(authenticationMethods(2 ** 25, true).methods[0].name, 'Mutual TLS');
  assert.equal(authenticationMethods(2 ** 25).unknownMask, 2 ** 25);
});
test('CORS origins reject credentials, paths and non-network schemes without fetching them', () => {
  assert.equal(corsOrigin('*').kind, 'wildcard');
  assert.deepEqual(corsOrigin('https://example.invalid/'), {
    kind: 'origin',
    origin: 'https://example.invalid',
    secure: true,
  });
  for (const value of [
    'https://user:pass@example.invalid',
    'https://example.invalid/path',
    'https://example.invalid?x=1',
    'javascript:alert(1)',
    'null',
    {},
    'https://example.invalid/#x',
  ])
    assert.equal(corsOrigin(value).kind, 'invalid');
});
test('route relationships use path boundaries and do not infer proxy routing', () => {
  const related = applicationRelations('/API/A/', { NameSpace: 'USER' }, [
    { Name: '/api/a', Namespace: 'USER' },
    { Name: '/api', Namespace: '%SYS' },
    { Name: '/api/a/child', Namespace: 'OTHER' },
    { Name: '/api/ab', Namespace: 'OTHER' },
    { Name: '/unrelated', Namespace: 'user' },
  ]);
  assert.deepEqual(
    related.map((row) => row.name),
    ['/api', '/api/a/child', '/unrelated'],
  );
  assert.deepEqual(related.find((row) => row.name === '/api/a/child')?.relations, ['Child route']);
});
test('configuration review combines entry resources, CORS and application role grants but does not certify access', () => {
  const value = observation({
    Enabled: true,
    AutheEnabled: 96,
    Resource: 'Entry',
    CorsAllowlist: ['*'],
    CorsCredentialsAllowed: true,
    MatchRoles: [{ MatchRole: '', TargetRoles: ['%All'] }],
    WSGIDebug: true,
  });
  value.resource = { status: 'available', observedAt: 'now', data: { PublicPermission: 'RU' } };
  const ids = applicationFindings(value).map((finding) => finding.id);
  for (const id of [
    'anonymous',
    'public-resource',
    'cors-wildcard',
    'cors-credentials',
    'all-grant-0',
    'wsgi-debug',
  ])
    assert.ok(ids.includes(id));
  assert.ok(!ids.includes('no-resource'));
  assert.ok(
    !applicationFindings(observation({ Enabled: false, AutheEnabled: 64 })).some(
      (finding) => finding.id === 'anonymous',
    ),
  );
});
test('service review does not label empty client lists as confirmed public exposure', () => {
  const findings = serviceFindings({ Enabled: true, AutheEnabled: 64, ClientSystems: [] });
  assert.ok(findings.some((finding) => finding.id === 'service-anonymous'));
  assert.equal(
    findings.find((finding) => finding.id === 'service-client-scope')?.level,
    'information',
  );
  assert.ok(
    !serviceFindings({ Enabled: false, AutheEnabled: 64 }).some(
      (finding) => finding.id === 'service-anonymous',
    ),
  );
});
test('application inspection joins only fixed native endpoints and deduplicates default databases', async () => {
  const calls: Array<{ path: string; name: string | null }> = [];
  const client = new IrisClient('http://iris', async (input, options) => {
    assert.equal(options?.method, 'GET');
    const url = new URL(String(input));
    calls.push({ path: url.pathname, name: url.searchParams.get('name') });
    const data = url.pathname.endsWith('/web-app')
      ? { NameSpace: 'USER', Resource: 'Entry', AutheEnabled: 32 }
      : url.pathname.endsWith('/namespace')
        ? { Globals: 'USER', Routines: 'USER' }
        : url.pathname.endsWith('/web-apps')
          ? []
          : { Description: 'related' };
    return Response.json({ result: data });
  });
  const value = await observeApplication(client, 'Basic test', '/app');
  assert.equal(value.databases.length, 1);
  assert.deepEqual(value.databases[0].uses, ['Globals', 'Routines']);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.path.startsWith('/api/admin/v2/')));
  assert.equal(value.application.status, 'available');
});
test('missing or forbidden dependencies remain partial and failed primary read does not query dependencies', async () => {
  let calls = 0;
  const denied = new IrisClient('http://iris', async () => {
    calls++;
    return new Response('', { status: 403 });
  });
  const result = await observeApplication(denied, 'Basic test', '/app');
  assert.equal(calls, 1);
  assert.equal(result.application.status, 'unavailable');
  assert.equal(result.namespace.status, 'not applicable');
  const partial = new IrisClient('http://iris', async (input) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname.endsWith('/web-app'))
      return Response.json({ result: { NameSpace: 'USER', Resource: 'Entry' } });
    if (pathname.endsWith('/web-apps')) return Response.json({ result: [] });
    return new Response('', { status: 403 });
  });
  const capture = await observeApplication(partial, 'Basic test', '/app');
  assert.equal(capture.application.status, 'available');
  assert.equal(capture.namespace.status, 'unavailable');
  assert.equal(capture.resource.status, 'unavailable');
});
test('application inspection aborts on lost native authentication and rejects invalid names before transport', async () => {
  const client = {
    request: async () => {
      throw new ApiError(401, 'Expired');
    },
  } as unknown as IrisClient;
  await assert.rejects(
    () => observeApplication(client, 'Basic test', '/app'),
    (error) => error instanceof ApiError && error.status === 401,
  );
  await assert.rejects(
    () => observeApplication(client, 'Basic test', 'https://outside.invalid'),
    (error) => error instanceof ApiError && error.status === 400,
  );
});
