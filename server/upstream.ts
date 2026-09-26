import { boundedJson } from './json-limits.js';
import { credentialValues, redact } from '../shared/redaction.js';

import { spec, parameters, type RecordData } from '../shared/schema.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export type Operation = {
  path: string;
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  query?: Record<string, string>;
  body?: RecordData;
};

const editable = new Set([
  '/v2/web-app',
  '/v2/security/user',
  '/v2/security/user/password',
  '/v2/security/role',
  '/v2/security/resource',

  '/v2/security/ssl-configuration',
  '/v2/security/x509-credential',
  '/v2/security/oauth2/client/server-definition',

  '/v2/security/oauth2/client/client-configuration',
  '/v2/security/oauth2/client/client-configuration/secrets',

  '/v2/security/oauth2/resource-server',
  '/v2/security/service',
  '/v2/wallet/collection',
  '/v2/wallet/secret',

  '/v2/task',
  '/v2/task/run',
  '/v2/task/suspend',
  '/v2/task/resume',
  '/v2/process/suspend',
  '/v2/process/resume',

  '/v2/process/terminate',
  '/v2/device',
  '/v2/security/audit/enabled',
  '/v2/security/audit/records',
]);

export function validateOperation(op: Operation) {
  if (!boundedJson(op.body, 32, 20000))
    throw new ApiError(400, 'The request body is too deeply nested or complex.');
  const method = op.method.toLowerCase();

  if (op.path === '/extension/telemetry' || op.path === '/extension/logs') {
    if (
      method !== 'get' ||
      Object.keys(op.query ?? {}).some((k) => !['source', 'limit'].includes(k))
    )
      throw new ApiError(400, 'Invalid extension request.');

    return;
  }

  if (!spec.paths[op.path]?.[method])
    throw new ApiError(400, 'This operation is not in the IRIS API specification.');

  if (op.method !== 'GET' && !editable.has(op.path))
    throw new ApiError(403, 'This operation is not enabled in this portal.');

  if (/^\/(login|logout|refresh|revoke)$/.test(op.path))
    throw new ApiError(403, 'Use the portal session endpoints.');

  if (
    op.method === 'GET' &&
    /\/(secrets|secret|password|initial-access-token|search-password)$/.test(op.path) &&
    op.path !== '/v2/wallet/secrets'
  )
    throw new ApiError(403, 'Secret values cannot be retrieved through this portal.');

  const params = parameters(op.path, method);

  for (const key of Object.keys(op.query ?? {}))
    if (!params.some((p) => p.name === key))
      throw new ApiError(400, `Unknown query parameter: ${key}`);

  for (const p of params)
    if (p.required && !op.query?.[p.name]) throw new ApiError(400, `Required parameter: ${p.name}`);

  if (
    op.query?.maxRows &&
    (!/^\d+$/.test(op.query.maxRows) ||
      Number(op.query.maxRows) > 1000 ||
      Number(op.query.maxRows) < 1)
  )
    throw new ApiError(400, 'maxRows must be between 1 and 1000.');
}

export { redact } from '../shared/redaction.js';

export function irisError(data: any): string | undefined {
  data = redact(data);
  const errors = data?.status?.errors ?? data?.status?.Errors;

  if (Array.isArray(errors) && errors.length)
    return errors
      .map((e) =>
        typeof e === 'string' ? e : (e.message ?? e.error ?? e.text ?? JSON.stringify(e)),
      )
      .join('; ');

  if (data?.error) return typeof data.error === 'string' ? data.error : JSON.stringify(data.error);

  if (data?.status?.summary && !/^(OK|Success)$/i.test(data.status.summary))
    return String(data.status.summary);
}

export class IrisClient {
  private active = 0;
  private readonly accountActive = new Map<string, number>();
  constructor(
    private baseUrl: string,
    private fetcher: typeof fetch = fetch,
  ) {}

  async request(auth: string, op: Operation) {
    validateOperation(op);
    const accountCount = this.accountActive.get(auth) ?? 0;
    if (this.active >= 16 || accountCount >= 8)
      throw new ApiError(
        429,
        'Too many concurrent IRIS requests. Wait for current requests to finish.',
      );
    this.active++;
    this.accountActive.set(auth, accountCount + 1);
    try {
      return await this.executeRequest(auth, op);
    } finally {
      this.active--;
      const remaining = (this.accountActive.get(auth) ?? 1) - 1;
      if (remaining) this.accountActive.set(auth, remaining);
      else this.accountActive.delete(auth);
    }
  }

