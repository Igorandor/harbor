import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { resetDraftFixture, setDraftMode, draftCalls } from './investigation-draft-fixture';
import { InvestigationChecklist } from '../../src/components/InvestigationChecklist';
import { Investigations } from '../../src/pages/Investigations';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const transport = window.fetch.bind(window),
  root = createRoot(document.getElementById('probe'));
let generation = 0;
const buttons = (name) =>
  [...document.querySelectorAll('#probe button')].filter(
    (node) => node.textContent.trim() === name,
  );
const button = (name) => buttons(name)[0];
const field = (kind) =>
  document.querySelector(
    kind === 'notes' ? '.record-workbench textarea' : '.record-workbench input[maxlength="120"]',
  );
async function tick() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 15)));
}
async function click(node) {
  if (!node) throw Error('Missing investigation control');
  await act(async () => node.click());
  await tick();
}
async function settle(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await tick();
  }
  throw Error('Investigation fixture did not settle');
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
const drafts = {
  Timeline: 'Unfinished timeline analysis',
  Status: 'Status rationale',
  'Related changes': 'Link context',
};
const results = [];
function check(name, pass) {
  results.push({ name, pass: !!pass });
}
async function open(mode = 'normal') {
  resetDraftFixture(mode);
  await act(async () => root.render(<Investigations key={++generation} />));
  await settle(() => document.querySelector('.record-choice'));
  await click(document.querySelector('.record-choice'));
  await settle(() => document.querySelector('.record-workbench'));
}
async function populate() {
  let empty = true;
  for (const [tab, value] of Object.entries(drafts)) {
    await click(button(tab));
    empty &&= field('notes').value === '';
    await fill(field('notes'), value);
  }
  await fill(
    document.querySelector('.record-workbench input[maxlength="36"]'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  );
  return empty;
}
async function save() {
  await act(async () =>
    field('notes')
      .closest('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await settle(() => !field('notes').disabled);
}
let finishChecklist;
function ChecklistProbe() {
  const [record, setRecord] = useState({
      status: 'open',
      checklist: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          title: 'Review backup result',
          instruction: 'Read the latest backup record.',
          required: true,
          state: 'open',
        },
      ],
    }),
    [busy, setBusy] = useState(false);
  return (
    <InvestigationChecklist
      record={record}
      busy={busy}
      onUpdate={async (id, state, note) => {
        setBusy(true);
        const success = await new Promise((resolve) => (finishChecklist = resolve));
        if (success)
          setRecord({
            ...record,
            checklist: [
              {
                ...record.checklist[0],
                state,
                note,
                updatedAt: '2026-09-28T12:01:00Z',
                updatedBy: 'Synthetic operator',
              },
            ],
          });
        setBusy(false);
        return success;
      }}
    />
  );
}
(async () => {
  let first = true;
  for (const operation of Object.keys(drafts))
    for (const success of [true, false]) {
      await open(success ? 'normal' : 'conflict');
      const empty = await populate();
      if (first) {
        check('Opening another form does not copy the preceding unsaved text', empty);
        first = false;
      }
      await click(button(operation));
      await save();
      if (!success && operation !== 'Timeline') {
        check(
          `${operation}: refusal focuses the error`,
          document.activeElement === document.querySelector('[role="alert"]')?.parentElement,
        );
        field('notes').focus();
        await fill(field('notes'), drafts[operation] + ' edited');
        check(
          `${operation}: typing does not refocus the error`,
          document.activeElement === field('notes'),
        );
        await fill(field('notes'), drafts[operation]);
        await save();
        check(
          `${operation}: identical repeated refusal refocuses the error`,
          document.activeElement === document.querySelector('[role="alert"]')?.parentElement,
        );
      }
      const action =
        operation === 'Timeline' ? 'notes' : operation === 'Status' ? 'status' : 'changes';
      const call = draftCalls().find((call) => call.method === 'POST');
      check(
        `${operation} ${success}: submits only its own draft`,
        call?.url.endsWith('/' + action) &&
          call.body[action === 'notes' ? 'text' : action === 'status' ? 'reason' : 'note'] ===
            drafts[operation],
      );
      let preserved = true;
      for (const [tab, value] of Object.entries(drafts)) {
        await click(button(tab));
        preserved &&= field('notes').value === (success && tab === operation ? '' : value);
      }
      check(`${operation} ${success}: only a confirmed save clears that form`, preserved);
    }
  await open();
  await populate();
  setDraftMode('denied');
  await click(
    [...document.querySelectorAll('.record-workbench button')].find(
      (node) => node.textContent.trim() === 'Refresh',
    ),
  );
  await settle(() => !document.querySelector('.record-workbench textarea'));
  check(
    'Denied case read removes the workbench and all three protected drafts',
    !document.querySelector('.record-workbench textarea') && !button('Export investigation'),
  );
  await open('conflict');
  await click(button('Checklist'));
  await fill(document.querySelector('.checklist-row textarea'), 'Check backup before proceeding');
  await save();
  check(
    'Checklist: refusal focuses the error',
    document.activeElement === document.querySelector('[role="alert"]')?.parentElement,
  );
  field('notes').focus();
  await fill(field('notes'), 'Check backup before proceeding edited');
  check('Checklist: typing does not refocus the error', document.activeElement === field('notes'));
  await save();
  check(
    'Checklist: identical repeated refusal refocuses the error',
    document.activeElement === document.querySelector('[role="alert"]')?.parentElement,
  );
  for (const success of [true, false]) {
    await act(async () => root.render(<ChecklistProbe key={++generation} />));
    const select = () => document.querySelector('#probe select'),
      textarea = () => document.querySelector('#probe textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(
        select(),
        'completed',
      );
      select().dispatchEvent(new Event('change', { bubbles: true }));
    });
    await fill(textarea(), 'Submitted backup observation');
    await click(button('Record outcome'));
    check(
      `Checklist ${success}: outcome and note cannot be edited while saving`,
      select().disabled && textarea().disabled && button('Record outcome').disabled,
    );
    await act(async () => finishChecklist(success));
    await tick();
    check(
      `Checklist ${success}: completion restores editable fields with the submitted draft`,
      !select().disabled &&
        !textarea().disabled &&
        select().value === 'completed' &&
        textarea().value === 'Submitted backup observation' &&
        (success
          ? document.querySelector('.checklist-heading').textContent.includes('completed')
          : document.querySelector('.checklist-heading').textContent.includes('open')),
    );
  }
  const report = { results, nativeCalls: 0, appliedWrites: 0 };
  document.getElementById('result').textContent = JSON.stringify(report, null, 2);
  await transport('/_test/result', { method: 'POST', body: JSON.stringify(report) });
})().catch(async (error) => {
  const report = { results, error: error.stack, nativeCalls: 0, appliedWrites: 0 };
  document.getElementById('result').textContent = JSON.stringify(report, null, 2);
  await transport('/_test/result', { method: 'POST', body: JSON.stringify(report) });
});
