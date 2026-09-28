import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { InvestigationProfiles } from '../../src/pages/InvestigationProfiles';
import {
  profileInputSchema,
  profileSummary,
  starterProfiles,
} from '../../shared/investigation-profile';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const reportFetch = window.fetch.bind(window),
  results = [],
  calls = [];
const definition = profileInputSchema.parse(structuredClone(starterProfiles[0]));
const make = (id, title) => ({
  ...definition,
  title,
  version: 1,
  id,
  owner: 'Fixture',
  instance: 'synthetic',
  revision: 3,
  status: 'active',
  history: [],
  createdAt: '2026-09-28T12:00:00Z',
  updatedAt: '2026-09-28T12:00:00Z',
});
const alpha = make('11111111-1111-4111-8111-111111111111', 'Profile Alpha');
const bravo = make('22222222-2222-4222-8222-222222222222', 'Profile Bravo');
let listStatus = 200,
  detailStatus = 200,
  postStatus = 403,
  revision = 3;
let holdList = false,
  holdDetail = '',
  releases = [],
  generation = 0;
const root = createRoot(document.getElementById('probe'));
const check = (name, pass) => results.push({ name, pass: !!pass });
const button = (name, scope = document.getElementById('probe')) =>
  [...scope.querySelectorAll('button')].find((node) => node.textContent.trim() === name);
const saved = (title) =>
  [...document.querySelectorAll('.record-index button')].find(
    (node) => node.querySelector('strong')?.textContent === title,
  );
const visible = (node) => !!node && !node.closest('[hidden]');
const current = () => document.querySelector('.record-workbench h2')?.textContent;
const exportVisible = () => visible(button('Export'));
const modal = () => document.querySelector('#probe dialog');
const field = (label) =>
  [...modal().querySelectorAll('label')]
    .find((node) => node.textContent.trim().startsWith(label))
    ?.querySelector('input,textarea');
