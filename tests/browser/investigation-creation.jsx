import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import '../../src/styles.css';
import '../../src/operations.css';
import { Investigations } from '../../src/pages/Investigations';
import { InvestigationProfiles } from '../../src/pages/InvestigationProfiles';
import {
  starterProfiles,
  profileInputSchema,
  profileSummary,
} from '../../shared/investigation-profile';
import { summarizeCase, validStoredCase } from '../../shared/investigation';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const at = '2026-09-28T12:00:00.000Z',
  profile = {
    ...profileInputSchema.parse(starterProfiles[0]),
    title: 'Synthetic profile',
    version: 1,
    id: '11111111-1111-4111-8111-111111111111',
    revision: 1,
    owner: 'Fixture',
    instance: 'synthetic',
    status: 'active',
    createdAt: at,
    updatedAt: at,
    history: [],
  };
let saved = [],
  posts = [],
  releases = [],
  created = [],
  setPendingControls;
const results = [];
const reportFetch = window.fetch.bind(window);
const manual = new URLSearchParams(location.search).has('manual');
window.fetch = async (url, options = {}) => {
  const method = options.method || 'GET';
  if (method === 'GET' && url === '/api/investigations')
    return Response.json({
      records: saved.map(summarizeCase),
      unreadable: [],
      total: saved.length,
    });
  if (method === 'GET' && url === '/api/investigation-profiles')
    return Response.json({ records: [profileSummary(profile)], unreadable: [] });
  if (method === 'GET' && url === '/api/investigation-profiles/' + profile.id)
    return Response.json(profile);
  if (method === 'POST' && (url === '/api/investigations' || url.endsWith('/start'))) {
    const input = JSON.parse(options.body);
    posts.push({ url, input });
    const data = input.investigation || input;
    const record = {
      ...data,
      id: crypto.randomUUID(),
      revision: 1,
      version: 1,
      owner: 'Fixture',
      instance: 'synthetic',
      status: 'open',
      createdAt: at,
      updatedAt: at,
      notes: [],
      captures: [],
      linkedChanges: [],
    };
    if (!validStoredCase(record)) throw Error('Invalid synthetic case');
    return new Promise((resolve, reject) => {
      const finish = (status) => {
        setPendingControls?.(undefined);
        if (status === 200 || status === 'unknown') saved.push(record);
        if (status === 'unknown') reject(new TypeError('Synthetic response lost'));
        else
          resolve(
            Response.json(
              status === 200 ? record : { error: 'Synthetic creation refusal ' + status },
              { status: status === 200 ? 201 : status },
            ),
          );
      };
      releases.push(finish);
      if (manual) setPendingControls?.(() => finish);
    });
  }
  throw Error('Unexpected request ' + url);
};
function App({ mode }) {
  const [done, setDone] = useState(false),
    [pendingControl, setControl] = useState();
  setPendingControls = setControl;
  return (
    <main style={{ padding: 16 }}>
      <h1>Investigation creation fields</h1>
      <p>Synthetic records only. Creation pauses until the fixture response is chosen.</p>
      <div className="inline-actions">
        <a href="/?manual">Ordinary creation</a>
        <a href="/?manual&profile">Profile creation</a>
        <button onClick={() => location.reload()}>Reset fixture</button>
      </div>
      {done ? (
        <p>Created profile investigation: {created.at(-1)?.title}</p>
      ) : mode === 'ordinary' ? (
        <Investigations />
      ) : (
        <InvestigationProfiles
          onStarted={(record) => {
            created.push(record);
            setDone(true);
          }}
        />
      )}
      {pendingControl &&
        document.querySelector('dialog .modal-body') &&
        createPortal(
          <aside className="notice">
            <strong>Fixture response only</strong>
            <button onClick={() => pendingControl(200)}>Finish synthetic success</button>
            <button onClick={() => pendingControl(409)}>Finish synthetic refusal</button>
            <button onClick={() => pendingControl('unknown')}>Lose synthetic response</button>
          </aside>,
          document.querySelector('dialog .modal-body'),
        )}
    </main>
  );
}
const root = createRoot(document.getElementById('probe')),
  button = (name) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name),
  modal = () => document.querySelector('dialog');
