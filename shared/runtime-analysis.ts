export type RuntimeSource =
  'identity' | 'host' | 'health' | 'processes' | 'locks' | 'usage' | 'license';
export type RuntimePart = {
  source: RuntimeSource;
  path: string;
  capturedAt: string;
  status: 'available' | 'unavailable' | 'limited';
  data?: unknown;
  notice?: string;
  elapsedMs: number;
};
export type RuntimeSample = {
  version: 1;
  instance: string;
  startedAt: string;
  finishedAt: string;
  sources: RuntimePart[];
  processDetails: ProcessObservation[];
};
export type ProcessObservation = {
  pid: number;
  status: 'available' | 'unavailable';
  capturedAt: string;
  data?: Record<string, unknown>;
  notice?: string;
};
export type ProcessIdentity = { pid: number; startedAt: string; job?: number };
export type RuntimeCounter = {
  name: string;
  before?: number;
  after?: number;
  delta?: number;
  perSecond?: number;
  notice?: string;
};
export type ProcessComparison = {
  pid: number;
  identity: 'same' | 'new' | 'missing' | 'unknown';
  user: string;
  namespace: string;
  stateBefore?: string;
  stateAfter?: string;
  counters: RuntimeCounter[];
  notice?: string;
};
export type CapacityPoint = {
  at: string;
  memoryUsedPercent?: number;
  diskUsedPercent?: number;
  loadOne?: number;
  cpuBusyPercent?: number;
  warnings: string[];
};
export type RuntimeFinding = {
  id: string;
  severity: 'warning' | 'attention' | 'information';
  title: string;
  detail: string;
  source: RuntimeSource | 'comparison';
  pid?: number;
};
export type RuntimeThresholds = {
  memoryUsed: number;
  diskUsed: number;
  loadPerCpu: number;
  processCpuMsPerSecond: number;
};
export const defaultRuntimeThresholds: RuntimeThresholds = {
  memoryUsed: 90,
  diskUsed: 90,
  loadPerCpu: 2,
  processCpuMsPerSecond: 800,
};
const bases = [
  'LOCK',
  'OPEN',
  'CLOS',
  'READ',
  'GSET',
  'GKLL',
  'GORD',
  'GQRY',
  'GDEF',
  'HANG',
  'EXAM',
  'SUSP',
  'INCR',
  'BSET',
  'BGET',
  'SLCT',
  'VSET',
  'VKLL',
  'USE',
  'WRT',
  'GET',
  'JOB',
  'BRD',
  'EVT',
  'SEM',
  'IPQ',
  'DEQ',
  'RUN',
  'ZF',
];
const flags = ['NL', 'DT', 'GW', 'NR', 'NH', 'S', 'D', 'H', 'N', 'W'];
export function parseProcessState(value: unknown): {
  base?: string;
  flags: string[];
  suspended?: boolean;
} {
  if (typeof value !== 'string' || !value.trim()) return { flags: [] };
  const text = value.trim().toUpperCase(),
    base = bases.find((item) => text.startsWith(item));
  if (!base) return { flags: [] };
  let rest = text.slice(base.length).replace(/[ ,|]/g, '');
  const matched: string[] = [];
  while (rest) {
    const flag = flags.find((item) => rest.startsWith(item));
    if (!flag) return { flags: [] };
    matched.push(flag);
    rest = rest.slice(flag.length);
  }
  return { base, flags: matched, suspended: base === 'SUSP' || matched.includes('S') };
}
export function finiteCounter(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
export function runtimeData<T = Record<string, any>>(
  sample: RuntimeSample,
  source: RuntimeSource,
): T | undefined {
  const part = sample.sources.find((item) => item.source === source);
  return part && part.status !== 'unavailable' ? (part.data as T) : undefined;
}
export function processIdentity(
  value: Record<string, unknown> | undefined,
): ProcessIdentity | undefined {
  if (
    !value ||
    !Number.isSafeInteger(value.Pid) ||
    Number(value.Pid) <= 0 ||
    typeof value.StartTimeUTC !== 'string' ||
    !value.StartTimeUTC.trim()
  )
    return undefined;
  return {
    pid: Number(value.Pid),
    startedAt: value.StartTimeUTC,
    ...(Number.isSafeInteger(value.JobNumber) ? { job: Number(value.JobNumber) } : {}),
  };
}
export function sameProcess(left: ProcessIdentity | undefined, right: ProcessIdentity | undefined) {
  return (
    !!left &&
    !!right &&
    left.pid === right.pid &&
    left.startedAt === right.startedAt &&
    left.job === right.job
  );
}
export function counterChange(
  name: string,
  before: unknown,
  after: unknown,
  seconds: number,
): RuntimeCounter {
  const left = finiteCounter(before),
    right = finiteCounter(after);
  if (left === undefined || right === undefined)
    return { name, before: left, after: right, notice: 'Counter unavailable.' };
  if (!Number.isFinite(seconds) || seconds <= 0)
    return {
      name,
      before: left,
      after: right,
      notice: 'A positive sampling interval is required.',
    };
  if (right < left)
    return {
      name,
      before: left,
      after: right,
      notice: 'Counter decreased; the source may have reset.',
    };
  const delta = right - left;
  return { name, before: left, after: right, delta, perSecond: delta / seconds };
}
export function capacityPoint(sample: RuntimeSample, previous?: RuntimeSample): CapacityPoint {
  const host = runtimeData(sample, 'host'),
    old = previous ? runtimeData(previous, 'host') : undefined;
  const point: CapacityPoint = { at: sample.finishedAt, warnings: [] };
  const total = finiteCounter(host?.memory?.total),
    available = finiteCounter(host?.memory?.available);
  if (total !== undefined && total > 0 && available !== undefined && available <= total)
    point.memoryUsedPercent = (100 * (total - available)) / total;
  else point.warnings.push('Valid host memory totals are unavailable.');
  const diskTotal = finiteCounter(host?.disk?.total),
    diskFree = finiteCounter(host?.disk?.free);
  if (diskTotal !== undefined && diskTotal > 0 && diskFree !== undefined && diskFree <= diskTotal)
    point.diskUsedPercent = (100 * (diskTotal - diskFree)) / diskTotal;
  else point.warnings.push('Valid manager-volume disk totals are unavailable.');
  point.loadOne = finiteCounter(host?.cpu?.loadAverage?.[0]);
  if (old && previous?.instance === sample.instance) {
    const beforeTotal = finiteCounter(old.cpu?.totalTicks),
      afterTotal = finiteCounter(host?.cpu?.totalTicks),
      beforeIdle = finiteCounter(old.cpu?.idleTicks),
      afterIdle = finiteCounter(host?.cpu?.idleTicks);
    const beforeUptime = finiteCounter(old.uptimeSeconds),
      afterUptime = finiteCounter(host?.uptimeSeconds);
    if (beforeUptime !== undefined && afterUptime !== undefined && afterUptime < beforeUptime)
      point.warnings.push('Host uptime decreased; CPU rate was discarded.');
    else if (
      beforeTotal !== undefined &&
      afterTotal !== undefined &&
      beforeIdle !== undefined &&
      afterIdle !== undefined
    ) {
      const totalDelta = afterTotal - beforeTotal,
        idleDelta = afterIdle - beforeIdle;
      if (totalDelta > 0 && idleDelta >= 0 && idleDelta <= totalDelta)
        point.cpuBusyPercent = 100 * (1 - idleDelta / totalDelta);
      else point.warnings.push('CPU counters did not form a valid interval.');
    }
  }
  return point;
}
export function compareProcesses(before: RuntimeSample, after: RuntimeSample): ProcessComparison[] {
  if (before.instance !== after.instance)
    throw new Error('Runtime samples belong to different instances.');
  const left = new Map(before.processDetails.map((item) => [item.pid, item])),
    right = new Map(after.processDetails.map((item) => [item.pid, item]));
  const counters = [
    'CPUTime',
    'CommandsExecuted',
    'GlobalReferences',
    'GlobalUpdates',
    'GlobalDiskReads',
    'DataBlockWrites',
    'JournalEntries',
  ];
  return [...new Set([...left.keys(), ...right.keys()])]
    .sort((a, b) => a - b)
    .map((pid) => {
      const first = left.get(pid),
        second = right.get(pid),
        a = first?.data,
        b = second?.data;
      const oldIdentity = processIdentity(a),
        newIdentity = processIdentity(b);
      const result: ProcessComparison = {
        pid,
        identity: 'unknown',
        user: String(b?.UserName ?? a?.UserName ?? ''),
        namespace: String(b?.NameSpace ?? a?.NameSpace ?? ''),
        stateBefore: typeof a?.State === 'string' ? a.State : undefined,
        stateAfter: typeof b?.State === 'string' ? b.State : undefined,
        counters: [],
      };
      if (!first) {
        result.identity = newIdentity ? 'new' : 'unknown';
        result.notice = 'No earlier detail sample was captured for this process.';
        return result;
      }
      if (!second) {
        result.identity = 'missing';
        result.notice =
          'No later detail sample was selected. This does not prove the process exited.';
        return result;
      }
      if (
        first.status !== 'available' ||
        second.status !== 'available' ||
        !oldIdentity ||
        !newIdentity
      ) {
        result.notice = 'Process identity or details were unavailable; rates cannot be calculated.';
        return result;
      }
      if (!sameProcess(oldIdentity, newIdentity)) {
        result.identity = 'new';
        result.notice =
          'This PID belongs to a different process generation; counters were not subtracted.';
        return result;
      }
      const seconds = (Date.parse(second.capturedAt) - Date.parse(first.capturedAt)) / 1000;
      result.identity = 'same';
      result.counters = counters.map((name) => counterChange(name, a?.[name], b?.[name], seconds));
      return result;
    });
}
export type LockOwnerGroup = {
  pid: string;
  references: string[];
  modes: string[];
  remote: boolean;
  process?: Record<string, unknown>;
  correlation: 'same sample PID' | 'not observed' | 'remote';
};
export function groupLocks(sample: RuntimeSample): LockOwnerGroup[] {
  const locks = runtimeData<unknown[]>(sample, 'locks'),
    processes = runtimeData<unknown[]>(sample, 'processes');
  if (!Array.isArray(locks)) return [];
  const rows = Array.isArray(processes)
    ? processes.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : [];
  const owners = new Map<string, LockOwnerGroup>();
  for (const item of locks) {
    if (!item || typeof item !== 'object') continue;
    const lock = item as Record<string, unknown>,
      pid = String(lock.Pid ?? 'unknown'),
      remote = lock.RemoteOwner === true,
      key = (remote ? 'remote:' : 'local:') + pid;
    let group = owners.get(key);
    if (!group) {
      const process = remote ? undefined : rows.find((row) => String(row.Pid) === pid);
      group = {
        pid,
        references: [],
        modes: [],
        remote,
        process,
        correlation: remote ? 'remote' : process ? 'same sample PID' : 'not observed',
      };
      owners.set(key, group);
    }
    if (typeof lock.Reference === 'string' && group.references.length < 100)
      group.references.push(lock.Reference);
    if (typeof lock.ModeCount === 'string' && !group.modes.includes(lock.ModeCount))
      group.modes.push(lock.ModeCount);
  }
  return [...owners.values()].sort(
    (a, b) => b.references.length - a.references.length || a.pid.localeCompare(b.pid),
  );
}
export function runtimeFindings(
  sample: RuntimeSample,
  thresholds: RuntimeThresholds,
  previous?: RuntimeSample,
): RuntimeFinding[] {
  const findings: RuntimeFinding[] = [],
    capacity = capacityPoint(sample, previous),
    host = runtimeData(sample, 'host'),
    health = runtimeData(sample, 'health');
  const add = (finding: RuntimeFinding) => findings.push(finding);
  for (const part of sample.sources)
    if (part.status !== 'available')
      add({
        id: 'source:' + part.source,
        severity: part.status === 'unavailable' ? 'warning' : 'information',
        title: part.source + ' data ' + part.status,
        detail: part.notice ?? 'This source is incomplete.',
        source: part.source,
      });
  if (
    capacity.memoryUsedPercent !== undefined &&
    capacity.memoryUsedPercent >= thresholds.memoryUsed
  )
    add({
      id: 'memory',
      severity: 'attention',
      title: 'Host memory exceeds the chosen threshold',
      detail: `${capacity.memoryUsedPercent.toFixed(1)}% used; threshold ${thresholds.memoryUsed}%. These are host counters, not container limits.`,
      source: 'host',
    });
  if (capacity.diskUsedPercent !== undefined && capacity.diskUsedPercent >= thresholds.diskUsed)
    add({
      id: 'disk',
      severity: 'attention',
      title: 'Manager-volume space exceeds the chosen threshold',
      detail: `${capacity.diskUsedPercent.toFixed(1)}% used; threshold ${thresholds.diskUsed}%. Check IRIS data and journal storage separately.`,
      source: 'host',
    });
  const cores = finiteCounter(host?.cpu?.logicalCount);
  if (capacity.loadOne !== undefined && cores && capacity.loadOne / cores >= thresholds.loadPerCpu)
    add({
      id: 'load',
      severity: 'attention',
      title: 'High host load relative to CPU count',
      detail: `One-minute load ${capacity.loadOne.toFixed(2)} across ${cores} logical CPUs. Load includes runnable and uninterruptible waiting processes.`,
      source: 'host',
    });
  if (
    health?.SystemMonitor &&
    typeof health.SystemMonitor === 'string' &&
    (/not|stop|disable|unknown/i.test(health.SystemMonitor) ||
      !/running|active/i.test(health.SystemMonitor))
  )
    add({
      id: 'monitor',
      severity: 'warning',
      title: 'Check system monitor freshness',
      detail: String(health.SystemMonitor),
      source: 'health',
    });
  if (previous)
    for (const process of compareProcesses(previous, sample)) {
      const cpu = process.counters.find((item) => item.name === 'CPUTime');
      if (cpu?.perSecond !== undefined && cpu.perSecond >= thresholds.processCpuMsPerSecond)
        add({
          id: 'cpu:' + process.pid,
          severity: 'attention',
          title: `Process ${process.pid} used substantial CPU during this interval`,
          detail: `${cpu.perSecond.toFixed(1)} CPU milliseconds per elapsed second. This is process CPU time, not total host utilization.`,
          source: 'comparison',
          pid: process.pid,
        });
      if (process.counters.some((item) => item.notice?.includes('decreased')))
        add({
          id: 'reset:' + process.pid,
          severity: 'information',
          title: `Process ${process.pid} has a decreased counter`,
          detail:
            'The affected rate was discarded. Inspect the raw samples before interpreting this interval.',
          source: 'comparison',
          pid: process.pid,
        });
    }
  return findings;
}
