import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Changes } from '../../src/pages/Changes';
import { validStoredChange } from '../../shared/change-record';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const reportFetch = window.fetch.bind(window),
  results = [],
  calls = [];
const at = '2026-09-28T12:00:00.000Z';
const make = (id, target) => ({
  version: 1,
  id,
  owner: 'Fixture',
  instance: 'synthetic',
  revision: 3,
  createdAt: at,
  updatedAt: at,
  expiresAt: at,
  title: 'Saved change for ' + target,
  target,
  path: '/v2/security/roles/' + target,
  method: 'PUT',
  query: {},
  state: 'verified',
  fields: [
    {
      name: 'Description',
      before: 'Earlier description',
      requested: 'Reviewed description',
      observed: 'Reviewed description',
      readable: true,
      matches: true,
    },
  ],
  baseline: { Description: 'Earlier description' },
  result: { ok: true },
  observation: { Description: 'Reviewed description' },
  nativeStatus: 200,
  explanation: 'The saved readback matched the reviewed fields.',
  events: [{ at, action: 'verified', message: 'Saved synthetic receipt.' }],
  verification: 'fields',
});
const alpha = make('11111111-1111-4111-8111-111111111111', 'RoleAlpha');
const bravo = make('22222222-2222-4222-8222-222222222222', 'RoleBravo');
if (![alpha, bravo].every(validStoredChange)) throw Error('Invalid synthetic receipt shape.');
const summary = ({ baseline, result, observation, fields, events, ...record }) => ({
  ...record,
  fieldCount: fields.length,
});
let listMode = '200',
  detailStatus = 200,
  generation = 0,
  holdNext = false,
  release;
window.fetch = async (url, options = {}) => {
  const method = options.method ?? 'GET';
  calls.push({ url, method });
  if (method !== 'GET') throw Error('Unexpected mutation: ' + url);
  if (
    url !== '/api/changes' &&
    ![alpha, bravo].some((record) => url === '/api/changes/' + record.id)
  )
    throw Error('Unexpected request: ' + url);
  const list = url === '/api/changes',
    status = list ? Number(listMode.split('-')[0]) : detailStatus;
  const records = ['200-filtered', '200-unreadable'].includes(listMode) ? [bravo] : [alpha, bravo];
  const value = list
    ? {
        records: records.map(summary),
        unreadable: listMode === '200-unreadable' ? [alpha.id] : [],
        total: 2,
      }
    : url.endsWith(alpha.id)
      ? alpha
      : bravo;
  const response = () =>
    Response.json(status === 200 ? value : { error: 'Synthetic receipt response ' + status }, {
      status,
    });
  if (holdNext) {
    holdNext = false;
    return new Promise((resolve) => {
      release = () => resolve(response());
    });
  }
  return response();
};
const root = createRoot(document.getElementById('probe'));
const button = (name) =>
  [...document.querySelectorAll('#probe button')].find((node) => node.textContent.trim() === name);
const row = (target) =>
  [...document.querySelectorAll('.record-choice')].find(
    (node) => node.querySelector('strong')?.textContent === target,
  );
const selected = () => document.querySelector('.record-workbench h2')?.textContent === alpha.title;
const exported = () => !!button('Export record') && !button('Export record').disabled;
const evidence = () =>
  document.querySelector('.record-workbench').textContent.includes('Reviewed description');
const check = (name, pass) => results.push({ name, pass: !!pass });
async function settle(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw Error('Change access fixture did not settle.');
}
async function click(node) {
  if (!node) throw Error('Missing fixture control.');
  await act(async () => node.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
}
async function reset() {
  listMode = '200';
  detailStatus = 200;
  holdNext = false;
  release = undefined;
  calls.length = 0;
  await act(async () => root.render(<Changes key={++generation} />));
  await settle(() => !!row(alpha.target));
  await click(row(alpha.target));
  await settle(selected);
}
async function suite() {
  for (const status of [403, 404]) {
    await reset();
    detailStatus = status;
    await click(button('Refresh record'));
    check(
      `Selected GET ${status} removes detail, evidence, export and only matching summary`,
      !selected() &&
        !evidence() &&
        !button('Export record') &&
        !row(alpha.target) &&
        !!row(bravo.target),
    );
  }
  for (const status of [403, 404]) {
    await reset();
    detailStatus = status;
    await click(row(bravo.target));
    check(
      `Other GET ${status} preserves authorized selection and removes only refused summary`,
      selected() && exported() && evidence() && !!row(alpha.target) && !row(bravo.target),
    );
  }
  await reset();
  listMode = '403';
  await click(button('Refresh'));
  check(
    'List 403 clears all cached summaries, receipt, evidence and export',
    !selected() &&
      !evidence() &&
      !button('Export record') &&
      !row(alpha.target) &&
      !row(bravo.target),
  );

  await reset();
  listMode = '200-filtered';
  await click(button('Refresh'));
  check(
    'Authorized list excluding selected ID removes receipt and export',
    !selected() && !button('Export record') && !row(alpha.target) && !!row(bravo.target),
  );

  await reset();
  listMode = '200-unreadable';
  await click(button('Refresh'));
  check(
    'Unreadable listing entry preserves already received evidence with unreadable warning',
    selected() &&
      exported() &&
      evidence() &&
      document.getElementById('probe').textContent.includes('stored records could not be read'),
  );

  await reset();
  detailStatus = 500;
  await click(button('Refresh record'));
  check(
    'Transient detail 500 preserves known receipt and error without retry',
    selected() &&
      exported() &&
      evidence() &&
      calls.length === 3 &&
      document.getElementById('probe').textContent.includes('Synthetic receipt response 500'),
  );

  await reset();
  listMode = '500';
  await click(button('Refresh'));
  check(
    'Transient list 500 preserves known receipt and summaries',
    selected() && exported() && evidence() && !!row(alpha.target) && !!row(bravo.target),
  );

  await reset();
  detailStatus = 403;
  await click(button('Refresh record'));
  detailStatus = 200;
  await click(button('Refresh'));
  const notResurrectedByList = !selected() && !button('Export record');
  await click(row(alpha.target));
  check(
    'Fresh list restores a summary; only fresh detail GET restores evidence/export',
    notResurrectedByList && selected() && exported() && evidence(),
  );

  await reset();
  detailStatus = 403;
  holdNext = true;
  await click(button('Refresh record'));
  await settle(() => !!release);
  const count = calls.length;
  await click(button('Refresh'));
  await click(row(bravo.target));
  const serialized = calls.length === count;
  await act(async () => release());
  await settle(() => !button('Refresh').disabled);
  check(
    'Pending denied detail blocks competing list/selection and cannot resurrect the receipt',
    serialized &&
      !selected() &&
      !row(alpha.target) &&
      !!row(bravo.target) &&
      !button('Export record'),
  );

  await reset();
  listMode = '403';
  holdNext = true;
  await click(button('Refresh'));
  await settle(() => !!release);
  const before = calls.length;
  await click(button('Refresh record'));
  await click(row(bravo.target));
  const guarded = calls.length === before;
  await act(async () => release());
  await settle(() => !button('Refresh').disabled);
  check(
    'Pending denied list blocks competing detail requests and clears protected state',
    guarded && !selected() && !row(alpha.target) && !row(bravo.target) && !button('Export record'),
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
    nativeCalls: calls.filter((call) => !call.url.startsWith('/api/changes')).length,
    appliedWrites: calls.filter((call) => call.method !== 'GET').length,
  };
  document.getElementById('result').textContent = JSON.stringify(report, null, 2);
  await reportFetch('/_test/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
})();
