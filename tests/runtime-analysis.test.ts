import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capacityPoint,
  counterChange,
  compareProcesses,
  parseProcessState,
  groupLocks,
  runtimeFindings,
  defaultRuntimeThresholds,
  type RuntimeSample,
} from '../shared/runtime-analysis.js';
import { captureRuntime } from '../server/runtime-observations.js';
import { ApiError, IrisClient, type Operation } from '../server/upstream.js';
function sample(at: string, data: any): RuntimeSample {
  return {
    version: 1,
    instance: 'one',
    startedAt: at,
    finishedAt: at,
    sources: [
      {
        source: 'host',
        path: '/extension/telemetry',
        capturedAt: at,
        status: 'available',
        elapsedMs: 1,
        data,
      },
    ],
    processDetails: [],
  };
}
test('host rate rejects counter reset, impossible idle delta and changed uptime', () => {
  const a = sample('2026-09-27T00:00:00Z', {
    cpu: { totalTicks: 100, idleTicks: 50 },
    uptimeSeconds: 100,
  });
  const b = sample('2026-09-27T00:00:10Z', {
    cpu: { totalTicks: 200, idleTicks: 75 },
    uptimeSeconds: 110,
  });
  assert.equal(capacityPoint(b, a).cpuBusyPercent, 75);
  (b.sources[0].data as any).cpu.idleTicks = 200;
  assert.equal(capacityPoint(b, a).cpuBusyPercent, undefined);
  (b.sources[0].data as any).uptimeSeconds = 1;
  assert.match(capacityPoint(b, a).warnings.join(' '), /uptime/);
});
test('invalid capacity does not become zero-percent healthy', () => {
  const value = sample('2026-09-27T00:00:00Z', {
    memory: { total: 100, available: 120 },
    disk: { total: 0, free: 0 },
  });
  assert.equal(capacityPoint(value).memoryUsedPercent, undefined);
  assert.equal(capacityPoint(value).diskUsedPercent, undefined);
});
test('process states accept native appended flags and refuse unknown state', () => {
  assert.equal(parseProcessState('HANG').suspended, false);
  assert.equal(parseProcessState('SUSP').suspended, true);
  assert.equal(parseProcessState('RUNW').suspended, false);
  assert.equal(parseProcessState('HANG S').suspended, true);
  assert.equal(parseProcessState('mystery').suspended, undefined);
  assert.equal(parseProcessState('').suspended, undefined);
});
test('process rates require the same native start time and a positive interval', () => {
  const a = sample('2026-09-27T00:00:00Z', {}),
    b = sample('2026-09-27T00:00:10Z', {});
  a.processDetails = [
    {
      pid: 42,
      status: 'available',
      capturedAt: a.finishedAt,
      data: { Pid: 42, StartTimeUTC: 'native time', JobNumber: 3, CPUTime: 10 },
    },
  ];
  b.processDetails = [
    {
      pid: 42,
      status: 'available',
      capturedAt: b.finishedAt,
      data: { Pid: 42, StartTimeUTC: 'native time', JobNumber: 3, CPUTime: 110 },
    },
  ];
  assert.equal(compareProcesses(a, b)[0].counters[0].perSecond, 10);
  b.processDetails[0].data!.StartTimeUTC = 'replacement';
  assert.equal(compareProcesses(a, b)[0].identity, 'new');
  assert.deepEqual(compareProcesses(a, b)[0].counters, []);
  assert.equal(counterChange('counter', 100, 50, 10).delta, undefined);
});
test('missing detail selection does not prove process exit and remote locks are not joined locally', () => {
  const a = sample('2026-09-27T00:00:00Z', {}),
    b = sample('2026-09-27T00:00:10Z', {});
  a.processDetails = [
    {
      pid: 42,
      status: 'available',
      capturedAt: a.finishedAt,
      data: { Pid: 42, StartTimeUTC: 'native time' },
    },
  ];
  assert.match(compareProcesses(a, b)[0].notice!, /does not prove/);
  b.sources.push(
    {
      source: 'processes',
      path: '/v2/processes',
      capturedAt: b.finishedAt,
      status: 'available',
      elapsedMs: 1,
      data: [{ Pid: 42, Username: 'local' }],
    },
    {
      source: 'locks',
      path: '/v2/locks',
      capturedAt: b.finishedAt,
      status: 'available',
      elapsedMs: 1,
      data: [{ Pid: '42', RemoteOwner: true, Reference: '^remote', ModeCount: 'Exclusive' }],
    },
  );
  assert.equal(groupLocks(b)[0].process, undefined);
  assert.equal(groupLocks(b)[0].correlation, 'remote');
});
test('runtime capture uses GET only, keeps partial sources and omits variable values', async () => {
  const client = {
    request: async (_auth: string, op: Operation) => {
      assert.equal(op.method, 'GET');
      if (op.path === '/v2/locks') throw new ApiError(403, 'denied');
      return {
        status: 200,
        data:
          op.path === '/v2/process'
            ? {
                Pid: 42,
                StartTimeUTC: 'time',
                Variables: [{ Value: 'private' }],
                CSPSessionID: 'session',
              }
            : {},
      };
    },
  } as unknown as IrisClient;
  const result = await captureRuntime(client, 'auth', 'one', {
    sources: ['host', 'locks'],
    pids: [42],
  });
  assert.equal(result.sources[1].status, 'unavailable');
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(!JSON.stringify(result).includes('CSPSessionID'));
  assert.ok(
    runtimeFindings(result, defaultRuntimeThresholds).some((item) => item.source === 'locks'),
  );
});
test('runtime capture bounds selection and propagates authentication loss', async () => {
  const client = {
    request: async () => {
      throw new ApiError(401, 'session lost');
    },
  } as unknown as IrisClient;
  await assert.rejects(
    () => captureRuntime(client, 'auth', 'one', { sources: ['host', 'host'] }),
    /only once/,
  );
  await assert.rejects(
    () => captureRuntime(client, 'auth', 'one', { sources: ['host'] }),
    /session lost/,
  );
});
