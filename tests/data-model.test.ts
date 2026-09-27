import test from 'node:test';
import assert from 'node:assert/strict';
import { capacity, formatBytes, columnsFor, filterRows } from '../src/components/data-model';

test('capacity reflects available memory rather than free-only memory and binary units', () => {
  assert.deepEqual(capacity(16 * 1024 ** 3, 12 * 1024 ** 3), {
    total: 16 * 1024 ** 3,
    available: 12 * 1024 ** 3,
    used: 4 * 1024 ** 3,
    percent: 25,
  });
  assert.equal(formatBytes(1024 ** 3), '1 GiB');
  assert.equal(formatBytes(1024 ** 3, 'MiB').replace(/[,\s\u00a0\u202f]/g, ''), '1024MiB');
});
test('missing or impossible telemetry must not become a healthy zero-percent gauge', () => {
  for (const [total, available] of [
    [0, 0],
    [100, 101],
    [100, -1],
    [Infinity, 1],
    [100, NaN],
    [100, undefined],
    ['100', 1],
  ])
    assert.equal(capacity(total, available), undefined);
  assert.equal(capacity(100, 0)?.percent, 100);
  assert.equal(capacity(100, 100)?.percent, 0);
});
test('table sorting preserves native numeric order and the original record identity', () => {
  const rows = [
    { Id: 'second', Count: 10 },
    { Id: 'first', Count: 2 },
  ];
  assert.deepEqual(
    filterRows(rows, '', 'Count', false).map((v) => v.index),
    [1, 0],
  );
  assert.equal(rows[0].Id, 'second');
});
test('table filtering includes nested fields available in record inspection', () => {
  const rows = [
    { Name: 'alpha', Roles: ['Operator'] },
    { Name: 'beta', Roles: [] },
  ];
  assert.deepEqual(
    filterRows(rows, 'operator', '', false).map((v) => v.index),
    [0],
  );
  assert.deepEqual(filterRows(rows, 'missing', '', false), []);
});
test('mixed native records retain fields missing in the first record', () => {
  assert.deepEqual(columnsFor([{ Name: 'a' }, { Name: 'b', Status: false }]), ['Name', 'Status']);
  assert.deepEqual(columnsFor([null, 'hello']), ['Value']);
});

for (const key of ['__proto__', 'constructor', 'toString']) {
  test(`sorting ${key} treats an absent field as missing and preserves an own value`, () => {
    const rows = [{ Name: 'Absent' }, JSON.parse(`{"Name":"Present","${key}":"Middle"}`)];
    assert.deepEqual(columnsFor(rows), ['Name', key]);
    assert.deepEqual(
      filterRows(rows, '', key, false).map((value) => value.index),
      [1, 0],
    );
    assert.deepEqual(
      filterRows(rows, '', key, true).map((value) => value.index),
      [0, 1],
    );
    assert.equal(Object.hasOwn(rows[0], key), false);
    assert.equal(Object.hasOwn(rows[1], key), true);
  });
}
