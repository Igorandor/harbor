import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EvidenceWorkbench } from '../../src/components/EvidenceWorkbench';
import { captureWindowNotice } from '../../shared/evidence-comparison';
import { windowRecord } from './capture-window-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = createRoot(document.getElementById('probe')),
  results = [],
  blobs = [];
const originalCreate = URL.createObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
  blobs.push(blob);
  return originalCreate(blob);
};
document.addEventListener(
  'click',
  (event) => {
    if (event.target.closest?.('a[download]')) event.preventDefault();
  },
  true,
);
const check = (name, pass) => results.push({ name, pass: !!pass });
const button = (name) =>
  [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === name);
const tick = () => act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
async function click(node) {
  await act(async () => node.click());
  await tick();
}
(async () => {
  await act(async () =>
    root.render(
      <EvidenceWorkbench
        record={windowRecord()}
        busy={false}
        onChange={async () => {
          throw Error('No writes allowed');
        }}
      />,
    ),
  );
  await tick();
  const guidance = [...document.querySelectorAll('.notice')].find(
    (node) => node.textContent === captureWindowNotice,
  );
  check(
    'Captured-value boundary is visible outside collapsed disclosures',
    guidance && !guidance.closest('details'),
  );
  const scope = [...document.querySelectorAll('details')].find(
    (node) => node.querySelector('summary')?.textContent === 'Comparison scope and limits',
  );
  await click(scope.querySelector('summary'));
  check(
    'Input limits keep earlier/later provenance and per-side deduplication',
    scope.open &&
      scope.textContent.includes('Earlier capture: Lists request at most 100 rows') &&
      scope.textContent.includes('Later capture: Lists request at most 100 rows') &&
      scope.textContent.split('Earlier capture: Shared bounded input').length === 2 &&
      scope.textContent.split('Later capture: Shared bounded input').length === 2,
  );
  const source = document.querySelector('.evidence-source');
  await click(source.querySelector('summary'));
  check(
    'Collected source notices retain their provenance and observation times',
    source.open &&
      source.textContent.includes('Earlier: Earlier source window') &&
      source.textContent.includes('Later: Later source <em') &&
      source.querySelectorAll('dd').length === 3,
  );
  await click(button('JSON report'));
  const json = JSON.parse(await blobs.at(-1).text());
  check(
    'Actual JSON export retains window context with unchanged difference identities',
    json.comparison.differenceCount === 2 &&
      json.comparison.limitedCount === 0 &&
      json.comparison.notices.includes(captureWindowNotice) &&
      json.comparison.sources[0].differences.some(
        (row) => row.id === 'tasks:1' && row.path === '/@Id=100' && row.kind === 'removed',
      ),
  );
  await click(button('Printable report'));
  const html = await blobs.at(-1).text();
  check(
    'Actual HTML export retains and escapes input limits and collected-source notices',
    html.includes('Earlier capture: Lists request at most 100 rows') &&
      html.includes('Later capture: Later log window') &&
      html.includes('&lt;b data-qa-limit=') &&
      html.includes('&lt;em data-qa-source=') &&
      !html.includes('<b data-qa-limit=') &&
      !html.includes('<em data-qa-source='),
  );
  check(
    'Captured limits and source notices stay inert in the live UI',
    !document.querySelector('[data-qa-limit]') && !document.querySelector('[data-qa-source]'),
  );
  await act(async () =>
    root.render(
      <EvidenceWorkbench
        key="unchanged"
        record={windowRecord(true)}
        busy={false}
        onChange={async () => {
          throw Error('No writes allowed');
        }}
      />,
    ),
  );
  await tick();
  check(
    'An unchanged sample retains input bounds and does not become a healthy verdict',
    document.querySelector('.evidence-source summary').textContent.includes('unchanged') &&
      document
        .getElementById('probe')
        .textContent.includes('No differences were retained in comparable sources') &&
      document.getElementById('probe').textContent.includes(captureWindowNotice) &&
      document
        .getElementById('probe')
        .textContent.includes('Earlier capture: Lists request at most 100 rows'),
  );
  const report = { results, nativeCalls: 0, appliedWrites: 0 };
  document.getElementById('result').textContent = JSON.stringify(report, null, 2);
  await fetch('/_test/result', { method: 'POST', body: JSON.stringify(report) });
})().catch(async (error) => {
  const report = { results, error: error.stack, nativeCalls: 0, appliedWrites: 0 };
  document.getElementById('result').textContent = JSON.stringify(report, null, 2);
  await fetch('/_test/result', { method: 'POST', body: JSON.stringify(report) });
});
