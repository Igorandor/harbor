export type TaskRecord = Record<string, unknown>;
export type TaskRead<T> = {
  status: 'available' | 'unavailable' | 'pending';
  observedAt: string;
  data?: T;
  message?: string;
  httpStatus: number;
};
export type TaskObservation = {
  taskId: string;
  startedAt: string;
  finishedAt: string;
  configuration: TaskRead<TaskRecord>;
  state: TaskRead<TaskRecord>;
  history: TaskRead<TaskRecord[]>;
  historyLimit: number;
  historyMayBeLimited: boolean;
};
export type ExecutionOutcome = 'success' | 'failure' | 'unfinished' | 'unknown';
export type Execution = {
  key: string;
  sourceIndex: number;
  taskId: string;
  name: string;
  started: string;
  finished: string;
  outcome: ExecutionOutcome;
  durationMs?: number;
  durationNotice?: string;
  result: string;
  status: string;
  namespace: string;
  user: string;
  process: string;
  row: TaskRecord;
};
export type TaskFinding = {
  id: string;
  severity: 'attention' | 'information';
  title: string;
  detail: string;
  source: 'configuration' | 'state' | 'history';
};
export function taskText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** Native timestamps without an offset are kept as wall time, never labelled UTC. */
export function taskTimestamp(
  value: unknown,
): { value: number; basis: 'offset' | 'wall' } | undefined {
  if (typeof value !== 'string') return undefined;
  const offset = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (offset.test(value)) {
    if (!taskTimestamp(value.slice(0, 19))) return undefined;
    const time = Date.parse(value);
    return Number.isFinite(time) ? { value: time, basis: 'offset' } : undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59)
    return undefined;
  const time = Date.UTC(year, month - 1, day, hour, minute, second);
  const parsed = new Date(time);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  )
    return undefined;
  return { value: time, basis: 'wall' };
}
export function executionDuration(
  start: unknown,
  finish: unknown,
): { durationMs?: number; durationNotice?: string } {
  const a = taskTimestamp(start),
    b = taskTimestamp(finish);
  if (!a || !b) return { durationNotice: 'A complete start and finish time is required.' };
  if (a.basis !== b.basis) return { durationNotice: 'Timestamp timezone formats differ.' };
  if (b.value < a.value) return { durationNotice: 'Finish precedes start; duration is unknown.' };
  return {
    durationMs: b.value - a.value,
    durationNotice:
      a.basis === 'wall'
        ? 'Wall-clock difference; timezone and clock changes are not recorded.'
        : undefined,
  };
}
export function executionOutcome(row: TaskRecord): ExecutionOutcome {
  const error = finiteNumber(row.ErrNumber);
  const result = taskText(row.Result).trim();
  if (
    (error !== undefined && error !== 0) ||
    /^(?:error|failed|failure|terminated|cancelled|canceled)(?:\b|:)/i.test(result)
  )
    return 'failure';
  const finished = taskText(row.Completed).trim();
  if (!finished && taskText(row.LastStart)) return 'unfinished';
  if (finished && /^success$/i.test(result) && (error === undefined || error === 0))
    return 'success';
  return 'unknown';
}
export function normalizeExecutions(rows: TaskRecord[]): Execution[] {
  return rows.map((row, index) => ({
    key: [
      taskText(row.TaskId),
      taskText(row.LastStart),
      taskText(row.LogDatetime),
      String(index),
    ].join('|'),
    sourceIndex: index,
    taskId: taskText(row.TaskId),
    name: taskText(row.Name),
    started: taskText(row.LastStart),
    finished: taskText(row.Completed),
    outcome: executionOutcome(row),
    ...executionDuration(row.LastStart, row.Completed),
    result: taskText(row.Result),
    status: taskText(row.Status),
    namespace: taskText(row.Namespace),
    user: taskText(row.Username),
    process: taskText(row.Pid),
    row,
  }));
}
export type ExecutionFilter = {
  search: string;
  outcome: ExecutionOutcome | 'all';
  from: string;
  to: string;
  minimumSeconds: string;
};
export function filterExecutions(rows: Execution[], filter: ExecutionFilter): Execution[] {
  const needle = filter.search.trim().toLocaleLowerCase();
  const minimum = finiteNumber(filter.minimumSeconds);
  return rows.filter((row) => {
    if (filter.outcome !== 'all' && row.outcome !== filter.outcome) return false;
    if (
      needle &&
      ![row.name, row.result, row.namespace, row.user, row.process, row.status].some((value) =>
        value.toLocaleLowerCase().includes(needle),
      )
    )
      return false;
    const day = /^\d{4}-\d{2}-\d{2}/.exec(row.started)?.[0];
    if ((filter.from || filter.to) && !day) return false;
    if (filter.from && day! < filter.from) return false;
    if (filter.to && day! > filter.to) return false;
    if (
      minimum !== undefined &&
      minimum >= 0 &&
      (row.durationMs === undefined || row.durationMs < minimum * 1000)
    )
      return false;
    return true;
  });
}
export function executionSummary(rows: Execution[]) {
  const counts = { success: 0, failure: 0, unfinished: 0, unknown: 0 };
  for (const row of rows) counts[row.outcome]++;
  const durations = rows
    .flatMap((row) => (row.durationMs === undefined ? [] : [row.durationMs]))
    .sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return {
    total: rows.length,
    counts,
    measured: durations.length,
    minimum: durations[0],
    maximum: durations.at(-1),
    median: durations.length
      ? durations.length % 2
        ? durations[middle]
        : (durations[middle - 1] + durations[middle]) / 2
      : undefined,
    p95: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : undefined,
    knownOutcomeRate:
      counts.success + counts.failure
        ? counts.success / (counts.success + counts.failure)
        : undefined,
  };
}
export function formatDuration(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'Unknown';
  if (value < 1000) return '< 1 s';
  if (value < 60000) return (value / 1000).toFixed(1) + ' s';
  if (value < 3600000) return (value / 60000).toFixed(1) + ' min';
  return (value / 3600000).toFixed(1) + ' h';
}

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function positiveInteger(value: unknown, maximum: number): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && Number.isInteger(number) && number >= 1 && number <= maximum
    ? number
    : undefined;
}
function timeOfDay(value: unknown): string | undefined {
  const text = taskText(value);
  if (!/^\d{2}:\d{2}:\d{2}$/.test(text)) return undefined;
  const [hour, minute, second] = text.split(':').map(Number);
  return hour < 24 && minute < 60 && second < 60 ? text : undefined;
}
export function scheduleDescription(task: TaskRecord): {
  summary: string;
  cadence: string;
  details: string[];
  warnings: string[];
} {
  const period = taskText(task.TimePeriod);
  const every = positiveInteger(
    task.TimePeriodEvery,
    period === 'Daily' ? 7 : period === 'Weekly' ? 5 : 12,
  );
  const details: string[] = [],
    warnings: string[] = [];
  let summary = period || 'Schedule unavailable';
  if (period === 'On Demand') summary = 'On demand';
  else if (period === 'Run After') {
    const predecessor = taskText(task.RunAfterGUID);
    summary = 'After another task completes';
    if (predecessor) details.push('Predecessor GUID: ' + predecessor);
    else warnings.push('No predecessor GUID was returned.');
  } else if (['Daily', 'Weekly', 'Monthly', 'Monthly Special'].includes(period)) {
    if (!every) warnings.push('The schedule interval is missing or outside the documented range.');
    if (period === 'Daily')
      summary = every ? (every === 1 ? 'Every day' : `Every ${every} days`) : 'Daily';
    if (period === 'Weekly') {
      const encoded = taskText(task.TimePeriodDay);
      const valid = /^[1-7]+$/.test(encoded) && new Set(encoded).size === encoded.length;
      summary = every ? `Every ${every} week${every === 1 ? '' : 's'}` : 'Weekly';
      if (valid)
        details.push('Days: ' + [...encoded].map((day) => days[Number(day) - 1]).join(', '));
      else warnings.push('The selected weekdays could not be interpreted.');
    }
    if (period === 'Monthly') {
      const day = positiveInteger(task.TimePeriodDay, 31);
      summary = every ? `Every ${every} month${every === 1 ? '' : 's'}` : 'Monthly';
      if (day) details.push(day === 31 ? 'Last day of the month' : 'Day of month: ' + day);
      else warnings.push('The day of month could not be interpreted.');
    }
    if (period === 'Monthly Special') {
      const match = /^([1-5])\^([1-7])$/.exec(taskText(task.TimePeriodDay));
      summary = every ? `Every ${every} month${every === 1 ? '' : 's'}` : 'Monthly';
      if (match)
        details.push(
          ['First', 'Second', 'Third', 'Fourth', 'Last'][Number(match[1]) - 1] +
            ' ' +
            days[Number(match[2]) - 1],
        );
      else warnings.push('The week/day selection could not be interpreted.');
    }
  } else if (period) warnings.push('Unknown schedule type; inspect the native configuration.');
  let cadence = 'Not applicable';
  if (!['On Demand', 'Run After'].includes(period)) {
    const start = timeOfDay(task.DailyStartTime);
    if (task.DailyFrequency === 'Once')
      cadence = start ? 'Once at ' + start : 'Once; time unavailable';
    else if (task.DailyFrequency === 'Several') {
      const interval = positiveInteger(task.DailyIncrement, 1440);
      const unit =
        task.DailyFrequencyTime === 'Minutes'
          ? 'minute'
          : task.DailyFrequencyTime === 'Hourly'
            ? 'hour'
            : undefined;
      const end = timeOfDay(task.DailyEndTime);
      cadence =
        interval && unit
          ? `Every ${interval} ${unit}${interval === 1 ? '' : 's'}`
          : 'Repeated; interval unavailable';
      if (start && end) details.push('Daily window: ' + start + ' – ' + end);
      else warnings.push('A complete daily start/end window was not returned.');
    } else cadence = 'Daily frequency unavailable';
  }
  if (task.StartDate) details.push('Starts: ' + taskText(task.StartDate));
  if (task.EndDate) details.push('Ends: ' + taskText(task.EndDate));
  if (task.MirrorStatus) details.push('Mirror member condition: ' + taskText(task.MirrorStatus));
  return { summary, cadence, details, warnings };
}
export function taskFindings(observation: TaskObservation): TaskFinding[] {
  const findings: TaskFinding[] = [];
  const config = observation.configuration.data,
    state = observation.state.data;
  const add = (
    id: string,
    severity: TaskFinding['severity'],
    title: string,
    detail: string,
    source: TaskFinding['source'],
  ) => findings.push({ id, severity, title, detail, source });
  for (const source of ['configuration', 'state', 'history'] as const)
    if (observation[source].status !== 'available')
      add(
        'missing-' + source,
        'attention',
        'Missing ' + source,
        observation[source].message || 'This source could not be read.',
        source,
      );
  if (state?.Suspended === true)
    add(
      'suspended',
      'attention',
      'Scheduling is suspended',
      'The task info endpoint reports that future scheduling is suspended. This does not prove an existing process has stopped.',
      'state',
    );
  if (state && typeof state.Suspended !== 'boolean')
    add(
      'suspension-unknown',
      'information',
      'Suspension state unavailable',
      'No authoritative boolean was returned by the task info endpoint.',
      'state',
    );
  if (config) {
    if (config.SuspendOnError === false)
      add(
        'continue-on-error',
        'information',
        'Reschedules after task errors',
        'SuspendOnError is disabled. Review whether repeated failures should pause this task.',
        'configuration',
      );
    if (config.Expires === true)
      add(
        'expiration',
        'information',
        'Task expiration enabled',
        'Expiration can prevent a delayed occurrence from running. Inspect the configured offsets before rescheduling.',
        'configuration',
      );
    if (config.RescheduleOnStart === true)
      add(
        'startup-reschedule',
        'information',
        'Pending work is rescheduled after startup',
        'RescheduleOnStart is enabled; a missed occurrence may be replaced by the next schedule.',
        'configuration',
      );
    for (const [index, warning] of scheduleDescription(config).warnings.entries())
      add('schedule-' + index, 'attention', 'Check schedule fields', warning, 'configuration');
  }
  const executions = normalizeExecutions(observation.history.data ?? []);
  const failed = executions.filter((row) => row.outcome === 'failure');
  if (failed.length)
    add(
      'failed-executions',
      'attention',
      `${failed.length} failed execution${failed.length === 1 ? '' : 's'} in this sample`,
      'Review execution details and the original IRIS result before running again.',
      'history',
    );
  if (observation.historyMayBeLimited)
    add(
      'limited-history',
      'information',
      'History limit reached',
      'The returned sample may omit older runs. Statistics apply only to these records.',
      'history',
    );
  return findings;
}
export function taskChanges(
  before: TaskRecord,
  after: TaskRecord,
): Array<{ field: string; before: unknown; after: unknown }> {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((field) => {
    const left = before[field],
      right = after[field];
    return stableFields(left) === stableFields(right)
      ? []
      : [{ field, before: left, after: right }];
  });
}

function stableFields(value: unknown): string | undefined {
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, ordered(child)]),
      );
    return item;
  }
  return JSON.stringify(ordered(value));
}
