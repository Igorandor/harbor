import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EvidenceWorkbench } from '../../src/components/EvidenceWorkbench';
import { compareEvidence, comparisonReport } from '../../shared/evidence-comparison';
import { orderingCase } from './evidence-ordering-fixture';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const results = [],
  changes = [];
const record = orderingCase(),
  original = JSON.stringify(record);
const notice =
  'The selected earlier capture did not finish before the later capture. Check capture ordering.';
const root = createRoot(document.getElementById('probe'));
const check = (name, pass) => results.push({ name, pass: !!pass });
const select = (label) =>
  [...document.querySelectorAll('#probe label')]
    .find((node) => node.textContent.trim().startsWith(label))
    ?.querySelector('select');
const warning = () =>
  [...document.querySelectorAll('#probe [role="status"]')].find(
    (node) => node.textContent === notice,
  );
const delta = () => document.querySelector('.evidence-delta')?.textContent;
async function choose(label, value) {
  await act(async () => {
    const node = select(label);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function suite() {
  await act(async () =>
    root.render(
      <EvidenceWorkbench
        record={record}
        busy={false}
        onChange={async (...args) => {
          changes.push(args);
          return true;
        }}
      />,
    ),
  );
  check(
    'chronological pair shows positive delta without ordering warning',
    delta() === 'Numeric difference: +10' && !warning(),
  );
  await choose('Saved review', 'reverse-review');
  check(
    'saved reverse review preserves selected pair and negative delta',
    select('Earlier capture').value === 'newer' &&
      select('Later capture').value === 'older' &&
      delta() === 'Numeric difference: -10',
  );
  check(
    'reverse pair warning is exposed outside collapsed scope details',
    warning() &&
      !warning().closest('details') &&
      !document.querySelector('details.scope-note').open,
  );
  check(
    'ordering warning appears once while ordinary limits stay collapsed',
    document.querySelector('#probe').textContent.split(notice).length === 2 &&
      document.querySelector('details.scope-note').textContent.includes('not an atomic snapshot'),
  );
  await choose('Later capture', 'same-time');
  check(
    'equal finishing times also expose the existing warning',
    !!warning() && delta() === 'Numeric difference: +5',
  );
  await choose('Earlier capture', 'older');
  check(
    'correcting the pair removes warning and updates delta',
    !warning() && delta() === 'Numeric difference: +15',
  );
  await choose('Later capture', 'older');
  check(
    'same capture shows selection guidance without stale ordering warning',
    !warning() &&
      !delta() &&
      document.querySelector('#probe').textContent.includes('Choose two different captures.'),
  );
  await choose('Earlier capture', 'newer');
  check(
    'manual reverse selection exposes warning without swapping values',
    !!warning() &&
      select('Earlier capture').value === 'newer' &&
      select('Later capture').value === 'older' &&
      delta() === 'Numeric difference: -10',
  );
  const comparison = compareEvidence(record.captures[2], record.captures[1]);
  check(
    'export model preserves reverse direction and chronological notice',
    comparison.beforeId === 'newer' &&
      comparison.afterId === 'older' &&
      comparison.sources[0].differences[0].numericDelta === -10 &&
      comparison.notices.includes(notice),
  );
  check('HTML report retains the ordering notice', comparisonReport(comparison).includes(notice));
  check(
    'inspection and selection do not save or mutate captured evidence',
    changes.length === 0 && original === JSON.stringify(record),
  );
}
let error;
try {
  await suite();
} catch (caught) {
  error = caught.stack || String(caught);
}
const report = { results, error, nativeCalls: 0, appliedWrites: changes.length };
document.getElementById('result').textContent = JSON.stringify(report, null, 2);
await fetch('/_test/result', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(report),
});
