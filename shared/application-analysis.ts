export type ConfigurationRecord = Record<string, unknown>;
export type ApplicationSource<T> = {
  status: 'available' | 'unavailable' | 'not applicable';
  observedAt: string;
  data?: T;
  httpStatus?: number;
  notice?: string;
};
export type ApplicationObservation = {
  name: string;
  startedAt: string;
  finishedAt: string;
  application: ApplicationSource<ConfigurationRecord>;
  namespace: ApplicationSource<ConfigurationRecord>;
  resource: ApplicationSource<ConfigurationRecord>;
  routes: ApplicationSource<ConfigurationRecord[]>;
  databases: Array<{
    name: string;
    uses: string[];
    source: ApplicationSource<ConfigurationRecord>;
  }>;
};
export type ApplicationFinding = {
  id: string;
  level: 'review' | 'information';
  title: string;
  detail: string;
  fields: string[];
};
export type AuthenticationMethod = {
  bit: number;
  name: string;
  kind: 'identity' | 'anonymous' | 'factor';
};
const applicationAuthentication: AuthenticationMethod[] = [
  { bit: 2, name: 'Kerberos API', kind: 'identity' },
  { bit: 5, name: 'Password', kind: 'identity' },
  { bit: 6, name: 'Unauthenticated', kind: 'anonymous' },
  { bit: 11, name: 'LDAP', kind: 'identity' },
  { bit: 13, name: 'Delegated', kind: 'identity' },
  { bit: 14, name: 'Login token', kind: 'identity' },
  { bit: 20, name: 'SMS second factor', kind: 'factor' },
  { bit: 21, name: 'Password second factor', kind: 'factor' },
];
const serviceAuthentication: AuthenticationMethod[] = [
  { bit: 0, name: 'Kerberos credential cache', kind: 'identity' },
  { bit: 1, name: 'Kerberos prompt', kind: 'identity' },
  ...applicationAuthentication.slice(0, 1),
  { bit: 3, name: 'Kerberos key table', kind: 'identity' },
  { bit: 4, name: 'Operating system', kind: 'identity' },
  ...applicationAuthentication.slice(1, 3),
  { bit: 7, name: 'Kerberos connection', kind: 'identity' },
  { bit: 8, name: 'Kerberos encryption', kind: 'identity' },
  { bit: 9, name: 'Kerberos integrity', kind: 'identity' },
  { bit: 10, name: 'System authentication', kind: 'identity' },
  ...applicationAuthentication.slice(3),
  { bit: 25, name: 'Mutual TLS', kind: 'identity' },
];
export function configurationText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
export function authenticationMethods(value: unknown, service = false) {
  const valid = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const catalogue = service ? serviceAuthentication : applicationAuthentication;
  const methods = valid
    ? catalogue.filter((method) => Math.floor(value / 2 ** method.bit) % 2 === 1)
    : [];
  const knownMask = methods.reduce((sum, method) => sum + 2 ** method.bit, 0);
  return { valid, methods, unknownMask: valid ? value - knownMask : undefined };
}
export function canonicalApplication(name: string): string {
  return name.toLocaleLowerCase().replace(/\/+$/, '') || '/';
}
export function applicationRelations(
  name: string,
  config: ConfigurationRecord,
  rows: ConfigurationRecord[],
) {
  const current = canonicalApplication(name),
    namespace = configurationText(config.NameSpace).toLocaleUpperCase();
  return rows
    .flatMap((row) => {
      const rowName = configurationText(row.Name);
      if (!rowName.startsWith('/')) return [];
      const candidate = canonicalApplication(rowName);
      if (candidate === current) return [];
      const relations: string[] = [];
      if (current.startsWith(candidate === '/' ? '/' : candidate + '/'))
        relations.push('Parent route');
      if (candidate.startsWith(current === '/' ? '/' : current + '/'))
        relations.push('Child route');
      if (
        namespace &&
        configurationText(row.Namespace ?? row.NameSpace).toLocaleUpperCase() === namespace
      )
        relations.push('Same namespace');
      return relations.length
        ? [
            {
              name: rowName,
              namespace: configurationText(row.Namespace ?? row.NameSpace),
              relations,
              enabled: typeof row.Enabled === 'boolean' ? row.Enabled : undefined,
            },
          ]
        : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function corsOrigin(value: unknown): {
  kind: 'origin' | 'wildcard' | 'invalid';
  origin?: string;
  secure?: boolean;
} {
  if (value === '*') return { kind: 'wildcard' };
  if (typeof value !== 'string' || value.length > 2000) return { kind: 'invalid' };
  try {
    const parsed = new URL(value);
    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !['', '/'].includes(parsed.pathname)
    )
      return { kind: 'invalid' };
    return { kind: 'origin', origin: parsed.origin, secure: parsed.protocol === 'https:' };
  } catch {
    return { kind: 'invalid' };
  }
}
export function applicationFindings(observation: ApplicationObservation): ApplicationFinding[] {
  const findings: ApplicationFinding[] = [];
  const add = (
    id: string,
    level: ApplicationFinding['level'],
    title: string,
    detail: string,
    fields: string[],
  ) => findings.push({ id, level, title, detail, fields });
  const app = observation.application.data;
  if (!app) {
    add(
      'unavailable',
      'review',
      'Application configuration unavailable',
      observation.application.notice || 'No application configuration was returned.',
      [],
    );
    return findings;
  }
  const authentication = authenticationMethods(app.AutheEnabled);
  if (app.Enabled === false)
    add(
      'disabled',
      'information',
      'Application disabled',
      'The native configuration disables this application. Existing sessions and external gateway routing are separate concerns.',
      ['Enabled'],
    );
  if (app.Enabled !== false && authentication.methods.some((method) => method.kind === 'anonymous'))
    add(
      'anonymous',
      'review',
      'Unauthenticated access configured',
      'Confirm that the application is intended to accept requests without a login. Its resource and application code may impose further checks.',
      ['AutheEnabled', 'Resource'],
    );
  if (!authentication.valid)
    add(
      'unknown-authentication',
      'review',
      'Authentication mask unavailable',
      'The returned value could not be interpreted; no authentication conclusion is available.',
      ['AutheEnabled'],
    );
  else if (authentication.unknownMask)
    add(
      'unknown-bits',
      'information',
      'Additional authentication flags',
      'Some flags are outside the documented application catalogue used by this version. Inspect the original value.',
      ['AutheEnabled'],
    );
  if (!configurationText(app.Resource))
    add(
      'no-resource',
      'review',
      'No entry resource',
      'No resource name is configured for the application entry point. This is not a test of checks performed by its own code.',
      ['Resource'],
    );
  if (
    observation.resource.data &&
    configurationText(observation.resource.data.PublicPermission).includes('U')
  )
    add(
      'public-resource',
      'review',
      'Entry resource has public use',
      'The referenced resource grants U publicly. Review this alongside authentication and application-level checks.',
      ['Resource', 'PublicPermission'],
    );
  const origins = Array.isArray(app.CorsAllowlist) ? app.CorsAllowlist : [];
  const evaluated = origins.map(corsOrigin);
  if (evaluated.some((origin) => origin.kind === 'wildcard'))
    add(
      'cors-wildcard',
      'review',
      'Wildcard CORS origin',
      'Review the broad origin allowance. Browser enforcement depends on the complete response headers.',
      ['CorsAllowlist'],
    );
  if (app.CorsCredentialsAllowed === true && evaluated.some((origin) => origin.kind === 'wildcard'))
    add(
      'cors-credentials',
      'review',
      'Credentials combined with a wildcard origin',
      'A literal wildcard Access-Control-Allow-Origin is incompatible with credentialed browser responses. Check the actual native CORS behavior before relying on this configuration.',
      ['CorsAllowlist', 'CorsCredentialsAllowed'],
    );
  if (evaluated.some((origin) => origin.kind === 'invalid'))
    add(
      'cors-invalid',
      'review',
      'CORS entry is not an exact HTTP(S) origin',
      'Review entries containing paths, credentials, queries or unsupported schemes.',
      ['CorsAllowlist'],
    );
  if (evaluated.some((origin) => origin.kind === 'origin' && origin.secure === false))
    add(
      'cors-http',
      'information',
      'HTTP origin in CORS allowlist',
      'Confirm that each non-TLS origin is intentional for this deployment.',
      ['CorsAllowlist'],
    );
  if (app.SessionScope === 'None')
    add(
      'cross-site-cookie',
      'review',
      'Cross-site session cookies configured',
      'Review the need for SameSite=None and the deployed Secure cookie and CSRF protections. This configuration read does not inspect response headers.',
      ['SessionScope', 'CSRFToken'],
    );
  if (app.UseCookies !== 'Never' && configurationText(app.CookiePath) === '/')
    add(
      'broad-cookie',
      'information',
      'Session cookie path covers the host',
      'A root cookie path can cover other applications on the same host. Confirm the sharing requirement.',
      ['UseCookies', 'CookiePath', 'GroupById'],
    );
  if (app.AutoCompile === true)
    add(
      'auto-compile',
      'information',
      'CSP automatic compilation enabled',
      'Review whether server-side file changes should trigger compilation in this deployment.',
      ['AutoCompile'],
    );
  if (app.WSGIDebug === true)
    add(
      'wsgi-debug',
      'review',
      'Python application debug mode enabled',
      'Disable debugging for a public deployment unless its exposure and behavior have been deliberately reviewed.',
      ['WSGIDebug'],
    );
  if (app.ServeFiles === 'Always' || app.ServeFiles === 'Always and cached')
    add(
      'static-files',
      'review',
      'Static files are served without CSP security',
      'Review the configured directory and its contents; this inspector does not read arbitrary files from the host.',
      ['ServeFiles', 'Path'],
    );
  const grants = Array.isArray(app.MatchRoles) ? app.MatchRoles : [];
  for (const [index, grant] of grants.entries()) {
    if (!grant || typeof grant !== 'object') continue;
    const rule = grant as ConfigurationRecord;
    if (Array.isArray(rule.TargetRoles) && rule.TargetRoles.includes('%All'))
      add(
        'all-grant-' + index,
        'review',
        'Application can grant %All',
        configurationText(rule.MatchRole)
          ? 'A matching role can acquire %All in the application context. Review the matching and target roles.'
          : 'The application grants %All without a matching-role condition. Review whether this is necessary.',
        ['MatchRoles'],
      );
  }
  for (const source of ['namespace', 'resource', 'routes'] as const)
    if (observation[source].status === 'unavailable')
      add(
        'missing-' + source,
        'information',
        'Related ' + source + ' data unavailable',
        observation[source].notice || 'No related data was collected.',
        [],
      );
  return findings;
}
export function serviceFindings(service: ConfigurationRecord): ApplicationFinding[] {
  const findings: ApplicationFinding[] = [];
  const methods = authenticationMethods(service.AutheEnabled, true);
  if (service.Enabled === true && methods.methods.some((method) => method.kind === 'anonymous'))
    findings.push({
      id: 'service-anonymous',
      level: 'review',
      title: 'Enabled service permits unauthenticated connections',
      detail: 'Confirm that anonymous access is appropriate for this service and network boundary.',
      fields: ['Enabled', 'AutheEnabled'],
    });
  if (!methods.valid)
    findings.push({
      id: 'service-auth-unknown',
      level: 'review',
      title: 'Authentication methods unavailable',
      detail: 'No conclusion is available from the returned authentication field.',
      fields: ['AutheEnabled'],
    });
  if (
    service.Enabled === true &&
    Array.isArray(service.ClientSystems) &&
    service.ClientSystems.length === 0
  )
    findings.push({
      id: 'service-client-scope',
      level: 'information',
      title: 'No client systems listed',
      detail:
        'Check the service-specific meaning of an empty list and the external network controls; this does not prove internet exposure.',
      fields: ['ClientSystems'],
    });
  return findings;
}
export function applicationKinds(app: ConfigurationRecord): string[] {
  const kinds: string[] = [];
  if (configurationText(app.DispatchClass)) return ['Dispatch class'];
  if (app.CSPZENEnabled === true) kinds.push('CSP / Zen');
  if (app.InbndWebServicesEnabled === true) kinds.push('Inbound web services');
  if (configurationText(app.WSGIAppName) || configurationText(app.WSGIAppLocation))
    kinds.push('Python application');
  if (app.ServeFiles && app.ServeFiles !== 'Never') kinds.push('Static files');
  return kinds.length ? kinds : ['No handler identified from configuration'];
}
