import { ApiError, IrisClient, type Operation } from './upstream.js';
import {
  roleNames,
  resourceNames,
  type ChangeImpact,
  type ImpactItem,
  type ImpactSource,
} from '../shared/change-impact.js';
import { parameters } from '../shared/schema.js';

/** Advisory dependency inspection; native IRIS permissions and mutation validation remain authoritative. */
export async function assessChangeImpact(
  client: IrisClient,
  auth: string,
  operation: Operation,
  baseline: any,
): Promise<ChangeImpact> {
  const started = Date.now();
  const body =
    operation.path === '/v2/security/user' && operation.method === 'POST'
      ? (operation.body?.User ?? {})
      : (operation.body ?? {});
  const fields = Object.keys(body),
    target = String(operation.query?.name ?? operation.query?.id ?? operation.body?.Name ?? '');
  const impact: ChangeImpact = {
    level: 'low',
    summary: 'This changes descriptive metadata.',
    consequences: [],
    related: [],
    sources: [],
    incomplete: false,
    assessedAt: new Date().toISOString(),
  };
  const seen = new Set<string>();
  const add = (kind: ImpactItem['kind'], name: unknown, relationship: string) => {
    if (typeof name !== 'string' || !name || name.length > 512) return;
    const key = kind + '\0' + name + '\0' + relationship;
    if (seen.has(key)) return;
    seen.add(key);
    if (impact.related.length >= 200) {
      impact.incomplete = true;
      return;
    }
    impact.related.push({ kind, name, relationship });
  };
  async function list(path: string) {
    const source: ImpactSource = { path, status: 'read', count: 0 };
    impact.sources.push(source);
    try {
      const query = parameters(path, 'get').some((parameter) => parameter.name === 'maxRows')
        ? { maxRows: '201' }
        : undefined;
      const result = await client.request(auth, { path, method: 'GET', query });
      if (!Array.isArray(result.data)) throw new Error('Source did not return a list.');
      source.count = Math.min(result.data.length, 200);
      if (result.data.length > 200) {
        source.status = 'limited';
        source.notice = 'Only the first 200 returned records were inspected.';
        impact.incomplete = true;
      }
      return result.data.slice(0, 200) as any[];
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      source.status = 'unavailable';
      source.notice =
        error instanceof ApiError && error.status === 403
          ? 'Current account cannot read this dependency source.'
          : 'Dependency source could not be read.';
      impact.incomplete = true;
      return [];
    }
  }
  async function detail(path: string, name: string) {
    if (Date.now() - started > 8000) {
      impact.incomplete = true;
      return undefined;
    }
    try {
      return (await client.request(auth, { path, method: 'GET', query: { name } })).data;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      impact.incomplete = true;
      return undefined;
    }
  }
  if (operation.method === 'DELETE') {
    impact.level = 'high';
    impact.summary = 'The selected record will be removed.';
    impact.consequences.push(
      'Deletion may leave references in other configuration or application code. Harbor cannot recreate credentials or data from this review.',
    );
  }
  if (operation.path.startsWith('/v2/process/')) {
    impact.level = 'high';
    impact.summary = operation.path.endsWith('/terminate')
      ? 'This can irreversibly interrupt a running process.'
      : 'This changes a running process’s execution state.';
    impact.consequences.push(
      'Open transactions, locks and connected clients may be affected. Process identity and capability are checked again immediately before dispatch.',
    );
    if (baseline?.InTransaction)
      impact.consequences.push('The inspected process reported an active transaction.');
    if (baseline?.UserName)
      add('user', baseline.UserName, 'Process owner in the inspected native record');
    return impact;
  }
  if (operation.path.startsWith('/v2/task')) {
    impact.level = 'moderate';
    impact.summary = 'This changes scheduled work or requests an execution.';
    if (operation.path.endsWith('/run')) {
      impact.level = 'high';
      impact.consequences.push(
        'Run-now can execute application code and modify data. An accepted request does not prove a successful task run.',
      );
    }
    if (operation.path.endsWith('/suspend'))
      impact.consequences.push(
        'Suspension affects future scheduling; a task already running is not terminated.',
      );
    if (operation.path.endsWith('/resume'))
      impact.consequences.push('Resuming scheduling may allow the next eligible execution.');
    if (
      fields.some((field) =>
        [
          'TimePeriod',
          'TimePeriodEvery',
          'StartDate',
          'DailyStartTime',
          'NameSpace',
          'TaskClass',
          'RunAsUser',
        ].includes(field),
      )
    )
      impact.consequences.push(
        'Schedule or execution-context changes can alter when and under whose permissions task code runs.',
      );
    if (baseline?.RunAsUser) add('user', baseline.RunAsUser, 'Configured task execution account');
    return impact;
  }
  if (operation.path === '/v2/security/user') {
    if (
      fields.some((field) => ['Enabled', 'Roles', 'EscalationRoles'].includes(field)) ||
      operation.method === 'DELETE'
    ) {
      impact.level = 'high';
      impact.summary = 'This changes an account’s configured access.';
      impact.consequences.push(
        'Existing sessions and application-specific authorization may behave differently from the updated account configuration. Verify access through a separate session when required.',
      );
      for (const role of [...roleNames(baseline?.Roles), ...roleNames(body.Roles)])
        add('role', role, 'Role assignment before or after this change');
    }
  }
  if (operation.path === '/v2/security/role') {
    if (
      fields.some((field) => ['Resources', 'GrantedRoles', 'EscalationOnly'].includes(field)) ||
      operation.method === 'DELETE'
    ) {
      impact.level = 'high';
      impact.summary = 'This can change access for accounts and roles using this role.';
      const users = await list('/v2/security/users'),
        roles = await list('/v2/security/roles');
      let inspected = 0;
      for (const row of users) {
        if (inspected++ >= 40) {
          impact.incomplete = true;
          impact.consequences.push(
            'Account-detail analysis stops after 40 accounts. Additional assignments may exist.',
          );
          break;
        }
        if (typeof row.Name !== 'string') continue;
        const user = await detail('/v2/security/user', row.Name);
        if (roleNames(user?.Roles).includes(target))
          add('user', row.Name, 'Direct role assignment');
        if (roleNames(user?.EscalationRoles).includes(target))
          add('user', row.Name, 'Conditional escalation assignment');
      }
      inspected = 0;
      for (const row of roles) {
        if (inspected++ >= 40) {
          impact.incomplete = true;
          break;
        }
        if (typeof row.Name !== 'string' || row.Name === target) continue;
        const role = await detail('/v2/security/role', row.Name);
        if (roleNames(role?.GrantedRoles).includes(target))
          add('role', row.Name, 'Directly inherits the selected role');
      }
      impact.consequences.push(
        'This review reports direct references only. Nested inheritance, escalation, application roles and active sessions can extend the effect.',
      );
    }
  }
  if (operation.path === '/v2/security/resource') {
    if (Object.hasOwn(body, 'PublicPermission') || operation.method === 'DELETE') {
      impact.level = 'high';
      impact.summary = 'This changes a security resource or its public permissions.';
      const apps = await list('/v2/web-apps');
      let inspected = 0;
      for (const row of apps) {
        if (inspected++ >= 40) {
          impact.incomplete = true;
          break;
        }
        if (typeof row.Name !== 'string') continue;
        const app = await detail('/v2/web-app', row.Name);
        if (resourceNames(app?.Resource).includes(target))
          add('application', row.Name, 'Application entry resource');
      }
      impact.consequences.push(
        'Application code, SQL policies and resource grants may reference this resource without appearing in the inspected application entry settings.',
      );
    }
  }
  if (operation.path === '/v2/web-app') {
    if (
      fields.some((field) =>
        [
          'Enabled',
          'AutheEnabled',
          'Resource',
          'NameSpace',
          'DispatchClass',
          'Roles',
          'MatchRoles',
          'CSPZENEnabled',
        ].includes(field),
      ) ||
      operation.method === 'DELETE'
    ) {
      impact.level = 'high';
      impact.summary = 'This can alter route availability, authentication or execution context.';
      impact.consequences.push(
        'Clients may lose access or receive different permissions. Existing sessions may remain active after disabling a route.',
      );
      for (const name of [...resourceNames(baseline?.Resource), ...resourceNames(body.Resource)])
        add('resource', name, 'Entry resource before or after this change');
    }
  }
  if (/wallet|ssl-configuration|x509-credential|oauth2|\/password$/.test(operation.path)) {
    impact.level = 'high';
    impact.summary = 'This changes authentication, transport security or credential configuration.';
    impact.consequences.push(
      'Clients relying on this configuration may need coordinated updates. Stored secret values are not available for rollback or equality verification.',
    );
  }
  if (operation.path === '/v2/security/audit/enabled') {
    impact.level = 'high';
    impact.summary = 'This changes native security auditing.';
    impact.consequences.push(
      'Disabling auditing can remove future security records. Existing audit records are not erased by this setting.',
    );
  }
  if (impact.incomplete)
    impact.consequences.push(
      'Dependency analysis is incomplete. Missing references are not evidence that nothing depends on this target.',
    );
  return impact;
}
