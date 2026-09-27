import type { RecordData } from '../shared/schema';
import type { ChangeRecord } from '../shared/change-record';
export type ApiResult<T = any> = { data: T; status: number; console: string[]; asyncId?: string };
let csrf = '';
let sessionGeneration = 0;
const sessionMessage = 'session-changed';
function openSessionChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  try {
    return new BroadcastChannel('harbor-session');
  } catch {
    // Local session handling remains available when the browser disallows channels.
    return;
  }
}
const sessionChannel = openSessionChannel();

function endSession(broadcast: boolean) {
  sessionGeneration++;
  csrf = '';
  window.dispatchEvent(new Event('session-ended'));
  if (broadcast) {
    try {
      sessionChannel?.postMessage(sessionMessage);
    } catch {
      // A failed peer notification must not turn successful sign-out into an error.
    }
  }
}
sessionChannel?.addEventListener('message', (event) => {
  if (event.data === sessionMessage) endSession(false);
});

export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function creationFailure(error: unknown, collection: 'investigations' | 'profiles'): string {
  if (
    error instanceof TypeError ||
    (error instanceof RequestError &&
      (error.status >= 500 || (error.status >= 200 && error.status < 300)))
  )
    return `Creation could not be confirmed. Check saved ${collection} before creating again; the first request may already have succeeded. Your draft is still here.`;
  return error instanceof Error ? error.message : String(error);
}
function requireGeneration(generation: number) {
  if (generation !== sessionGeneration)
    throw new RequestError('The session changed. Sign in again before continuing.', 409);
}
async function sessionRequest<T = any>(
  path: string,
  body: unknown,
  generation: number,
): Promise<T> {
  requireGeneration(generation);
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  requireGeneration(generation);
  let data: any;
  try {
    data = await response.json();
  } catch {
    requireGeneration(generation);
    if (response.status === 401 && path !== 'login') endSession(true);
    throw new RequestError(
      'The portal gateway returned an unreadable response. Check that the server is running and try again.',
      response.status,
    );
  }
  requireGeneration(generation);
  if (!response.ok) {
    if (response.status === 401 && path !== 'login') endSession(true);
    throw new RequestError(data.error ?? 'Request failed.', response.status);
  }
  if (path === 'login' || path === 'logout') endSession(true);
  if (data.csrf) csrf = data.csrf;
  return data;
}
export async function request<T = any>(path: string, body?: unknown): Promise<T> {
  return sessionRequest<T>(path, body, sessionGeneration);
}
export async function iris<T = any>(
  path: string,
  query: Record<string, string> = {},
  method: 'GET' | 'PUT' | 'POST' | 'DELETE' = 'GET',
  body?: RecordData,
  expected?: Record<string, unknown>,
): Promise<ApiResult<T>> {
  const generation = sessionGeneration;
  if (method !== 'GET' && path !== '/v2/security/audit/records') {
    const prepared = await prepareChange({ path, query, method, body }, expected);
    requireGeneration(generation);
    const change = await executeChange(prepared);
    requireGeneration(generation);
    return {
      data: change.result as T,
      status: change.nativeStatus ?? 200,
      console: [change.explanation],
    };
  }
  const result = await sessionRequest<ApiResult<T>>(
    'iris',
    { path, method, query, body },
    generation,
  );
  requireGeneration(generation);
  if (result.asyncId) {
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      const next = await sessionRequest<ApiResult>(
        'iris',
        {
          path: '/v2/async-result',
          method: 'GET',
          query: { id: result.asyncId },
        },
        generation,
      );
      requireGeneration(generation);
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
  let change: ChangeRecord;
  try {
    change = await request<ChangeRecord>('changes/' + prepared.id + '/execute', {
      revision: prepared.revision,
      confirmation: prepared.target,
    });
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof RequestError &&
        (error.status >= 500 || (error.status >= 200 && error.status < 300)))
    )
      throw new RequestError(
        'The execution response could not be confirmed. The request may have reached IRIS. ' +
          'Read record ' +
          prepared.id +
          ' in Change history before retrying or preparing another change.',
        error instanceof RequestError ? error.status : 0,
      );
    throw error;
  }
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
