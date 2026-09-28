import { windowRecord } from './capture-window-fixture';
import { validStoredCase } from '../../shared/investigation';
import { compareEvidence } from '../../shared/evidence-comparison';
export function reviewDraftRecord(withReview = true) {
  const record = windowRecord();
  record.status = 'open';
  record.captures.forEach((capture, index) => {
    capture.bundle.sections[0].data = { Count: index + 1 };
  });
  record.evidenceReviews = withReview
    ? [
        {
          id: '33333333-3333-4333-8333-333333333333',
          comparisonVersion: 1,
          title: 'Synthetic exact-pair review',
          beforeId: record.captures[0].id,
          afterId: record.captures[1].id,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          createdBy: 'Synthetic analyst',
          decisions: [],
          history: [],
        },
      ]
    : [];
  if (!validStoredCase(record)) throw Error('Invalid synthetic investigation');
  return record;
}
export function savedReviewDraft(record, action, input) {
  const next = structuredClone(record),
    at = new Date(Date.parse(record.updatedAt) + 1000).toISOString();
  const review = next.evidenceReviews[0];
  if (action === 'evidence-reviews')
    next.evidenceReviews = [
      { ...reviewDraftRecord().evidenceReviews[0], ...input, createdAt: at, updatedAt: at },
    ];
  else if (action.endsWith('/decisions')) {
    const decision = { ...input, at, author: 'Synthetic analyst' };
    review.decisions = [decision];
    review.history.push({ ...decision, eventId: '44444444-4444-4444-8444-444444444444' });
  } else if (action.endsWith('/conclusion'))
    review.conclusion = {
      text: input.text,
      at,
      author: 'Synthetic analyst',
      limitsAcknowledged: true,
    };
  else if (action.endsWith('/reopen')) delete review.conclusion;
  else throw Error('Unexpected synthetic action');
  next.revision++;
  next.updatedAt = at;
  if (!validStoredCase(next)) throw Error('Invalid synthetic saved investigation');
  return next;
}
export function decidedRecord() {
  const record = reviewDraftRecord();
  const differenceId = compareEvidence(...record.captures).sources.flatMap(
    (source) => source.differences,
  )[0].id;
  return savedReviewDraft(record, 'evidence-reviews/x/decisions', {
    differenceId,
    disposition: 'expected',
    note: 'Expected synthetic counter change',
  });
}
