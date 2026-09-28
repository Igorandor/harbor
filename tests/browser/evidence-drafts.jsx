import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EvidenceWorkbench } from '../../src/components/EvidenceWorkbench';
import { reviewDraftRecord, savedReviewDraft, decidedRecord } from './evidence-drafts-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = createRoot(document.getElementById('probe')),
  results = [],
  calls = [];
let record,
  busy = false,
  release,
  generation = 0;
const check = (name, pass) => results.push({ name, pass: Boolean(pass) });
const button = (label) =>
  [...document.querySelectorAll('#probe button')].find((node) => node.textContent.trim() === label);
const field = (label) =>
  [...document.querySelectorAll('#probe label')]
    .find((node) => node.textContent.trim().startsWith(label))
    ?.querySelector('textarea,input,select');
const render = () =>
  root.render(
    <EvidenceWorkbench
      key={generation}
      record={record}
      busy={busy}
      onChange={async (action, input) => {
        calls.push({ action, input });
        busy = true;
        render();
        return new Promise((resolve) => {
          release = (success) => {
            if (success) record = savedReviewDraft(record, action, input);
            busy = false;
            render();
            resolve(success);
          };
        });
      }}
    />,
  );
async function reset(value) {
  record = value;
  busy = false;
  generation++;
  await act(async () => render());
}
async function click(label) {
  await act(async () => button(label).click());
}
async function set(label, value) {
  const node = field(label);
  if (node.disabled) throw Error('Fixture attempted to edit a disabled field');
  await act(async () => {
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : node instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}
async function finish(success) {
  await act(async () => release(success));
}
async function suite() {
  await reset(reviewDraftRecord(false));
  await set('Review title', 'Review operator intent');
  await click('Start evidence review');
  check(
    'Pending creation locks title and both capture selectors',
    ['Review title', 'Earlier capture', 'Later capture'].every((label) =>
      field(label).matches(':disabled'),
    ),
  );
  await finish(false);
  check(
    'Failed creation retains title and re-enables editing',
    field('Review title').value === 'Review operator intent' && !field('Review title').disabled,
  );
  await click('Start evidence review');
  await finish(true);
  check(
    'Successful creation records submitted title and original pair',
    record.evidenceReviews[0].title === 'Review operator intent' &&
      record.evidenceReviews[0].beforeId === record.captures[0].id &&
      !field('Review title'),
  );
  await click('Record decision');
  await set('Decision', 'expected');
  await set('Evidence or reasoning', 'Evidence submitted by operator');
  await click('Save decision');
  check(
    'Pending decision locks disposition and reasoning',
    field('Decision').matches(':disabled') && field('Evidence or reasoning').matches(':disabled'),
  );
  await finish(false);
  check(
    'Failed decision preserves both values and re-enables fields',
    field('Decision').value === 'expected' &&
      field('Evidence or reasoning').value === 'Evidence submitted by operator' &&
      !field('Decision').disabled &&
      !field('Evidence or reasoning').disabled,
  );
  await click('Save decision');
  await finish(true);
  check(
    'Successful decision displays only the submitted reasoning',
    document.querySelector('.evidence-decision p').textContent ===
      'Evidence submitted by operator' && !field('Evidence or reasoning'),
  );
  await click('Revise decision');
  check(
    'Reopened decision loads the saved disposition and note',
    field('Decision').value === 'expected' &&
      field('Evidence or reasoning').value === 'Evidence submitted by operator',
  );
  await click('Cancel');
  await set('Conclusion', 'Concluded from captured evidence');
  await act(async () => field('I reviewed source availability').click());
  await click('Conclude review');
  check(
    'Pending conclusion locks text and acknowledgement',
    field('Conclusion').matches(':disabled') &&
      field('I reviewed source availability').matches(':disabled'),
  );
  await finish(false);
  check(
    'Failed conclusion keeps text and acknowledgement',
    field('Conclusion').value === 'Concluded from captured evidence' &&
      field('I reviewed source availability').checked &&
      !field('Conclusion').disabled &&
      !field('I reviewed source availability').disabled,
  );
  await click('Conclude review');
  await finish(true);
  check(
    'Successful conclusion shows submitted text',
    document.querySelector('.evidence-conclusion blockquote').textContent ===
      'Concluded from captured evidence' && !field('Conclusion'),
  );
  await set('Reason for reopening', 'Recheck the changed source');
  await click('Reopen review');
  check('Pending reopen locks its reason', field('Reason for reopening').matches(':disabled'));
  await finish(false);
  check(
    'Failed reopen retains its reason and permits correction',
    field('Reason for reopening').value === 'Recheck the changed source' &&
      !field('Reason for reopening').disabled,
  );
  await click('Reopen review');
  await finish(true);
  check(
    'Successful reopen returns an empty enabled conclusion form',
    field('Conclusion').value === '' &&
      !field('Conclusion').disabled &&
      !record.evidenceReviews[0].conclusion,
  );
  check(
    'All attempts stay on the same review and original difference identity',
    calls
      .filter((call) => call.action.endsWith('/decisions'))
      .every(
        (call) =>
          call.action === `evidence-reviews/${record.evidenceReviews[0].id}/decisions` &&
          call.input.differenceId === record.evidenceReviews[0].decisions[0].differenceId,
      ),
  );
  await reset(decidedRecord());
  const originalPair = [field('Earlier capture').value, field('Later capture').value];
  const extra = structuredClone(record.captures[1]);
  extra.id = '55555555-5555-4555-8555-555555555555';
  record = { ...record, captures: [...record.captures, extra] };
  await act(async () => render());
  check(
    'New capture does not move the selected pair or its saved decision',
    field('Earlier capture').value === originalPair[0] &&
      field('Later capture').value === originalPair[1] &&
      document.querySelector('.evidence-decision p').textContent ===
        'Expected synthetic counter change',
  );
  await set('Later capture', extra.id);
  check(
    'Different pair does not inherit saved annotations',
    !document.querySelector('.evidence-decision') && Boolean(field('Review title')),
  );
}
suite()
  .then(report)
  .catch((error) => report(error));
async function report(error) {
  const data = {
    results,
    nativeCalls: 0,
    appliedWrites: 0,
    ...(error ? { error: String(error), stack: error.stack } : {}),
  };
  document.getElementById('result').textContent = JSON.stringify(data, null, 2);
  await fetch('/_test/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
