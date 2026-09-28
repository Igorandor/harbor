import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Changes } from '../../src/pages/Changes';
import { validStoredChange } from '../../shared/change-record';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const reportFetch = window.fetch.bind(window),
  results = [],
  calls = [];
const at = '2026-09-28T12:00:00.000Z';
const alpha = '11111111-1111-4111-8111-111111111111',
  bravo = '22222222-2222-4222-8222-222222222222';
const target = (id) => (id === alpha ? 'RoleAlpha' : 'RoleBravo');
const make = (action, id, revision = 3) => ({
  version: 1,
  id,
  owner: 'Fixture',
  instance: 'synthetic',
  revision,
  createdAt: at,
  updatedAt: at,
  expiresAt: '2026-10-10T12:00:00.000Z',
  title: 'Saved change for ' + target(id),
  target: target(id),
  path: '/v2/security/roles/' + target(id),
  method: 'PUT',
  query: {},
  state: action === 'reconcile' ? 'uncertain' : 'prepared',
  fields: [
    {
      name: 'Description',
      before: 'Earlier description',
      requested: 'Reviewed description',
      readable: true,
    },
  ],
  baseline: { Description: 'Earlier description' },
  explanation:
    action === 'reconcile'
      ? 'The execution result could not be confirmed.'
      : 'Review this request before execution.',
  events: [{ at, action: 'prepared', message: 'Saved synthetic record.' }],
  verification: 'fields',
});
if (
  !['cancel', 'reconcile', 'execute']
    .flatMap((action) => [alpha, bravo].map((id) => make(action, id)))
    .every(validStoredChange)
)
  throw Error('Invalid synthetic record shape.');
const summary = ({ baseline, result, observation, fields, events, ...record }) => ({
  ...record,
  fieldCount: fields.length,
});
let action = 'cancel',
  postStatus = 403,
  readStatus = 200,
  generation = 0,
  holdRead = false,
  release;
let refused = new Set();
window.fetch = async (url, options = {}) => {
  const method = options.method ?? 'GET';
  calls.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined });
  const list = url === '/api/changes';
  const id = url.includes(bravo) ? bravo : alpha;
  if (method === 'POST') {
    if (url !== '/api/changes/' + id + '/' + action)
      throw Error('Unexpected mutation path: ' + url);
    refused.add(id);
    return Response.json(
      { error: 'Synthetic operation refusal ' + postStatus },
      { status: postStatus },
    );
  }
  if (!list && url !== '/api/changes/' + id) throw Error('Unexpected read path: ' + url);
  const status = !list && refused.has(id) ? readStatus : 200;
  const record = make(action, id, refused.has(id) ? 7 : 3);
  const response = () =>
    Response.json(
      status === 200
        ? list
          ? {
              records: [alpha, bravo].map((id) => summary(make(action, id))),
              unreadable: [],
              total: 2,
            }
          : record
        : { error: 'Synthetic record read ' + status },
      { status },
    );
  if (!list && refused.has(id) && holdRead) {
    holdRead = false;
    return new Promise((resolve) => {
      release = () => resolve(response());
    });
  }
  return response();
};
const root = createRoot(document.getElementById('probe'));
const button = (name) =>
  [...document.querySelectorAll('#probe button')].find((node) => node.textContent.trim() === name);
const row = (id) =>
  [...document.querySelectorAll('.record-choice')].find(
    (node) => node.querySelector('strong')?.textContent === target(id),
  );
const selected = (id) =>
  document.querySelector('.record-workbench h2')?.textContent === 'Saved change for ' + target(id);
const exported = () => !!button('Export record') && !button('Export record').disabled;
const evidence = () =>
  document.querySelector('.record-workbench').textContent.includes('Earlier description');
