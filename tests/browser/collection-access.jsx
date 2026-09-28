import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Collection } from '../../src/pages/Collection';
import { entities } from '../../shared/catalog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const reportFetch = window.fetch.bind(window),
  calls = [],
  results = [];
const records = {
  secrets: { Name: 'Fixture.Alpha', Type: '%Wallet.KeyValue' },
  roles: { Name: 'FixtureRole', Description: 'List role description' },
  users: { Name: 'FixtureUser', FullName: 'Fixture operator' },
  oauthClients: { ApplicationName: 'FixtureClient', Name: 'FixtureClient' },
  tasks: { Id: '42', Name: 'FixtureTask', Namespace: '%SYS', Type: 'User' },
  processes: {
    Pid: '42',
    Username: 'Fixture',
    CanBeSuspended: true,
    CanBeTerminated: true,
    StartTimeUTC: '2026-09-28T12:00:00Z',
    JobNumber: 42,
  },
};
let entityId = 'secrets',
  mode = '200',
  infoStatus = 200,
  suspended = false,
  generation = 0,
  write = true,
  hold = '',
  release;
let processFlags = true,
  processListFlags = true;
window.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ url, operation: body });
  if (url !== '/api/iris' || body.method !== 'GET')
    throw Error('Unexpected native write or unknown route.');
  const entity = entities[entityId],
    list = body.path === entity.list && (entityId !== 'secrets' || !body.query.collection),
    info = body.path === '/v2/task/info';
  if (!list && !info && body.path !== (entity.noDetail ? entity.list : entity.detail))
    throw Error('Unexpected detail route.');
  const status = list ? 200 : info ? infoStatus : Number(mode.split('-')[0]);
  const detail = {
    ...records[entityId],
    ...(entityId === 'roles' ? { Description: 'Current detail description' } : {}),
    ...(entityId === 'processes'
      ? { CanBeSuspended: processFlags, CanBeTerminated: processFlags }
      : {}),
  };
  const metadata =
    mode === '200-empty'
      ? []
      : [
          { Name: 'Fixture.Other', Type: 'Other metadata' },
          { ...records.secrets, Type: 'Updated metadata type' },
        ];
  const data = list
    ? [
        {
          ...records[entityId],
          ...(entityId === 'processes'
            ? { CanBeSuspended: processListFlags, CanBeTerminated: processListFlags }
            : {}),
        },
      ]
    : info
      ? { Suspended: suspended }
      : entityId === 'secrets'
        ? metadata
        : detail;
  const response = () =>
    Response.json(
      status === 200
        ? { data, status: 200, console: [] }
        : { error: 'Synthetic current read ' + status },
      { status },
    );
  if (!list && ((hold === 'detail' && !info) || (hold === 'info' && info))) {
    hold = '';
    return new Promise((resolve) => {
      release = () => resolve(response());
    });
  }
  return response();
};
const root = createRoot(document.getElementById('probe'));
const modal = () => document.querySelector('dialog');
const button = (name) =>
  [...(modal()?.querySelectorAll('button') ?? [])].find((node) => node.textContent.trim() === name);
