import { validStoredCase } from '../../shared/investigation';
import { diagnosticSources } from '../../shared/diagnostics';
export function windowRecord(unchanged = false) {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    Id: i + 1,
    Name: 'Synthetic task ' + (i + 1),
  }));
  const capture = (later) => ({
    id: later ? '22222222-2222-4222-8222-222222222222' : '11111111-1111-4111-8111-111111111111',
    title: later ? 'Later tasks' : 'Earlier tasks',
    sources: ['tasks'],
    capturedBy: 'Synthetic operator',
    bundle: {
      version: 1,
      instance: 'synthetic-instance',
      startedAt: later ? '2026-09-28T12:01:00.000Z' : '2026-09-28T12:00:00.000Z',
      finishedAt: later ? '2026-09-28T12:01:00.000Z' : '2026-09-28T12:00:00.000Z',
      limits: [
        'Lists request at most 100 rows where supported.',
        'Shared bounded input',
        'Shared bounded input',
        later ? 'Later log window' : 'Earlier <b data-qa-limit="literal">window</b>',
      ],
      sections: [
        {
          ...diagnosticSources.find((source) => source.id === 'tasks'),
          observedAt: later ? '2026-09-28T12:01:00.000Z' : '2026-09-28T12:00:00.000Z',
          elapsedMs: 1,
          status: 'collected',
          httpStatus: 200,
          data:
            later && !unchanged
              ? [{ Id: 0, Name: 'Synthetic new task' }, ...rows.slice(0, 99)]
              : rows,
          notice: later
            ? 'Later source <em data-qa-source="literal">notice</em>'
            : 'Earlier source window',
        },
      ],
    },
  });
  const record = {
    id: '99999999-9999-4999-8999-999999999999',
    version: 1,
    revision: 1,
    owner: 'Synthetic operator',
    instance: 'synthetic-instance',
    title: 'Bounded task capture',
    description: 'Synthetic capture window',
    severity: 'minor',
    status: 'resolved',
    tags: [],
    createdAt: '2026-09-28T12:00:00.000Z',
    updatedAt: '2026-09-28T12:01:00.000Z',
    notes: [],
    linkedChanges: [],
    captures: [capture(false), capture(true)],
  };
  if (!validStoredCase(record)) throw Error('Invalid synthetic case');
  return record;
}
