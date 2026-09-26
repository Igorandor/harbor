import { ApiError, IrisClient } from './upstream.js';
import { parameters } from '../shared/schema.js';
import {
  diagnosticSources,
  type DiagnosticBundle,
  type DiagnosticId,
  type DiagnosticSection,
} from '../shared/diagnostics.js';

export async function captureDiagnostics(
  client: IrisClient,
  auth: string,
  instance: string,
  selected: DiagnosticId[],
): Promise<DiagnosticBundle> {
  if (
    !Array.isArray(selected) ||
    selected.length < 1 ||
    selected.length > 8 ||
    new Set(selected).size !== selected.length ||
    selected.some((id) => !diagnosticSources.some((source) => source.id === id))
  )
    throw new ApiError(400, 'Choose one to eight different diagnostic sources.');
  const startedAt = new Date().toISOString(),
    sections: DiagnosticSection[] = [];
  // Only two bounded native requests at once; one failing source does not erase the others.
  for (let offset = 0; offset < selected.length; offset += 2) {
    sections.push(
      ...(await Promise.all(
        selected.slice(offset, offset + 2).map(async (id) => {
          const source = diagnosticSources.find((source) => source.id === id)!;
          const start = Date.now();
          const base = () => ({
            ...source,
            observedAt: new Date().toISOString(),
            elapsedMs: Date.now() - start,
          });
          const query: Record<string, string> =
            source.id === 'messages'
              ? { source: 'messages', limit: '100' }
              : parameters(source.path, 'get').some((parameter) => parameter.name === 'maxRows')
                ? { maxRows: '100' }
                : {};
          try {
            const result = await client.request(auth, { path: source.path, method: 'GET', query });
            if (result.asyncId)
              return {
                ...base(),
                status: 'pending' as const,
                httpStatus: result.status,
                notice: 'Native processing is pending. No completed evidence was captured.',
              };
            const bytes = Buffer.byteLength(JSON.stringify(result.data), 'utf8');
            if (bytes > 200_000)
              return {
                ...base(),
                status: 'too large' as const,
                httpStatus: result.status,
                notice:
                  'Source exceeded the 200 KB report limit. Inspect it separately in the portal.',
              };
            return {
              ...base(),
              status: 'collected' as const,
              httpStatus: result.status,
              data: result.data,
            };
          } catch (error) {
            const status = error instanceof ApiError ? error.status : 500;
            return {
              ...base(),
              status: 'unavailable' as const,
              httpStatus: status,
              notice:
                status === 403
                  ? 'The connected account is not authorized to read this source.'
                  : status === 401
                    ? 'The native session could not be authenticated.'
                    : 'The source could not be collected. Inspect it separately for details.',
            };
          }
        }),
      )),
    );
  }
  return {
    version: 1,
    instance,
    startedAt,
    finishedAt: new Date().toISOString(),
    sections,
    limits: [
      'Point-in-time observations are collected separately, not as an atomic snapshot.',
      'Lists request at most 100 rows where supported. Text logs contain at most 100 lines from a bounded tail. Each source is limited to 200 KB.',
      'Native monitor data may be stale; inspect SystemMonitor. Task-list suspension flags may lag. Host metrics are not container quotas.',
      'Unavailable or omitted evidence is not a healthy result. Structured credentials are masked; free text may still contain sensitive operational information.',
    ],
  };
}