const row = () => document.querySelector('.row-name');
const detailText = () => modal()?.querySelector('dl.details')?.textContent ?? '';
const enabled = (name) => !!button(name) && !button(name).disabled;
const disabled = (...names) => names.every((name) => !!button(name) && button(name).disabled);
const check = (name, pass) => results.push({ name, pass: !!pass });
async function settle(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw Error('Collection fixture did not settle.');
}
async function click(node) {
  if (!node) throw Error('Missing collection fixture control.');
  await act(async () => node.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
}
async function reset(nextEntity = 'secrets', nextMode = '200', setup = {}) {
  entityId = nextEntity;
  mode = nextMode;
  infoStatus = setup.infoStatus ?? 200;
  suspended = setup.suspended ?? false;
  write = setup.write ?? true;
  hold = setup.hold ?? '';
  release = undefined;
  processFlags = setup.processFlags ?? true;
  processListFlags = setup.processListFlags ?? true;
  calls.length = 0;
  const info = {
    username: 'Fixture',
    privileges: { [entities[entityId].privilege]: { use: write } },
  };
  await act(async () =>
    root.render(
      <Collection key={++generation} entity={entities[entityId]} info={info} notify={() => {}} />,
    ),
  );
  await settle(() => !!row());
  await click(row());
  await settle(() => !!modal()?.open && calls.length === (entityId === 'tasks' ? 3 : 2));
  if (!release) await settle(() => !modal()?.querySelector('[role="status"]'));
}
async function fillConfirmation(value) {
  const node = modal().querySelector('input[aria-label="Confirm target"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function suite() {
  await reset('secrets', '200', { hold: 'detail' });
  check(
    'Wallet metadata waits for current read; cached name/type and write controls are unavailable',
    !detailText() && !modal().textContent.includes('Fixture.Alpha') && disabled('Rotate', 'Delete'),
  );
  await act(async () => release());
  await settle(() => enabled('Rotate'));
  check(
    'Wallet uses freshly returned matching metadata instead of cached row',
    detailText().includes('Updated metadata type') &&
      !detailText().includes('%Wallet.KeyValue') &&
      enabled('Rotate') &&
      enabled('Delete'),
  );

  await reset('secrets', '403');
  check(
    'Wallet GET403 hides cached metadata/title and disables Rotate/Delete',
    !detailText() &&
      !modal().textContent.includes('Fixture.Alpha') &&
      !!modal().querySelector('[role="alert"]') &&
      disabled('Rotate', 'Delete'),
  );
  mode = '200';
  await click(button('Try again'));
  await settle(() => enabled('Rotate'));
  check(
    'Explicit wallet retry restores current metadata and actions after authorized read',
    detailText().includes('Updated metadata type') && enabled('Delete') && calls.length === 3,
  );

  await reset('secrets', '503');
  check(
    'First wallet read503 cannot use list row as authorized detail',
    !detailText() && disabled('Rotate', 'Delete') && !!modal().querySelector('[role="alert"]'),
  );
  await reset('secrets', '200-empty');
  check(
    'Absent wallet entry explains missing record and blocks actions without endless spinner',
    !detailText() &&
      disabled('Rotate', 'Delete') &&
      modal().textContent.includes('not present in the current response') &&
      !modal().querySelector('[role="status"]'),
  );
  await reset();
  check(
    'Wallet matches exact identity instead of first returned collection entry',
    detailText().includes('Fixture.Alpha') &&
      !detailText().includes('Fixture.Other') &&
      calls[1].operation.query.collection === 'Fixture',
  );

  await reset('roles', '403');
  check(
    'Normal role read403 disables Delete as well as Edit and clears detail/title',
    !detailText() && disabled('Delete', 'Edit') && !modal().textContent.includes('FixtureRole'),
  );
  await reset('roles');
  await click(button('Edit'));
  check(
    'Authorized role Edit opens current detail values',
    !!modal().querySelector('form') &&
      modal().querySelector('#field-Description')?.value === 'Current detail description' &&
      calls.length === 2,
  );

  await reset('secrets', '200', { write: false });
  check(
    'Read-only wallet inspection remains available without write controls',
    detailText().includes('Updated metadata type') && !button('Rotate') && !button('Delete'),
  );
  await reset('users', '403');
  check(
    'User GET403 blocks password reset and ordinary writes',
    disabled('Reset password', 'Delete', 'Edit') && !detailText(),
  );
  await reset('oauthClients', '403');
  check(
    'OAuth client GET403 blocks credential editor and ordinary writes',
    disabled('Client credentials', 'Delete', 'Edit') && !detailText(),
  );

  await reset('tasks', '403');
  check(
    'Denied task record blocks task actions despite allowed task status',
    disabled('Run now', 'Suspend', 'Delete', 'Edit') && !detailText(),
  );
  await reset('tasks', '200', { infoStatus: 403 });
  check(
    'Denied task status permits record inspection but blocks state-dependent writes',
    detailText().includes('FixtureTask') && disabled('Run now', 'Suspend', 'Delete', 'Edit'),
  );
  infoStatus = 200;
  suspended = true;
  await click(button('Try again'));
  await settle(() => enabled('Resume'));
  check(
    'Task status retry restores current Resume action after authorized read',
    enabled('Run now') && enabled('Resume') && enabled('Edit') && calls.length === 4,
  );
  await reset('tasks', '200', { hold: 'info' });
  const waiting = disabled('Run now', 'Suspend', 'Delete', 'Edit');
  await act(async () => release());
  await settle(() => enabled('Run now'));
  check(
    'Task actions wait for both record and status reads',
    waiting && enabled('Suspend') && calls.length === 3,
  );

  await reset('processes', '403');
  check(
    'Process GET403 blocks suspend, resume and terminate',
    disabled('Suspend', 'Resume', 'Terminate') && !detailText(),
  );
  await reset('processes', '200', { processFlags: false });
  check(
    'Current process capability denial overrides allowed list flags',
    disabled('Suspend', 'Terminate') && enabled('Resume') && !!detailText(),
  );
  await reset('processes', '200', { processListFlags: false });
  check(
    'Current process capabilities enable actions despite older denied list flags',
    enabled('Suspend') && enabled('Terminate') && enabled('Resume'),
  );
  await reset('processes');
  await click(button('Terminate'));
  const emptyBlocked = disabled('Confirm terminate');
  await fillConfirmation('incorrect');
  const mismatchBlocked = disabled('Confirm terminate');
  await fillConfirmation('42');
  check(
    'Authorized process action still requires exact target confirmation',
    emptyBlocked && mismatchBlocked && enabled('Confirm terminate') && calls.length === 2,
  );

  await reset();
  await click(button('Rotate'));
  check(
    'Authorized wallet rotation opens write-only form without reading a secret or sending a mutation',
    !!modal().querySelector('form') &&
      !!modal().querySelector('#field-Type') &&
      calls.length === 2 &&
      calls.every(
        (call) => call.operation.path === '/v2/wallet/secrets' && call.operation.method === 'GET',
      ),
  );
}
(async () => {
  let error;
  try {
    await suite();
  } catch (failure) {
    error = failure.stack;
  }
  const report = {
    results,
    error,
    nativeCalls: 0,
    appliedWrites: calls.filter((call) => call.operation.method !== 'GET').length,
  };
  document.getElementById('result').textContent = JSON.stringify(report, null, 2);
  await reportFetch('/_test/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
})();