  private async executeRequest(auth: string, op: Operation) {
    const extension = op.path.startsWith('/extension/');

    const url = new URL(
      extension ? '/api/harbor/' + op.path.slice(11) : '/api/admin' + op.path,
      this.baseUrl,
    );

    for (const [k, v] of Object.entries(op.query ?? {})) url.searchParams.set(k, v);

    // The published schema uses OAuth2ServerDefinition; IRIS 2026.2/2026.3 wire format uses ServerDefinition.

    const body = op.body ? { ...op.body } : undefined;

    if (
      op.path === '/v2/security/oauth2/client/client-configuration' &&
      body?.OAuth2ServerDefinition !== undefined
    ) {
      body.ServerDefinition = body.OAuth2ServerDefinition;
      delete body.OAuth2ServerDefinition;
    }

    let response: Response;

    try {
      response = await this.fetcher(url, {
        method: op.method,
        headers: {
          Authorization: auth,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Accept-Language': 'en',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new ApiError(
        502,
        'The connection to IRIS failed or exceeded the 20-second timeout. Check the configured server and network. A write may have completed; refresh before trying again.',
      );
    }

    // Limit bytes as they arrive, before allocating an unbounded response string.
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 8_000_000) {
            await reader.cancel();
            throw new ApiError(502, 'IRIS returned too much data. Narrow the filter.');
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          502,
          'The IRIS response was interrupted. Refresh before retrying a write.',
        );
      } finally {
        reader.releaseLock();
      }
    }

    let data: any;

    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(
        response.status === 401 ? 401 : 502,
        response.status === 401
          ? 'IRIS rejected these credentials.'
          : 'IRIS returned a non-JSON response. Check the API version and web application configuration.',
      );
    }

    if (!boundedJson(data, 64, 200000))
      throw new ApiError(502, 'IRIS returned data that is too deeply nested or complex.');

    const secrets = credentialValues(op.body);
    if (auth.startsWith('Basic ')) {
      const credentials = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const separator = credentials.indexOf(':');
      if (separator >= 0) secrets.push(credentials.slice(separator + 1));
      secrets.push(auth, auth.slice(6));
    }
    // Diagnostics sometimes serialize a submitted value inside another JSON string or URL.
    const representations = secrets.flatMap((secret) => [
      secret,
      JSON.stringify(secret).slice(1, -1),
      encodeURIComponent(Buffer.from(secret, 'utf8').toString('utf8')),
      new URLSearchParams({ value: secret }).toString().slice(6),
    ]);
    const diagnosticSecrets = [...new Set(representations)].sort((a, b) => b.length - a.length);
    // Preserve structured identities and configuration values: a password may equal a
    // username or resource name. Free-text diagnostic filtering must never change ownership.
    data = redact(data);
    const problem = irisError(redact(data, diagnosticSecrets));

    if (!response.ok || problem)
      throw new ApiError(
        response.ok ? 422 : response.status,
        problem ??
          {
            401: 'IRIS session was rejected. Sign in again.',
            403: 'Your IRIS account does not have the required privilege.',
            404: 'This endpoint or object is not available on this IRIS instance.',
          }[response.status] ??
          `IRIS returned HTTP ${response.status}.`,
      );

    if (
      op.path === '/v2/security/oauth2/client/client-configuration' &&
      data.result?.ServerDefinition !== undefined
    ) {
      data.result.OAuth2ServerDefinition = data.result.ServerDefinition;
      delete data.result.ServerDefinition;
    }

    const location = response.headers.get('location');

    return {
      data:
        op.path === '/extension/logs'
          ? redact(data.result ?? data, diagnosticSecrets)
          : (data.result ?? data),
      console: redact(data.console ?? [], diagnosticSecrets),
      status: response.status,

      asyncId:
        response.status === 202 && location
          ? new URL(location, this.baseUrl).searchParams.get('id')
          : undefined,
    };
  }
}
