import { test } from 'node:test';
import assert from 'node:assert/strict';
import { investigationReport } from '../shared/investigation-report';
import { validStoredCase, type Investigation, type CaseCapture } from '../shared/investigation';
import { compareEvidence, comparisonReport } from '../shared/evidence-comparison';

const at = '2026-09-28T12:00:00.000Z';
function capture(id: string, value: boolean): CaseCapture {
  return {
    id,
    title: 'Captured data',
    capturedBy: 'operator',
    sources: ['identity'],
    bundle: {
      version: 1,
      instance: 'synthetic',
      startedAt: at,
      finishedAt: at,
      limits: [],
      sections: [
        {
          id: 'identity',
          title: 'Instance identity',
          path: '/info',
          observedAt: at,
          elapsedMs: 1,
          status: 'collected',
          httpStatus: 200,
          data: { Enabled: value, note: '<script>inert evidence</script>' },
        },
      ],
    },
  };
}
function record(): Investigation {
  const before = capture('11111111-1111-4111-8111-111111111111', false),
    after = capture('22222222-2222-4222-8222-222222222222', true);
  const differenceId = compareEvidence(before, after).sources[0].differences[0].id;
  const decision = {
    differenceId,
    disposition: 'explained' as const,
    note: 'Saved decision reason',
    at,
    author: 'operator',
  };
  const result: Investigation = {
    version: 1,
    id: '33333333-3333-4333-8333-333333333333',
    owner: 'operator',
    instance: 'synthetic',
    revision: 7,
    title: 'Service investigation',
    description: 'Read-only investigation',
    severity: 'minor',
    tags: [],
    status: 'resolved',
    createdAt: at,
    updatedAt: '2026-09-28T12:10:00.000Z',
    resolution: 'Owner confirmed normal service.',
    notes: [{ id: 'note', at, author: 'operator', kind: 'note', text: 'First line\nSecond line' }],
    linkedChanges: ['44444444-4444-4444-8444-444444444444'],
    captures: [before, after],
    checklist: [
      {
        id: 'check',
        title: 'Check service',
        instruction: 'Read the current state.',
        required: true,
        state: 'completed',
        note: 'Captured expected result.',
        updatedAt: at,
        updatedBy: 'operator',
      },
    ],
    evidenceReviews: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        comparisonVersion: 1,
        title: 'Saved evidence review',
        beforeId: before.id,
        afterId: after.id,
        createdAt: at,
        createdBy: 'operator',
        updatedAt: at,
        decisions: [decision],
        history: [{ ...decision, eventId: 'decision-event' }],
        conclusion: {
          text: 'Owner explained the change.',
          at,
          author: 'operator',
          limitsAcknowledged: true,
        },
      },
    ],
  };
  assert.equal(validStoredCase(result), true);
  return result;
}

test('investigation HTML identifies the exact saved case and revision despite repeated titles', () => {
  const first = record(),
    second = record();
  second.id = '66666666-6666-4666-8666-666666666666';
  second.owner = 'second operator';
  second.revision = 8;
  const html = investigationReport(first),
    other = investigationReport(second);
  for (const [label, value] of [
    ['Case ID', first.id],
    ['Owner', first.owner],
    ['Instance', first.instance],
    ['Revision', '7'],
    ['Current status', 'resolved'],
    ['Severity', 'minor'],
    ['Created', first.createdAt],
    ['Updated', first.updatedAt],
  ])
    assert.ok(html.includes('<dt>' + label + '</dt><dd>' + value + '</dd>'));
  assert.ok(other.includes(second.id));
  assert.ok(other.includes('<dt>Revision</dt><dd>8</dd>'));
  assert.ok(other.includes('second operator'));
  assert.ok(!other.includes(first.id));
});

test('resolved and archived cases label recorded resolution while reopened states preserve it as previous', () => {
  for (const status of ['resolved', 'archived', 'open', 'investigating', 'monitoring'] as const) {
    const saved = record();
    saved.status = status;
    const before = structuredClone(saved),
      html = investigationReport(saved);
    assert.ok(html.includes('<dt>Current status</dt><dd>' + status + '</dd>'));
    assert.ok(
      html.includes(
        '<h2>' +
          (['resolved', 'archived'].includes(status)
            ? 'Recorded resolution'
            : 'Previous resolution') +
          '</h2>',
      ),
    );
    assert.ok(html.includes('Owner confirmed normal service.'));
    assert.deepEqual(saved, before);
  }
  const missing = record();
  missing.status = 'open';
  delete missing.resolution;
  const html = investigationReport(missing);
  assert.ok(html.includes('No resolution has been recorded.'));
  assert.ok(!html.includes('<h2>Previous resolution</h2>'));
});

test('investigation export preserves every existing evidence section and escapes record text', () => {
  const saved = record();
  saved.title = '<img src=x onerror=alert(1)>';
  saved.resolution = '<script>inert resolution</script>';
  saved.owner = 'owner & reviewer';
  const before = structuredClone(saved),
    html = investigationReport(saved);
  for (const label of ['Timeline', 'Checklist', 'Evidence reviews', 'Related changes', 'Captures'])
    assert.ok(html.includes('<h2>' + label + '</h2>'));
  for (const value of [
    'First line\nSecond line',
    'Read the current state.',
    'Captured expected result.',
    'Saved decision reason',
    'Owner explained the change.',
    saved.linkedChanges[0],
    saved.captures[0].id,
    saved.captures[1].id,
  ])
    assert.ok(html.includes(value));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;script&gt;inert evidence&lt;/script&gt;'));
  assert.ok(html.includes('&lt;script&gt;inert resolution&lt;/script&gt;'));
  assert.ok(html.includes('owner &amp; reviewer'));
  assert.ok(!html.includes('<script>') && !html.includes('<img'));
  assert.deepEqual(saved, before);
});

test('comparison HTML identifies equal-titled captures and an optional saved review without changing evidence', () => {
  const saved = record(),
    comparison = compareEvidence(saved.captures[0], saved.captures[1]);
  const html = comparisonReport(comparison, saved.evidenceReviews![0]);
  assert.ok(html.includes('Earlier capture ID:</strong> ' + saved.captures[0].id));
  assert.ok(html.includes('Later capture ID:</strong> ' + saved.captures[1].id));
  assert.ok(html.includes('Saved review ID:</strong> ' + saved.evidenceReviews![0].id));
  assert.ok(html.includes('Saved decision reason'));
  assert.ok(!comparisonReport(comparison).includes('Saved review ID:'));
  const escaped = comparisonReport(
    { ...comparison, beforeId: '<script>earlier</script>', afterId: 'later & "quoted"' },
    { ...saved.evidenceReviews![0], id: '<img src=x>' },
  );
  assert.ok(escaped.includes('&lt;script&gt;earlier&lt;/script&gt;'));
  assert.ok(escaped.includes('later &amp; &quot;quoted&quot;'));
  assert.ok(escaped.includes('&lt;img src=x&gt;'));
  assert.ok(!escaped.includes('<script>') && !escaped.includes('<img'));
});

test('individual capture sections retain identity and collector even without review references', () => {
  const saved = record();
  saved.evidenceReviews = [];
  saved.captures[1].capturedBy = 'second & reviewer';
  const html = investigationReport(saved).split('<h2>Captures</h2>')[1];
  assert.ok(html.includes('Capture ID:</strong> ' + saved.captures[0].id));
  assert.ok(html.includes('Capture ID:</strong> ' + saved.captures[1].id));
  assert.ok(html.includes('Captured by:</strong> operator'));
  assert.ok(html.includes('Captured by:</strong> second &amp; reviewer'));
});