const posts = () => calls.filter((call) => call.method === 'POST');
window.fetch = async (url, options = {}) => {
  const method = options.method ?? 'GET';
  calls.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined });
  const list = url === '/api/investigation-profiles';
  const status = method === 'POST' ? postStatus : list ? listStatus : detailStatus;
  const value =
    list && method === 'GET'
      ? { records: [alpha, bravo].map(profileSummary), unreadable: [] }
      : { ...(url.includes(bravo.id) ? bravo : alpha), revision };
  const response = () =>
    Response.json(status === 200 ? value : { error: 'Synthetic refusal ' + status }, { status });
  if (
    method === 'GET' &&
    ((list && holdList) || (!list && holdDetail && url.endsWith(holdDetail)))
  ) {
    holdList = false;
    holdDetail = '';
    return new Promise((resolve) => releases.push(() => resolve(response())));
  }
  return response();
};
async function settle(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw Error('Profile access fixture did not settle.');
}
async function click(node) {
  if (!node) throw Error('Missing fixture control.');
  await act(async () => node.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
}
async function fill(label, value) {
  const node = field(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    ).set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function reset(select = true) {
  listStatus = detailStatus = 200;
  postStatus = 403;
  revision = 3;
  holdList = false;
  holdDetail = '';
  releases = [];
  calls.length = 0;
  await act(async () =>
    root.render(<InvestigationProfiles key={++generation} onStarted={() => {}} />),
  );
  await settle(() => !!saved(alpha.title));
  if (select) {
    await click(saved(alpha.title));
    await settle(() => current() === alpha.title);
  }
}
async function submit() {
  await act(async () =>
    modal()
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}
async function edit() {
  await click(button('Edit profile'));
  await fill('Title', 'Retained Alpha draft');
  await fill('Reason for revision', 'Clarify operator follow-up.');
}
async function suite() {
  for (const status of [403, 404]) {
    await reset();
    detailStatus = status;
    await click(saved(alpha.title));
    check(
      'detail GET' + status + ' removes selected profile, export and its summary',
      current() !== alpha.title && !button('Export') && !saved(alpha.title),
    );
  }
  await reset();
  listStatus = 403;
  await click(button('Refresh'));
  check(
    'list GET403 removes saved index, selected profile and export',
    !saved(alpha.title) && !saved(bravo.title) && !button('Export'),
  );
  await reset();
  detailStatus = 403;
  await click(saved(bravo.title));
  check(
    'other-profile denial preserves current authorized selection',
    current() === alpha.title && exportVisible(),
  );
  await reset();
  detailStatus = 503;
  await click(saved(alpha.title));
  check(
    'transient detail failure hides cached detail and export with explicit retry',
    !exportVisible() && !!button('Read profile again'),
  );
  detailStatus = 200;
  await click(button('Read profile again'));
  check(
    'successful read restores quarantined profile',
    current() === alpha.title && exportVisible(),
  );
  await reset();
  await click(button('Archive'));
  check(
    'refused mutation rechecks read once and does not replay',
    posts().length === 1 &&
      calls.at(-1).method === 'GET' &&
      calls.at(-1).url.endsWith(alpha.id) &&
      exportVisible(),
  );
  await reset();
  detailStatus = 403;
  await click(button('Archive'));
  check(
    'mutation followed by denied read removes protected profile',
    posts().length === 1 && !button('Export') && !saved(alpha.title),
  );
  await reset();
  await edit();
  detailStatus = 503;
  await submit();
  check(
    'unverified edit hides its form but retains draft values',
    modal()?.querySelector('form').hidden &&
      field('Title').value === 'Retained Alpha draft' &&
      !!button('Read profile again', modal()),
  );
  detailStatus = 200;
  revision = 9;
  await click(button('Read profile again', modal()));
  check(
    'recovered edit retains exact title and reason',
    !modal().querySelector('form').hidden &&
      field('Title').value === 'Retained Alpha draft' &&
      field('Reason for revision').value === 'Clarify operator follow-up.',
  );
  postStatus = 409;
  await submit();
  check(
    'fresh detail never advances bound edit ID or revision',
    posts()
      .at(-1)
      .url.endsWith(alpha.id + '/revise') &&
      posts().at(-1).body.revision === 3 &&
      posts().at(-1).body.definition.title === 'Retained Alpha draft',
  );
  await reset();
  await click(button('Start investigation'));
  await fill('Investigation title', 'Retained start draft');
  detailStatus = 503;
  await submit();
  check(
    'refused start quarantines form and removes protected subtitle',
    modal().querySelector('form').hidden &&
      !modal().querySelector('header').textContent.includes(alpha.title) &&
      posts().length === 1 &&
      calls.at(-1).method === 'GET',
  );
  detailStatus = 200;
  revision = 8;
  await click(button('Read profile again', modal()));
  postStatus = 409;
  await submit();
  check(
    'start recovery retains typed title and opening revision',
    field('Investigation title').value === 'Retained start draft' &&
      posts()
        .at(-1)
        .url.endsWith(alpha.id + '/start') &&
      posts().at(-1).body.revision === 3,
  );
  await reset();
  await click(button('Start investigation'));
  detailStatus = 404;
  await submit();
  check(
    'missing profile after start refusal removes start modal and detail',
    !modal() && !button('Export') && posts().length === 1,
  );
  await reset();
  await click(button('Duplicate'));
  detailStatus = 403;
  await submit();
  check(
    'duplicate draft retains create semantics and clears after source denial',
    !modal() &&
      posts().length === 1 &&
      posts()[0].url === '/api/investigation-profiles' &&
      calls.at(-1).url.endsWith(alpha.id),
  );
  await reset();
  await click(button('New profile'));
  await fill('Title', 'Independent local draft');
  listStatus = 403;
  // A background read callback can finish while a modal is open; this is ownership coverage.
  await click(button('Refresh'));
  check(
    'whole-list denial does not erase independent new draft',
    !!modal() &&
      !modal().querySelector('form').hidden &&
      field('Title').value === 'Independent local draft' &&
      !button('Export'),
  );
  await reset();
  holdList = true;
  detailStatus = 403;
  // Both clicks were queued before React hides the index for the pending list.
  const refreshBeforeRender = button('Refresh'),
    alphaBeforeRender = saved(alpha.title);
  await act(async () => {
    refreshBeforeRender.click();
    alphaBeforeRender.click();
  });
  await settle(() => current() !== alpha.title);
  await act(async () => releases.shift()());
  check(
    'older list success cannot resurrect newly denied profile',
    !saved(alpha.title) && !button('Export'),
  );
  await reset(false);
  holdDetail = alpha.id;
  await click(saved(alpha.title));
  await click(saved(bravo.title));
  await act(async () => releases.shift()());
  check('late first inspection does not replace newer selected profile', current() === bravo.title);
  await click(button('Refresh'));
  check(
    'fresh list restores summary-only superseded pending profile',
    !!saved(alpha.title) && current() === bravo.title && exportVisible(),
  );
  await reset();
  await click(saved(bravo.title));
  detailStatus = 503;
  await click(saved(alpha.title));
  detailStatus = 200;
  await click(button('Refresh'));
  check(
    'fresh list restores other failed summary without changing authorized detail',
    !!saved(alpha.title) && current() === bravo.title && exportVisible(),
  );
  await reset();
  holdList = true;
  await click(button('Refresh'));
  listStatus = 403;
  await click(button('Refresh'));
  await act(async () => releases.shift()());
  check(
    'older list success cannot overwrite newer list denial',
    !saved(alpha.title) && !saved(bravo.title) && !button('Export'),
  );
  await reset();
  await edit();
  await click(saved(bravo.title));
  detailStatus = 403;
  await submit();
  check(
    'bound editor denial clears its own draft and retains different selection',
    !modal() &&
      current() === bravo.title &&
      exportVisible() &&
      posts()[0].url.endsWith(alpha.id + '/revise'),
  );
  await reset();
  await click(button('Duplicate'));
  postStatus = 200;
  listStatus = 403;
  await submit();
  check(
    'successful creation followed by list denial remains reported as saved without retry',
    !modal() &&
      !button('Export') &&
      posts().length === 1 &&
      document
        .querySelector('#probe')
        .textContent.includes('Profile saved. Could not refresh the list'),
  );
}
(async () => {
  let error;
  try {
    await suite();
  } catch (caught) {
    error = caught.stack || String(caught);
  }
  const report = {
    results,
    error,
    nativeCalls: 0,
    appliedWrites: 0,
    limitations:
      'Synthetic responses only. Background ownership checks call controls programmatically while a modal is open; they do not claim those controls are user-accessible.',
  };
  document.getElementById('result').textContent = JSON.stringify(report, null, 2);
  await reportFetch('/_test/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
})();
