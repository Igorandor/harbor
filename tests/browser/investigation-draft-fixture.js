import { summarizeCase, validStoredCase } from '../../shared/investigation';
const originalFetch = window.fetch.bind(window);
const id = '88888888-8888-4888-8888-888888888888';
let record,
  mode,
  calls = [];
let releasePending;
export function releaseDraftSave() {
  releasePending?.();
  releasePending = undefined;
}
export function resetDraftFixture(nextMode = 'normal') {
  mode = nextMode;
  calls = [];
  record = {
    id,
    revision: 1,
    version: 1,
    owner: 'Synthetic operator',
    instance: 'synthetic-only',
    title: 'Synthetic investigation',
    description: 'Independent form drafts',
    severity: 'minor',
    status: 'open',
    tags: [],
    createdAt: '2026-09-28T12:00:00.000Z',
    updatedAt: '2026-09-28T12:00:00.000Z',
    notes: [],
    captures: [],
    linkedChanges: [],
    checklist: [
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: 'Review backup result',
        instruction: 'Read the latest backup record.',
        required: true,
        state: 'open',
      },
    ],
  };
  if (!validStoredCase(record)) throw Error('Invalid synthetic investigation');
}
export function setDraftMode(value) {
  mode = value;
}
export function draftCalls() {
  return calls;
}
resetDraftFixture();
window.fetch = async (url, options = {}) => {
  if (!String(url).startsWith('/api/')) return originalFetch(url, options);
  const method = options.method || 'GET',
    body = options.body ? JSON.parse(options.body) : undefined;
  calls.push({ url: String(url), method, body });
  const response = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  if (method === 'GET' && url === '/api/investigations')
    return response({ records: [summarizeCase(record)], unreadable: [], total: 1 });
  if (method === 'GET' && url === '/api/investigations/' + id)
    return mode === 'denied'
      ? response({ error: 'Synthetic read refusal' }, 403)
      : response(record);
  if (method === 'POST' && String(url).startsWith('/api/investigations/' + id + '/')) {
    const requestedMode = mode;
    if (requestedMode.startsWith('hold'))
      await new Promise((resolve) => (releasePending = resolve));
    if (requestedMode === 'conflict' || requestedMode === 'hold-conflict')
      return response({ error: 'Synthetic revision conflict' }, 409);
    if (body.revision !== record.revision)
      return response({ error: 'Synthetic stale revision' }, 409);
    const action = String(url).split('/').at(-1),
      at = '2026-09-28T12:01:00.000Z';
    const entry = {
      id: crypto.randomUUID(),
      author: record.owner,
      at,
      kind:
        action === 'notes' || action === 'checklist'
          ? 'note'
          : action === 'status'
            ? 'status'
            : 'link',
      text: body.text ?? body.reason ?? body.note,
    };
    if (action === 'checklist') {
      record.checklist[0] = {
        ...record.checklist[0],
        state: body.state,
        note: body.note,
        updatedAt: at,
        updatedBy: record.owner,
      };
    } else if (action === 'status') record.status = body.status;
    else if (action === 'changes') {
      record.linkedChanges.push(body.changeId);
      entry.changeId = body.changeId;
    } else if (action !== 'notes') throw Error('Unexpected synthetic mutation');
    record.notes.push(entry);
    record.revision++;
    record.updatedAt = at;
    if (!validStoredCase(record)) throw Error('Invalid synthetic saved investigation');
    return response(record);
  }
  throw Error('Unexpected fixture request: ' + method + ' ' + url);
};
