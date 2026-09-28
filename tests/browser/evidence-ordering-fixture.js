import { diagnosticSources } from '../../shared/diagnostics';

export function orderingCase() {
  const capture = (id, title, hour, count) => ({
    id,
    title,
    sources: ['health'],
    capturedBy: 'operator',
    bundle: {
      version: 1,
      instance: 'review-fixture',
      startedAt: `2026-09-28T${hour}:00:00Z`,
      finishedAt: `2026-09-28T${hour}:00:01Z`,
      limits: [],
      sections: [
        {
          ...diagnosticSources.find((source) => source.id === 'health'),
          observedAt: `2026-09-28T${hour}:00:00Z`,
          elapsedMs: 2,
          status: 'collected',
          httpStatus: 200,
          data: { count },
        },
      ],
    },
  });
  return {
    id: 'ordering-case',
    title: 'Review observed counter change',
    status: 'open',
    description: 'Compare two saved observations.',
    severity: 'information',
    tags: [],
    captures: [
      capture('same-time', 'Concurrent observation', '10', 25),
      capture('older', 'First observation', '09', 10),
      capture('newer', 'Follow-up observation', '10', 20),
    ],
    notes: [],
    linkedChanges: [],
    evidenceReviews: [
      {
        id: 'reverse-review',
        version: 1,
        title: 'Reverse pair review',
        beforeId: 'newer',
        afterId: 'older',
        createdBy: 'operator',
        createdAt: '2026-09-28T11:00:00Z',
        decisions: [],
        history: [],
      },
    ],
  };
}
