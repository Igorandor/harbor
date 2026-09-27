import type { RecordData } from '../shared/schema';
import type { ChangeRecord } from '../shared/change-record';
export type ApiResult<T = any> = { data: T; status: number; console: string[]; asyncId?: string };
let csrf = '';
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new RequestError(
      'The portal gateway returned an unreadable response. Check that the server is running and try again.',
      response.status,
    );
  }
  if (!response.ok) {
    if (response.status === 401 && path !== 'login' && path !== 'session')
      window.dispatchEvent(new Event('session-ended'));
    throw new RequestError(data.error ?? 'Request failed.', response.status);
  }
  if (data.csrf) csrf = data.csrf;
  return data;
}
export async function iris<T = any>(
  path: string,
  query: Record<string, string> = {},
  method: 'GET' | 'PUT' | 'POST' | 'DELETE' = 'GET',
  body?: RecordData,
  expected?: Record<string, unknown>,
): Promise<ApiResult<T>> {
  if (method !== 'GET' && path !== '/v2/security/audit/records') {
    const prepared = await prepareChange({ path, query, method, body }, expected);
    const change = await executeChange(prepared);
    return {
      data: change.result as T,
      status: change.nativeStatus ?? 200,
      console: [change.explanation],
    };
  }
  const result = await request<ApiResult<T>>('iris', { path, method, query, body });
  if (result.asyncId) {
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      const next = await request<ApiResult>('iris', {
        path: '/v2/async-result',
        method: 'GET',
        query: { id: result.asyncId },
      });
      if (next.data.State === 'Finished')
        return { ...next, data: next.data.Result, console: next.data.Console ?? [] };
      if (['Failed', 'Canceled', 'Paused'].includes(next.data.State))
        throw new RequestError(
          `IRIS background job ${next.data.State.toLowerCase()}: ${next.data.FailureReason ?? result.asyncId}`,
          422,
        );
    }
    throw new RequestError(
      `IRIS is still processing job ${result.asyncId}. Check the job in REST explorer before requesting it again.`,
      202,
    );
  }
  return result;
}
export async function prepareChange(
  operation: {
    path: string;
    method: 'PUT' | 'POST' | 'DELETE';
    query?: Record<string, string>;
    body?: RecordData;
  },
  expected?: Record<string, unknown>,
) {
  return request<ChangeRecord>('changes', { operation, expected });
}
export async function executeChange(prepared: ChangeRecord): Promise<ChangeRecord> {
  const change = await request<ChangeRecord>('changes/' + prepared.id + '/execute', {
    revision: prepared.revision,
    confirmation: prepared.target,
  });
  window.dispatchEvent(new CustomEvent('change-recorded', { detail: change }));
  if (!['verified', 'acknowledged'].includes(change.state))
    throw new RequestError(
      change.explanation + ' Open Change history to inspect or reconcile record ' + change.id + '.',
      409,
    );
  return change;
}
export function download(name: string, value: unknown) {
  const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], {
    type: typeof value === 'string' ? 'text/plain' : 'application/json',
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