const check = (name, pass) => results.push({ name, pass: !!pass });
const posts = () => calls.filter((call) => call.method === 'POST');
async function settle(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw Error('Change mutation fixture did not settle.');
}
async function click(node) {
  if (!node) throw Error('Missing fixture control.');
  await act(async () => node.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
}
async function fillConfirmation(id = alpha) {
  const node = document.querySelector('input[autocomplete="off"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, target(id));
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function reset(nextAction = 'cancel') {
  action = nextAction;
  postStatus = 403;
  readStatus = 200;
  holdRead = false;
  release = undefined;
  refused = new Set();
  calls.length = 0;
  await act(async () => root.render(<Changes key={++generation} />));
  await settle(() => !!row(alpha));
  await click(row(alpha));
  await settle(() => selected(alpha));
}
async function invoke(id = alpha) {
  if (action === 'execute') await fillConfirmation(id);
  await click(
    button(
      action === 'cancel'
        ? 'Cancel review'
        : action === 'reconcile'
          ? 'Check current state'
          : 'Execute reviewed change',
    ),
  );
}
async function suite() {
  for (const mode of ['cancel', 'reconcile', 'execute'])
    for (const status of [200, 403, 404, 503]) {
      await reset(mode);
      readStatus = status;
      await invoke();
      const exactCalls =
        calls.length === 4 &&
        calls[2].url === '/api/changes/' + alpha + '/' + mode &&
        calls[2].body.revision === 3 &&
        calls[3].url === '/api/changes/' + alpha &&
        calls[3].method === 'GET';
      const refusal = document
        .getElementById('probe')
        .textContent.includes('Synthetic operation refusal 403');
      const state =
        status === 200
          ? selected(alpha) &&
            exported() &&
            evidence() &&
            !!row(alpha) &&
            !button('Retry record access')
          : !selected(alpha) &&
            !button('Export record') &&
            !evidence() &&
            !row(alpha) &&
            (status === 503 ? !!button('Retry record access') : !button('Retry record access'));
      const freshConfirmation =
        mode !== 'execute' || status !== 200 || button('Execute reviewed change').disabled;
      check(
        `${mode} 403 rechecks exact ID once; GET ${status} handles protected state and retains refusal`,
        exactCalls && refusal && state && freshConfirmation && posts().length === 1,
      );
    }
  for (const mode of ['cancel', 'reconcile', 'execute']) {
    await reset(mode);
    readStatus = 503;
    await invoke();
    await click(button('Refresh'));
    await click(row(bravo));
    const otherDidNotRestore =
      selected(bravo) && exported() && !row(alpha) && !!button('Retry record access');
    await click(button('Retry record access'));
    const stillUnverified = selected(bravo) && !row(alpha) && !!button('Retry record access');
    readStatus = 200;
    await click(button('Retry record access'));
    const freshConfirmation = mode !== 'execute' || button('Execute reviewed change').disabled;
    check(
      `${mode} quarantine survives authorized list, other selection and failed retry; exact read restores it`,
      otherDidNotRestore &&
        stillUnverified &&
        selected(alpha) &&
        exported() &&
        !!row(alpha) &&
        !button('Retry record access') &&
        freshConfirmation &&
        posts().length === 1,
    );
  }
  for (const mode of ['cancel', 'reconcile', 'execute']) {
    await reset(mode);
    holdRead = true;
    const originalAction = button(
      mode === 'cancel'
        ? 'Cancel review'
        : mode === 'reconcile'
          ? 'Check current state'
          : 'Execute reviewed change',
    );
    await invoke();
    await settle(() => !!release);
    const hiddenWhileReading =
      !selected(alpha) &&
      !row(alpha) &&
      !button('Export record') &&
      !evidence() &&
      button('Retry record access').disabled;
    const count = calls.length;
    await click(button('Refresh'));
    await click(row(bravo));
    await click(originalAction);
    const serialized = calls.length === count;
    await act(async () => release());
    await settle(() => !!button('Export record') && !button('Export record').disabled);
    check(
      `${mode} holds pending lock throughout recheck and hides evidence before response`,
      hiddenWhileReading && serialized && selected(alpha) && posts().length === 1,
    );
  }
  for (const status of [409, 503]) {
    await reset('cancel');
    postStatus = status;
    await invoke();
    check(
      `Cancel ${status} keeps known receipt without automatic read or replay`,
      selected(alpha) &&
        exported() &&
        calls.length === 3 &&
        posts().length === 1 &&
        !button('Retry record access'),
    );
  }
  await reset('cancel');
  readStatus = 503;
  await invoke();
  await click(row(bravo));
  await invoke(bravo);
  const bothHidden = !row(alpha) && !row(bravo) && !button('Export record');
  readStatus = 200;
  await click(button('Retry record access'));
  const alphaOnly =
    selected(alpha) && !!row(alpha) && !row(bravo) && !!button('Retry record access');
  await click(button('Retry record access'));
  check(
    'Two quarantined IDs recover independently without restoring each other',
    bothHidden &&
      alphaOnly &&
      selected(bravo) &&
      !!row(alpha) &&
      !!row(bravo) &&
      !button('Retry record access') &&
      posts().length === 2,
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
    appliedWrites: 0,
    syntheticRefusedPosts: posts().length,
  };
  document.getElementById('result').textContent = JSON.stringify(report, null, 2);
  await reportFetch('/_test/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
})();
