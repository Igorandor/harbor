import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LogService } from '../server/log-service.js';
import { IrisClient, type Operation } from '../server/upstream.js';
import { filterLogLines } from '../shared/log-window.js';
function fixture() {
  let calls = 0;
  const client = {
    request: async (_auth: string, op: Operation) => {
      calls++;
      return {
        status: 200,
        data: {
          file: op.query?.file ?? 'messages.log',
          identity: 'a'.repeat(64),
          snapshotBytes: 1000,
          currentBytes: 1100,
          start: 500,
          end: Number(op.query?.offset ?? 1000),
          scannedBytes: 500,
          lines: [{ offset: 500, text: 'warning task delayed', clipped: false }],
          olderOffset: 500,
          notice: 'Current page',
        },
      };
    },
  } as unknown as IrisClient;
  return {
    client,
    get calls() {
      return calls;
    },
  };
}
test('log cursor is signed, account-scoped and carries a fixed file boundary', async () => {
  const f = fixture(),
    service = new LogService(f.client);
  const page = await service.page('auth', 'alice', { file: 'messages.log' });
  assert.ok(page.olderCursor);
  const older = await service.page('auth', 'alice', { cursor: page.olderCursor });
  assert.equal(older.end, 500);
  await assert.rejects(
    () => service.page('auth', 'bob', { cursor: page.olderCursor }),
    /another account/,
  );
  await assert.rejects(
    () => service.page('auth', 'alice', { cursor: page.olderCursor + 'x' }),
    /invalid/,
  );
  assert.equal(f.calls, 2);
});
test('log cursors expire and do not survive restart', async () => {
  const f = fixture();
  let now = 100;
  const service = new LogService(f.client, () => now),
    page = await service.page('auth', 'alice', {});
  now += 31 * 60_000;
  await assert.rejects(
    () => service.page('auth', 'alice', { cursor: page.olderCursor }),
    /expired/,
  );
  await assert.rejects(
    () => new LogService(f.client).page('auth', 'alice', { cursor: page.olderCursor }),
    /restarted/,
  );
});
test('log filenames, line bounds and ambiguous cursor requests fail before transport', async () => {
  const f = fixture(),
    service = new LogService(f.client);
  for (const file of ['../messages.log', 'messages.log.gz', '/etc/passwd', 'messages.log.backup'])
    await assert.rejects(() => service.page('auth', 'alice', { file }), /supported log/);
  await assert.rejects(() => service.page('auth', 'alice', { limit: 501 }), /1–500/);
  await assert.rejects(
    () => service.page('auth', 'alice', { file: 'messages.log', cursor: 'fake' }),
    /not both/,
  );
  assert.equal(f.calls, 0);
});
test('page filtering combines words and level without interpreting regex', () => {
  const lines = [
    { offset: 0, text: 'error task [x]', clipped: false },
    { offset: 14, text: 'warning task late', clipped: false },
  ];
  assert.deepEqual(filterLogLines(lines, 'task [x]', 'all'), [lines[0]]);
  assert.deepEqual(filterLogLines(lines, 'task', 'warning'), [lines[1]]);
});

test('native message rotations remain selectable through catalog and signed older-page cursors', async () => {
  const file = 'messages.old_2026-09-28_10-23-04';
  const f = fixture();
  const request = f.client.request.bind(f.client);
  f.client.request = async (auth, op) =>
    op.path === '/extension/log-catalog'
      ? {
          status: 200,
          console: undefined,
          asyncId: undefined,
          data: {
            files: [{ id: file, source: 'messages', bytes: 1000, modifiedAt: 1, active: false }],
            limited: false,
            notice: 'Supported log files',
          },
        }
      : request(auth, op);
  const service = new LogService(f.client);
  const catalog = await service.catalog('auth');
  assert.equal(catalog.files[0].id, file);
  const first = await service.page('auth', 'alice', { file: catalog.files[0].id });
  const older = await service.page('auth', 'alice', { cursor: first.olderCursor });
  assert.equal(older.file, file);
  assert.equal(older.end, first.start);
  await assert.rejects(
    () => service.page('auth', 'bob', { cursor: first.olderCursor }),
    /another account/,
  );
});

test('native rotation names reject other families, compression, paths and unbounded suffixes', async () => {
  const f = fixture(),
    service = new LogService(f.client);
  for (const file of [
    'messages.old_',
    'messages.old_backup',
    'alerts.old_20260928',
    'messages.old_20260928.gz',
    '../messages.old_20260928',
    'messages.old_20260928/private.log',
    'messages.old_' + '9'.repeat(41),
  ]) {
    await assert.rejects(() => service.page('auth', 'alice', { file }), /supported log/);
  }
  assert.equal(f.calls, 0);
});
