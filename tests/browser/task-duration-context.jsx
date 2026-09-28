import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskCenter } from '../../src/features/tasks/TaskCenter';
import '../../src/styles.css';
import '../../src/operations.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = createRoot(document.getElementById('probe'));
const reportFetch = window.fetch.bind(window),
  results = [];
let mode = 'wall';
const at = '2026-09-28T12:00:00.000Z',
  task = { Id: 7, Name: 'Synthetic duration review', Namespace: 'USER' };
const source = (data) => ({ status: 'available', httpStatus: 200, observedAt: at, data });
const wall = {
  TaskId: 7,
  LastStart: '2026-09-28 10:00:00',
  Completed: '2026-09-28 10:02:00',
  Result: 'Success',
  Username: 'Wall',
};
const offset = {
  ...wall,
  LastStart: '2026-09-28T10:00:00Z',
  Completed: '2026-09-28T10:02:00Z',
  Username: 'Offset',
};
window.fetch = async (url) => {
  if (url === '/api/iris') return Response.json({ data: [task], status: 200, console: [] });
  if (url === '/api/task-center/7?limit=100')
    return Response.json({
      taskId: '7',
      startedAt: at,
      finishedAt: at,
      configuration: source({ Name: task.Name, TimePeriod: 'On Demand' }),
      state: source({ Suspended: false }),
      history: source(
        mode === 'offset'
          ? [offset]
          : mode === 'unmeasured'
            ? [{ ...wall, Completed: '' }]
            : mode === 'mixed'
              ? [wall, offset]
              : [wall],
      ),
      historyLimit: 100,
      historyMayBeLimited: false,
    });
  throw Error('Unexpected fixture request ' + url);
};
function Harness() {
  const [scenario, setScenario] = useState('wall');
  mode = scenario;
  return (
    <main style={{ padding: '1rem', minWidth: 0 }}>
      <p>Synthetic Task center fixture. No native reads or changes.</p>
      <label>
        Fixture scenario{' '}
        <select
          aria-label="Fixture scenario"
          value={scenario}
          onChange={(event) => setScenario(event.target.value)}
        >
          <option value="wall">Measured native wall times</option>
          <option value="offset">Offset-bearing times only</option>
          <option value="unmeasured">Unfinished wall-time record</option>
          <option value="mixed">Mixed measured records</option>
        </select>
      </label>
      <TaskCenter key={scenario} onManage={() => {}} />
    </main>
  );
}
const button = (text) =>
  [...document.querySelectorAll('button')].find(
    (node) =>
      node.textContent.trim() === text ||
      (text === task.Name && node.textContent.includes(task.Name)),
  );
async function settle(ready) {
  for (let i = 0; i < 100; i++) {
    if (ready()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw Error('Fixture did not settle');
}
async function click(text) {
  await settle(() => button(text) && !button(text).disabled);
  await act(async () => button(text).click());
}
async function history(scenario) {
  const select = document.querySelector('select[aria-label="Fixture scenario"]');
  await act(async () => {
    select.value = scenario;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click(task.Name);
  await click('Execution history');
}
async function filter(value) {
  const input = [...document.querySelectorAll('.task-filters label')]
    .find((node) => node.textContent.includes('Search result'))
    .querySelector('input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const notice = () => document.querySelector('.task-duration-notice');
function check(name, pass) {
  results.push({ name, pass: !!pass });
  if (!pass) throw Error(name);
}
async function suite() {
  await act(async () => root.render(<Harness />));
  if (location.search === '?manual') {
    document.getElementById('result').textContent =
      'Manual Task center fixture ready. Open task then Execution history.';
    return;
  }
  await history('wall');
  check(
    'Measured wall-time summary displays its existing clock-change caveat beside statistics',
    notice()?.textContent ===
      'Wall-clock difference; timezone and clock changes are not recorded.' &&
      document.querySelector('.task-stat-grid').nextElementSibling === notice(),
  );
  check(
    'Summary values, plot and native timestamps remain unchanged',
    document.querySelector('.task-stat-grid').textContent.includes('Median duration2.0 min') &&
      document.querySelector('.task-duration-plot') &&
      button(wall.LastStart),
  );
  await history('offset');
  check(
    'Offset-only measured durations have no wall-clock caveat',
    !notice() &&
      document.querySelector('.task-stat-grid').textContent.includes('Median duration2.0 min'),
  );
  await history('unmeasured');
  check(
    'Unmeasured wall timestamps do not produce a measured-duration caveat',
    !notice() && !document.querySelector('.task-duration-plot'),
  );
  await history('mixed');
  check('Mixed measured sample discloses that wall-clock differences contribute', !!notice());
  await filter('Offset');
  check(
    'Filtering out measured wall records removes their caveat while retaining measured offset data',
    !notice() &&
      document.querySelector('.task-stat-grid').textContent.includes('Median duration2.0 min') &&
      document.querySelector('.task-duration-plot'),
  );
  await filter('No matching actor');
  check(
    'No qualifying filtered records means no aggregate duration caveat or plot',
    !notice() &&
      !document.querySelector('.task-duration-plot') &&
      document.body.textContent.includes('No executions match'),
  );
}
suite()
  .then(async () => {
    if (location.search === '?manual') return;
    const report = { results, nativeCalls: 0, appliedWrites: 0 };
    document.getElementById('result').textContent = JSON.stringify(report, null, 2);
    await reportFetch('/_test/result', { method: 'POST', body: JSON.stringify(report) });
  })
  .catch(async (error) => {
    const report = {
      results,
      error: String(error),
      stack: error.stack,
      nativeCalls: 0,
      appliedWrites: 0,
    };
    document.getElementById('result').textContent = JSON.stringify(report, null, 2);
    await reportFetch('/_test/result', { method: 'POST', body: JSON.stringify(report) });
  });
