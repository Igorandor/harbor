import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  executionDuration,
  executionOutcome,
  executionSummary,
  filterExecutions,
  normalizeExecutions,
  scheduleDescription,
  taskChanges,
  taskFindings,
  taskTimestamp,
  type TaskObservation,
} from '../shared/task-analysis.js';
import { observeTask } from '../server/task-observations.js';
import { ApiError, IrisClient } from '../server/upstream.js';

test('native wall times are not labelled UTC and invalid calendar values are rejected', () => {
  assert.equal(taskTimestamp('2026-09-27 01:02:03')?.basis, 'wall');
  assert.equal(taskTimestamp('2026-09-27T01:02:03Z')?.basis, 'offset');
  for (const value of [
    '2026-02-30 01:02:03',
    '2026-09-27 25:02:03',
    'Yesterday',
    '2026-13-01 00:00:00',
    '2026-02-30T01:02:03Z',
  ])
    assert.equal(taskTimestamp(value), undefined);
  assert.equal(taskTimestamp('2024-02-29 01:02:03')?.basis, 'wall');
});
test('duration refuses mixed timezone bases and backwards or missing completion', () => {
  assert.equal(executionDuration('2026-09-27 01:00:00', '2026-09-27 01:02:30').durationMs, 150000);
  assert.equal(
    executionDuration('2026-09-27T01:00:00+02:00', '2026-09-27T00:00:00Z').durationMs,
    3600000,
  );
  assert.equal(
    executionDuration('2026-09-27 01:00:00', '2026-09-27T01:00:00Z').durationMs,
    undefined,
  );
  assert.equal(
    executionDuration('2026-09-27 01:00:00', '2026-09-27 00:00:00').durationMs,
    undefined,
  );
  assert.equal(executionDuration('2026-09-27 01:00:00', '').durationMs, undefined);
});
test('native numeric status alone is never interpreted as successful completion', () => {
  assert.equal(
    executionOutcome({ Status: '1', Result: 'unfamiliar', Completed: 'now' }),
    'unknown',
  );
  assert.equal(
    executionOutcome({ Status: '1', Result: 'Success', Completed: 'now', ErrNumber: 55 }),
    'failure',
  );
  assert.equal(
    executionOutcome({ Result: 'Success', LastStart: 'then', Completed: '' }),
    'unfinished',
  );
  assert.equal(executionOutcome({ Result: 'Success', Completed: 'now', ErrNumber: 0 }), 'success');
  assert.equal(executionOutcome({ Result: 'Failed: task error' }), 'failure');
});
test('history summaries separate unknown outcomes and compute duration statistics from valid pairs', () => {
  const rows = normalizeExecutions([
    {
      TaskId: 1,
      LastStart: '2026-09-27 00:00:00',
      Completed: '2026-09-27 00:00:10',
      Result: 'Success',
    },
    {
      TaskId: 1,
      LastStart: '2026-09-27 00:00:00',
      Completed: '2026-09-27 00:00:30',
      Result: 'Failed',
    },
    { TaskId: 1, Result: 'unclassified' },
  ]);
  const summary = executionSummary(rows);
  assert.deepEqual(summary.counts, { success: 1, failure: 1, unknown: 1, unfinished: 0 });
  assert.equal(summary.median, 20000);
  assert.equal(summary.p95, 30000);
  assert.equal(summary.measured, 2);
  assert.equal(new Set(rows.map((row) => row.key)).size, 3);
  assert.equal(executionSummary([]).median, undefined);
});
test('history filtering uses native calendar dates and never substitutes zero for unknown duration', () => {
  const rows = normalizeExecutions([
    {
      LastStart: '2026-09-27 00:00:00',
      Completed: '2026-09-27 00:00:10',
      Result: 'Success',
      Username: 'Alice',
    },
    { LastStart: '2026-09-26 00:00:00', Result: 'Success', Username: 'Alice' },
    { Result: 'Success', Username: 'Alice' },
  ]);
  const filter = {
    search: 'alice',
    outcome: 'all' as const,
    from: '2026-09-27',
    to: '2026-09-27',
    minimumSeconds: '0',
  };
  assert.equal(filterExecutions(rows, filter).length, 1);
  assert.equal(
    filterExecutions(rows, { ...filter, from: '', to: '', minimumSeconds: '20' }).length,
    0,
  );
});
test('schedule interpretation follows native weekday and last-day encodings without predicting occurrences', () => {
  const weekly = scheduleDescription({
    TimePeriod: 'Weekly',
    TimePeriodEvery: '2',
    TimePeriodDay: '23456',
    DailyFrequency: 'Once',
    DailyStartTime: '08:00:00',
  });
  assert.equal(weekly.summary, 'Every 2 weeks');
  assert.ok(
    weekly.details.some((text) => text.includes('Monday, Tuesday, Wednesday, Thursday, Friday')),
  );
  assert.equal(weekly.cadence, 'Once at 08:00:00');
  assert.ok(
    scheduleDescription({
      TimePeriod: 'Monthly',
      TimePeriodEvery: '1',
      TimePeriodDay: '31',
    }).details.includes('Last day of the month'),
  );
  assert.ok(
    scheduleDescription({
      TimePeriod: 'Monthly Special',
      TimePeriodEvery: '1',
      TimePeriodDay: '5^7',
    }).details.includes('Last Saturday'),
  );
  assert.ok(
    scheduleDescription({ TimePeriod: 'Weekly', TimePeriodEvery: '0', TimePeriodDay: '99' })
      .warnings.length >= 2,
  );
  assert.equal(scheduleDescription({ TimePeriod: 'On Demand' }).warnings.length, 0);
});
test('task comparison retains removed fields and does not mutate its baseline', () => {
  const before = { Name: 'A', Settings: { one: true }, Removed: 'x' };
  const saved = JSON.stringify(before);
  const changes = taskChanges(before, { Name: 'A', Settings: { one: false }, Added: 3 });
  assert.deepEqual(
    changes.map((row) => row.field),
    ['Added', 'Removed', 'Settings'],
  );
  assert.equal(changes.find((row) => row.field === 'Removed')?.after, undefined);
  assert.equal(JSON.stringify(before), saved);
  assert.deepEqual(taskChanges({ Settings: { a: 1, b: 2 } }, { Settings: { b: 2, a: 1 } }), []);
});
test('task collection retains partial sources, excludes another task history and performs no writes', async () => {
  const methods: string[] = [];
  const client = new IrisClient('http://iris', async (input, options) => {
    methods.push(String(options?.method));
    const url = new URL(String(input));
    if (url.pathname.endsWith('/task/info')) return new Response('', { status: 403 });
    if (url.pathname.endsWith('/task/history')) {
      assert.equal(url.searchParams.get('taskId'), '7');
      assert.equal(url.searchParams.get('maxRows'), '50');
      return Response.json({ result: [{ TaskId: 8, Result: 'Success' }] });
    }
    return Response.json({ result: { Name: 'Seven', Password: 'must-be-redacted' } });
  });
  const value = await observeTask(client, 'Basic test', '7', 50);
  assert.equal(value.configuration.status, 'available');
  assert.equal(value.state.httpStatus, 403);
  assert.equal(value.history.status, 'unavailable');
  assert.equal(value.history.data, undefined);
  assert.ok(!JSON.stringify(value).includes('must-be-redacted'));
  assert.deepEqual(methods, ['GET', 'GET', 'GET']);
});
test('task collection validates identifiers and bounds before calling IRIS', async () => {
  const client = {
    request: () => {
      throw Error('unexpected call');
    },
  } as unknown as IrisClient;
  for (const [id, limit] of [
    ['../secret', 100],
    ['0', 100],
    ['1', 0],
    ['1', 501],
    ['1', NaN],
  ] as const)
    await assert.rejects(
      () => observeTask(client, 'Basic test', id, limit),
      (error) => error instanceof ApiError && error.status === 400,
    );
});
test('authentication loss aborts a task observation instead of creating a partial success', async () => {
  const client = {
    request: async () => {
      throw new ApiError(401, 'Native login expired.');
    },
  } as unknown as IrisClient;
  await assert.rejects(
    () => observeTask(client, 'Basic test', '1', 50),
    (error) => error instanceof ApiError && error.status === 401,
  );
});
test('report findings use authoritative suspension state and label incomplete history', () => {
  const part = { observedAt: 'now', status: 'available' as const, httpStatus: 200 };
  const report: TaskObservation = {
    taskId: '1',
    startedAt: 'now',
    finishedAt: 'now',
    historyLimit: 50,
    historyMayBeLimited: true,
    configuration: { ...part, data: { Suspended: false, TimePeriod: 'On Demand' } },
    state: { ...part, data: { Suspended: true } },
    history: { ...part, data: [] },
  };
  const findings = taskFindings(report);
  assert.ok(findings.some((row) => row.id === 'suspended' && row.source === 'state'));
  assert.ok(findings.some((row) => row.id === 'limited-history'));
});