const profileOption = () =>
  [...document.querySelectorAll('.record-index button')].find(
    (b) => b.querySelector('strong')?.textContent === 'Synthetic profile',
  );
const tick = () => act(async () => new Promise((r) => setTimeout(r, 10)));
async function settle(test) {
  for (let i = 0; i < 100; i++) {
    if (test()) return;
    await tick();
  }
  throw Error('Fixture did not settle');
}
async function click(node) {
  await act(async () => node.click());
  await tick();
}
async function fill(node, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    ).set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await tick();
}
async function open(mode) {
  saved = [];
  posts = [];
  releases = [];
  created = [];
  await act(async () => root.render(<App key={Math.random()} mode={mode} />));
  if (mode === 'ordinary') {
    await settle(() => !!button('New investigation') && !button('New investigation').disabled);
    await click(button('New investigation'));
  } else {
    await settle(() => !!profileOption() && !profileOption().disabled);
    await click(profileOption());
    await settle(() => !!button('Start investigation') && !button('Start investigation').disabled);
    await click(button('Start investigation'));
  }
  await settle(() => !!modal());
  await fill(modal().querySelector('input[maxlength="160"]'), 'Submitted title');
  await fill(modal().querySelector('textarea'), 'Submitted investigation scope');
}
const check = (name, pass) => results.push({ name, pass: !!pass });
const form = () => modal()?.querySelector('form');
const fields = () => [...form().querySelectorAll('input,textarea,select')];
async function submit() {
  await act(async () =>
    form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await tick();
}
async function finish(status) {
  const actions = releases.splice(0);
  await act(async () => actions.forEach((done) => done(status)));
  await tick();
}
async function suite() {
  for (const mode of ['ordinary', 'profile']) {
    await open(mode);
    await act(async () => {
      const node = form();
      node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await tick();
    check(
      mode + ' pending creation locks every field',
      fields().length === (mode === 'ordinary' ? 4 : 3) &&
        fields().every((field) => field.disabled),
    );
    check(mode + ' synchronous submit guard accepts one request', posts.length === 1);
    const current = modal();
    await click(button('Cancel'));
    await act(async () =>
      current.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })),
    );
    check(mode + ' pending dialog cannot discard submitted draft', modal() === current);
    await finish(409);
    check(
      mode + ' refusal retains fields and enables editing',
      fields().every((field) => !field.disabled) &&
        form().querySelector('input[maxlength="160"]').value === 'Submitted title' &&
        form().querySelector('textarea').value === 'Submitted investigation scope' &&
        modal().textContent.includes('Synthetic creation refusal 409'),
    );
    await fill(form().querySelector('input[maxlength="160"]'), 'Corrected title');
    await fill(form().querySelector('textarea'), 'Corrected investigation scope');
    await submit();
    await finish(200);
    check(
      mode + ' successful retry saves the exact edited values',
      !modal() &&
        saved.length === 1 &&
        saved[0].title === 'Corrected title' &&
        saved[0].description === 'Corrected investigation scope',
    );
    await open(mode);
    await submit();
    await finish('unknown');
    check(
      mode + ' existing uncertainty warning and deliberate retry policy are preserved',
      fields().every((field) => !field.disabled) &&
        !button('Create investigation').disabled &&
        modal().textContent.includes('Check saved investigations before creating again') &&
        posts.length === 1,
    );
  }
  return { results, nativeCalls: 0, appliedWrites: 0 };
}
if (manual)
  root.render(
    <App mode={new URLSearchParams(location.search).has('profile') ? 'profile' : 'ordinary'} />,
  );
else
  suite()
    .then((report) => {
      document.getElementById('result').textContent = JSON.stringify(report, null, 2);
      return reportFetch('/_test/result', { method: 'POST', body: JSON.stringify(report) });
    })
    .catch((error) => {
      const report = {
        error: String(error),
        stack: error.stack,
        results,
        nativeCalls: 0,
        appliedWrites: 0,
      };
      document.getElementById('result').textContent = JSON.stringify(report, null, 2);
      reportFetch('/_test/result', { method: 'POST', body: JSON.stringify(report) });
    });
