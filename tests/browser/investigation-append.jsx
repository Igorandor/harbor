import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
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
async function state() {
  return (await transport('/_test/state')).json();
}
async function reset(kind, mode) {
  await transport('/_test/reset', { method: 'POST', body: JSON.stringify({ mode }) });
  await act(async () => root.render(<Investigations key={++generation} />));
  await settle(() => document.querySelector('.record-choice'));
  await click(document.querySelector('.record-choice'));
  await settle(() => document.querySelector('.record-workbench'));
  if (kind === 'captures') await click(button('Captures'));
  await fill(
    field(kind),
    kind === 'notes' ? 'Synthetic operator handover note' : 'Synthetic before maintenance',
  );
}
async function save(kind) {
  await act(async () =>
    field(kind)
      .closest('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await settle(() => !field(kind)?.disabled);
}
const results = [];
function check(name, pass) {
  results.push({ name, pass: !!pass });
}
(async () => {
  for (const kind of ['notes', 'captures']) {
    const draft =
      kind === 'notes' ? 'Synthetic operator handover note' : 'Synthetic before maintenance';
    const section = kind === 'notes' ? 'Timeline' : 'Captures';
    for (const mode of ['committed503', 'unreadable200']) {
      await reset(kind, mode);
      await save(kind);
      check(
        `${kind} ${mode}: failed append focuses the recovery message`,
        document.activeElement === document.querySelector('[role="alert"]')?.parentElement,
      );
      field(kind).focus();
      await fill(field(kind), draft + ' edited');
      check(
        `${kind} ${mode}: typing keeps focus in the draft`,
        document.activeElement === field(kind),
      );
      await fill(field(kind), draft);
      const first = await state(),
        message = document.querySelector('[role="alert"]')?.textContent || '';
      check(
        `${kind} ${mode}: committed once, draft and read-before-repeat guidance retained`,
        first.writes === 1 &&
          first.requests.filter((r) => r.method === 'POST').length === 1 &&
          field(kind).value === draft &&
          message.includes('Could not confirm whether') &&
          message.includes(section) &&
          message.includes(
            mode === 'committed503' ? 'Synthetic response unavailable' : 'unreadable response',
          ),
      );
      await save(kind);
      const repeated = await state();
      check(
        `${kind} ${mode}: stale revision prevents duplicate append or diagnostic recollection`,
        repeated.writes === 1 &&
          repeated.diagnosticReads === first.diagnosticReads &&
          repeated.noteCount === first.noteCount &&
          repeated.captureCount === first.captureCount &&
          document.querySelector('[role="alert"]').textContent.includes('Refresh before saving'),
      );
      field(kind).focus();
      await save(kind);
      const sameError = await state();
      check(
        `${kind} ${mode}: repeated identical conflict refocuses the message without another write`,
        document.activeElement === document.querySelector('[role="alert"]')?.parentElement &&
          sameError.writes === 1 &&
          sameError.diagnosticReads === first.diagnosticReads,
      );
      await click(
        [...document.querySelectorAll('.record-workbench button')].find(
          (node) => node.textContent.trim() === 'Refresh',
        ),
      );
      const refreshed = await state();
      check(
        `${kind} ${mode}: explicit same-case read shows stored entry and preserves draft`,
        refreshed.revision === 2 &&
          refreshed.writes === 1 &&
          field(kind).value === draft &&
          document.querySelector('.record-workbench').textContent.includes(draft),
      );
    }
    await reset(kind, 'known-save-list503');
    await save(kind);
    const saved = await state(),
      message = document.querySelector('[role="alert"]')?.textContent || '';
    check(
      `${kind}: confirmed save followed by list503 is reported as saved`,
      saved.writes === 1 &&
        message.includes('Investigation saved. Could not refresh the list:') &&
        !message.includes('Could not confirm'),
    );
    check(
      `${kind}: confirmed saved draft clears and persisted entry remains`,
      field(kind).value === '' &&
        document.querySelector('.record-workbench').textContent.includes(draft),
    );
  }
  const report = { results, nativeCalls: 0, durableWrites: 0 };
  document.getElementById('result').textContent = JSON.stringify(report, null, 2);
  await transport('/_test/result', { method: 'POST', body: JSON.stringify(report) });
})().catch(async (error) => {
  const report = { results, error: error.stack, nativeCalls: 0, durableWrites: 0 };
  document.getElementById('result').textContent = JSON.stringify(report, null, 2);
  await transport('/_test/result', { method: 'POST', body: JSON.stringify(report) });
});
