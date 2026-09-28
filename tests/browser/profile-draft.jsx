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
  writes = [];
const definition = profileInputSchema.parse(structuredClone(starterProfiles[0]));
const savedProfile = {
  ...definition,
  title: 'Saved review profile',
  version: 1,
  id: '11111111-1111-4111-8111-111111111111',
  owner: 'Fixture',
  instance: 'synthetic',
  revision: 3,
  status: 'active',
  history: [],
  createdAt: '2026-09-28T12:00:00Z',
  updatedAt: '2026-09-28T12:00:00Z',
};
let postStatus = 409,
  detailStatus = 200,
  hold = false,
  release,
  generation = 0;
window.fetch = async (url, options = {}) => {
  const writing = options.method === 'POST';
  if (writing) writes.push({ url, body: JSON.parse(options.body) });
  const status = writing ? postStatus : url.endsWith(savedProfile.id) ? detailStatus : 200;
  const value = writing
    ? { ...savedProfile, revision: 4 }
    : url.endsWith(savedProfile.id)
      ? savedProfile
      : { records: [profileSummary(savedProfile)], unreadable: [] };
  const respond = () =>
    Response.json(status === 200 ? value : { error: 'Synthetic refusal ' + status }, { status });
  if (writing && hold)
    return new Promise((resolve) => {
      release = () => resolve(respond());
    });
  return respond();
};
const root = createRoot(document.getElementById('probe'));
const modal = () => document.querySelector('#probe dialog');
const button = (name, scope = document.getElementById('probe')) =>
  [...scope.querySelectorAll('button')].find((node) => node.textContent.trim() === name);
const field = (label) =>
  [...modal().querySelectorAll('label')]
    .find((node) => node.textContent.trim().startsWith(label))
    ?.querySelector('input,textarea');
const check = (name, pass) => results.push({ name, pass: !!pass });
const click = async (node) => {
  if (!node) throw Error('Missing profile-draft control.');
  await act(async () => node.click());
};
async function settle(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw Error('Profile-draft fixture did not settle.');
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
async function open() {
  await click(button('Edit profile'));
}
async function reset() {
  postStatus = 409;
  detailStatus = 200;
  hold = false;
  writes.length = 0;
  await act(async () =>
    root.render(<InvestigationProfiles key={++generation} onStarted={() => {}} />),
  );
  const saved = () =>
    [...document.querySelectorAll('.record-choice')].find(
      (node) => node.querySelector('strong')?.textContent === savedProfile.title,
    );
  await settle(() => !!saved());
  await click(saved());
  await settle(() => !!button('Edit profile'));
  await open();
}
const cancelEvent = async () =>
  act(async () => modal().dispatchEvent(new Event('cancel', { cancelable: true })));
async function submit() {
  await act(async () =>
    modal()
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
async function suite() {
  await reset();
  await click(button('Cancel', modal()));
  check('unchanged profile closes immediately', !modal());
  await open();
  await fill('Title', 'Unsent operator profile');
  await fill('Reason for revision', 'Clarify follow-up ownership.');
  await fill('Purpose', 'Review the saved observations before handover.');
  await click(button('Cancel', modal()));
  check(
    'dirty Cancel offers explicit keep or discard with safe default focus',
    modal()?.textContent.includes('Discard profile draft?') &&
      document.activeElement === button('Keep editing', modal()),
  );
  await click(button('Keep editing', modal()));
  check(
    'Keep editing retains title, purpose and revision reason',
    field('Title').value === 'Unsent operator profile' &&
      field('Purpose').value === 'Review the saved observations before handover.' &&
      field('Reason for revision').value === 'Clarify follow-up ownership.',
  );
  await cancelEvent();
  check('modal cancel event uses the same dirty guard', !!button('Discard draft', modal()));
  await cancelEvent();
  check(
    'canceling discard returns an open editor with the draft intact',
    modal().open && modal().matches(':modal') && field('Title').value === 'Unsent operator profile',
  );
  await click(modal().querySelector('[title="Close dialog"]'));
  check('close icon also requires explicit discard', !!button('Discard draft', modal()));
  await click(button('Discard draft', modal()));
  await open();
  check(
    'explicit discard reopens saved values',
    field('Title').value === savedProfile.title &&
      field('Reason for revision').value === '' &&
      writes.length === 0,
  );
  await fill('Reason for revision', 'Reason-only edit');
  await click(button('Cancel', modal()));
  check('revision reason alone is an unsaved change', !!button('Keep editing', modal()));
  await click(button('Keep editing', modal()));
  await fill('Reason for revision', '');
  await fill('Title', 'Temporary name');
  await fill('Title', savedProfile.title);
  await click(button('Cancel', modal()));
  check('reverting fields and reason removes the dirty prompt', !modal());
  await open();
  const source = modal().querySelector('.profile-source-fieldset input');
  const before = source.checked;
  await click(source);
  await click(button('Cancel', modal()));
  await click(button('Keep editing', modal()));
  check(
    'source selection is retained through the guard',
    modal().querySelector('.profile-source-fieldset input').checked === !before,
  );
  await reset();
  await fill('Title', 'Pending save draft');
  await fill('Reason for revision', 'Update checklist.');
  hold = true;
  const form = modal().querySelector('form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    modal().dispatchEvent(new Event('cancel', { cancelable: true }));
    modal().querySelector('[title="Close dialog"]').click();
  });
  check(
    'pending save blocks duplicate dispatch and close before rerender',
    writes.length === 1 && !!modal().querySelector('form') && !button('Discard draft', modal()),
  );
  await act(async () => release());
  await settle(() => !!modal().querySelector('[role="alert"]'));
  check(
    'refused save retains draft and original target/revision',
    field('Title').value === 'Pending save draft' &&
      field('Reason for revision').value === 'Update checklist.' &&
      writes[0].url.endsWith(savedProfile.id + '/revise') &&
      writes[0].body.revision === 3,
  );
  await click(button('Cancel', modal()));
  check(
    'refused save does not make the dirty draft disposable',
    !!button('Discard draft', modal()),
  );
  await click(button('Keep editing', modal()));
  hold = false;
  postStatus = 200;
  await submit();
  await settle(() => !modal());
  check('confirmed save closes without a discard prompt', !modal() && writes.length === 2);
  await reset();
  await fill('Title', 'Draft with revoked source');
  await fill('Reason for revision', 'Investigate.');
  postStatus = 403;
  detailStatus = 403;
  await submit();
  await settle(() => !modal());
  check(
    'confirmed source denial removes dirty editor without a discard guard',
    !modal() && !button('Export') && writes.length === 1,
  );
  await click(button('New profile'));
  await fill('Title', 'New independent draft');
  await click(button('Cancel', modal()));
  check('new profile drafts receive the same protection', !!button('Discard draft', modal()));
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
      'Actual parent/editor with synthetic fetch. Cancel events exercise handlers; native Escape and responsive layout require separate browser checks.',
  };
  document.getElementById('result').textContent = JSON.stringify(report, null, 2);
  await reportFetch('/_test/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
})();
