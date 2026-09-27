import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Download,
  Gauge,
  GitCompareArrows,
  HardDrive,
  Lock,
  RefreshCw,
  Server,
} from 'lucide-react';
import { download, request } from '../api';
import { DataValue } from '../components/DataView';
import { ErrorBox, Loading, PageHeader } from '../components/ui';
import {
  capacityPoint,
  compareProcesses,
  defaultRuntimeThresholds,
  groupLocks,
  parseProcessState,
  runtimeData,
  runtimeFindings,
  type RuntimeSample,
  type RuntimeSource,
  type RuntimeThresholds,
  type CapacityPoint,
} from '../../shared/runtime-analysis';

type SavedSample = { id: string; sample: RuntimeSample };
const sourceNames: Record<RuntimeSource, string> = {
  identity: 'Instance identity',
  host: 'Host capacity',
  health: 'System dashboard',
  processes: 'Process inventory',
  locks: 'Lock table',
  usage: 'System usage',
  license: 'License usage',
};
export function RuntimeWorkbench({ onManage }: { onManage: () => void }) {
  const [samples, setSamples] = useState<SavedSample[]>([]),
    [selected, setSelected] = useState(''),
    [baseline, setBaseline] = useState('');
  const [sources, setSources] = useState<RuntimeSource[]>([
    'identity',
    'host',
    'health',
    'processes',
    'locks',
    'usage',
  ]);
  const [pids, setPids] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [follow, setFollow] = useState(false);
  const [view, setView] = useState('capacity'),
    [thresholds, setThresholds] = useState(defaultRuntimeThresholds);
  const [search, setSearch] = useState(''),
    [processId, setProcessId] = useState<number>();
  const alive = useRef(true),
    loading = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function capture() {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    setError('');
    try {
      const sample = await request<RuntimeSample>('runtime-samples', { sources, pids });
      if (!alive.current) return;
      const saved = { id: crypto.randomUUID(), sample };
      setSamples((previous) => [...previous, saved].slice(-12));
      setSelected(saved.id);
    } catch (error) {
      if (alive.current) setError((error as Error).message);
    } finally {
      loading.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!follow) return;
    const timer = setInterval(() => {
      if (!document.hidden && !loading.current) void capture();
    }, 15000);
    return () => clearInterval(timer);
  }, [follow, sources, pids]);
  const current = samples.find((item) => item.id === selected) ?? samples.at(-1),
    prior = samples.find((item) => item.id === baseline);
  const index = current ? samples.findIndex((item) => item.id === current.id) : -1;
  const previous = prior?.sample ?? (index > 0 ? samples[index - 1].sample : undefined);
  const points = useMemo(
    () =>
      samples.map((item, index) =>
        capacityPoint(item.sample, index ? samples[index - 1].sample : undefined),
      ),
    [samples],
  );
  const point = current ? capacityPoint(current.sample, previous) : undefined;
  const findings = useMemo(
    () => (current ? runtimeFindings(current.sample, thresholds, previous) : []),
    [current, thresholds, previous],
  );
  const comparisons = useMemo(
    () => (current && previous ? compareProcesses(previous, current.sample) : []),
    [current, previous],
  );
  const locks = useMemo(() => (current ? groupLocks(current.sample) : []), [current]);
  const inventory = current ? runtimeData<any[]>(current.sample, 'processes') : [];
  const rows = (Array.isArray(inventory) ? inventory : []).filter((row) =>
    JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
  );
  const detail = current?.sample.processDetails.find((item) => item.pid === processId);
  const host = current ? runtimeData(current.sample, 'host') : undefined;
  return (
    <>
      <PageHeader
        title="Runtime analysis"
        description="Compare bounded samples of capacity, processes and locks."
      >
        <button
          disabled={busy || !sources.length}
          className="primary"
          onClick={() => void capture()}
        >
          <RefreshCw size={16} className={busy ? 'spin' : ''} />
          {busy ? 'Collecting…' : 'Capture runtime'}
        </button>
        <button
          disabled={!current}
          onClick={() =>
            current &&
            download(
              'harbor-runtime-' + current.sample.finishedAt.replaceAll(':', '-') + '.json',
              current.sample,
            )
          }
        >
          <Download size={16} /> Export sample
        </button>
      </PageHeader>
      {error ? <ErrorBox error={error} /> : null}
      <details className="panel padded" open={!samples.length}>
        <summary>Capture sources and thresholds</summary>
        <div className="diagnostic-sources">
          {Object.entries(sourceNames).map(([id, label]) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={sources.includes(id as RuntimeSource)}
                disabled={busy}
                onChange={(event) =>
                  setSources(
                    event.target.checked
                      ? [...sources, id as RuntimeSource]
                      : sources.filter((value) => value !== id),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
            disabled={!sources.length}
          />{' '}
          Capture every 15 seconds while this tab is visible
        </label>
        <div className="runtime-thresholds">
          {(
            [
              ['memoryUsed', 'Host memory used (%)', 1, 100],
              ['diskUsed', 'Manager-volume disk used (%)', 1, 100],
              ['loadPerCpu', 'Load per logical CPU', 0.1, 100],
              ['processCpuMsPerSecond', 'Process CPU milliseconds/second', 1, 100000],
            ] as const
          ).map(([id, label, min, max]) => (
            <label className="field" key={id}>
              {label}
              <input
                type="number"
                min={min}
                max={max}
                step={id === 'loadPerCpu' ? 0.1 : 1}
                value={thresholds[id]}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value >= min && value <= max)
                    setThresholds((current) => ({ ...current, [id]: value }));
                }}
              />
            </label>
          ))}
        </div>
        <p className="scope-note">
          Thresholds are review aids for this browser session. They do not configure IRIS alerts. Up
          to 12 samples and 12 selected process details are retained in memory; export before
          leaving this page.
        </p>
      </details>
      {busy && !current ? <Loading /> : null}
      {current ? (
        <>
          <section className="panel runtime-sample-selector">
            <label className="field">
              Sample
              <select value={current.id} onChange={(event) => setSelected(event.target.value)}>
                {samples.map((item) => (
                  <option key={item.id} value={item.id}>
                    {new Date(item.sample.finishedAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Comparison baseline
              <select value={baseline} onChange={(event) => setBaseline(event.target.value)}>
                <option value="">Previous sample</option>
                {samples
                  .filter((item) => item.id !== current.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {new Date(item.sample.finishedAt).toLocaleString()}
                    </option>
                  ))}
              </select>
            </label>
            <span>{current.sample.instance}</span>
          </section>
          <nav className="tabs" aria-label="Runtime views">
            {[
              ['capacity', 'Capacity', Gauge],
              ['processes', 'Processes', Server],
              ['rates', 'Counter changes', GitCompareArrows],
              ['locks', 'Lock owners', Lock],
              ['findings', 'Review findings', Activity],
              ['sources', 'Source records', HardDrive],
            ].map(([id, label, Icon]) => (
              <button
                key={String(id)}
                aria-pressed={view === id}
                className={view === id ? 'active' : ''}
                onClick={() => setView(String(id))}
              >
                {typeof Icon !== 'string' ? <Icon size={16} /> : null}
                {String(label)}
              </button>
            ))}
          </nav>
          {view === 'capacity' ? (
            <>
              <div className="runtime-metrics">
                <CapacityMetric
                  title="Host CPU busy"
                  value={point?.cpuBusyPercent}
                  unit="%"
                  note="Two valid host counter samples required"
                />
                <CapacityMetric
                  title="Host memory used"
                  value={point?.memoryUsedPercent}
                  unit="%"
                  note="Total minus available host memory"
                />
                <CapacityMetric
                  title="Manager-volume disk used"
                  value={point?.diskUsedPercent}
                  unit="%"
                  note={String(host?.disk?.path ?? 'Host filesystem containing the IRIS manager')}
                />
                <CapacityMetric
                  title="One-minute load"
                  value={point?.loadOne}
                  unit=""
                  note={`${host?.cpu?.logicalCount ?? 'Unknown'} logical CPUs`}
                />
              </div>
              <section className="panel padded">
                <h2>Sample history</h2>
                <p>
                  Intervals may vary. The horizontal axis follows capture order; gaps do not imply
                  continuous monitoring.
                </p>
                <div className="runtime-charts">
                  <RuntimeChart
                    points={points}
                    field="memoryUsedPercent"
                    title="Host memory used"
                    unit="%"
                  />
                  <RuntimeChart
                    points={points}
                    field="diskUsedPercent"
                    title="Manager-volume disk used"
                    unit="%"
                  />
                  <RuntimeChart
                    points={points}
                    field="cpuBusyPercent"
                    title="Host CPU busy"
                    unit="%"
                  />
                </div>
                {point?.warnings.map((warning) => (
                  <p key={warning} className="notice">
                    {warning}
                  </p>
                ))}
                <p className="scope-note">
                  Host metrics may cover the container host, not the container’s quotas. Counter
                  resets invalidate rates. Monitor data can be stale even when a request succeeds.
                </p>
              </section>
            </>
          ) : null}
          {view === 'processes' ? (
            <section className="panel padded">
              <div className="section-heading">
                <div>
                  <h2>Choose processes to sample</h2>
                  <p>
                    Selected PIDs are read in the next capture. A start time is required before
                    calculating rates.
                  </p>
                </div>
                <button onClick={onManage}>Open process administration</button>
              </div>
              <label className="field">
                Filter loaded inventory
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="PID, user, namespace or routine"
                />
              </label>
              <p>{pids.length} / 12 selected</p>
              <div className="table-scroll">
                <table className="runtime-table">
                  <thead>
                    <tr>
                      <th>Sample</th>
                      <th>PID</th>
                      <th>User</th>
                      <th>Namespace</th>
                      <th>Routine</th>
                      <th>State</th>
                      <th>CPU time (ms)</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={String(row.Pid)}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={'Sample process ' + row.Pid}
                            checked={pids.includes(row.Pid)}
                            disabled={
                              !Number.isInteger(row.Pid) ||
                              (!pids.includes(row.Pid) && pids.length >= 12)
                            }
                            onChange={(event) =>
                              setPids(
                                event.target.checked
                                  ? [...pids, row.Pid]
                                  : pids.filter((pid) => pid !== row.Pid),
                              )
                            }
                          />
                        </td>
                        <td>{row.Pid}</td>
                        <td>{row.Username}</td>
                        <td>{row.Nspace}</td>
                        <td>{row.Routine}</td>
                        <td>{row.State}</td>
                        <td>
                          {typeof row.CPUTime === 'number'
                            ? row.CPUTime.toLocaleString()
                            : 'Unavailable'}
                        </td>
                        <td>
                          <button
                            disabled={
                              !current.sample.processDetails.some((item) => item.pid === row.Pid)
                            }
                            onClick={() => setProcessId(row.Pid)}
                          >
                            Inspect captured details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows.length ? <p>No process rows match this sample and filter.</p> : null}
              {detail ? (
                <div className="runtime-process-detail">
                  <h3>Process {detail.pid}</h3>
                  <p>
                    {detail.status} · {new Date(detail.capturedAt).toLocaleString()}
                  </p>
                  {detail.notice ? <p className="notice">{detail.notice}</p> : null}
                  {detail.data ? (
                    <>
                      <p>
                        Execution state: {parseProcessState(detail.data.State).base ?? 'Unknown'}
                      </p>
                      <DataValue value={detail.data} />
                    </>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
          {view === 'rates' ? (
            <section className="panel padded">
              <h2>Process counter changes</h2>
              <p>
                Rates are computed only for matching PID, native start time and job number. Missing
                detail selection is not evidence of process exit.
              </p>
              {!previous ? (
                <p>Capture a second sample or select a baseline.</p>
              ) : comparisons.length ? (
                comparisons.map((process) => (
                  <details
                    key={process.pid}
                    className="capture-source"
                    open={process.identity === 'same'}
                  >
                    <summary>
                      <strong>
                        PID {process.pid} · {process.user || 'User unavailable'}
                      </strong>
                      <span>{process.identity}</span>
                    </summary>
                    {process.notice ? <p className="notice">{process.notice}</p> : null}
                    <p>
                      {process.stateBefore ?? 'Unknown'} → {process.stateAfter ?? 'Unknown'}
                    </p>
                    <table className="runtime-table">
                      <thead>
                        <tr>
                          <th>Counter</th>
                          <th>Before</th>
                          <th>After</th>
                          <th>Change</th>
                          <th>Per second</th>
                        </tr>
                      </thead>
                      <tbody>
                        {process.counters.map((counter) => (
                          <tr key={counter.name}>
                            <th scope="row">{counter.name}</th>
                            <td>{counter.before ?? 'Unavailable'}</td>
                            <td>{counter.after ?? 'Unavailable'}</td>
                            <td>{counter.delta ?? counter.notice}</td>
                            <td>{counter.perSecond?.toFixed(2) ?? 'Not calculated'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ))
              ) : (
                <p>Select process details in the Processes tab, then capture two samples.</p>
              )}
            </section>
          ) : null}
          {view === 'locks' ? (
            <section className="panel padded">
              <h2>Lock owners</h2>
              <p>
                This joins observed lock owners to a separately collected process inventory by PID.
                It does not prove a wait-for relationship, deadlock or unchanged process generation.
              </p>
              {locks.map((owner, index) => (
                <details className="capture-source" key={index}>
                  <summary>
                    <strong>
                      {owner.remote ? 'Remote owner' : 'PID'} {owner.pid}
                    </strong>
                    <span>
                      {owner.references.length} references · {owner.modes.join(', ')}
                    </span>
                  </summary>
                  <p>Correlation: {owner.correlation}</p>
                  {owner.process ? (
                    <p>
                      {String(owner.process.Username ?? '')} · {String(owner.process.Nspace ?? '')}{' '}
                      · {String(owner.process.Routine ?? '')}
                    </p>
                  ) : null}
                  <ul>
                    {owner.references.map((reference, index) => (
                      <li key={index}>
                        <code>{reference}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
              {!locks.length ? (
                <p>
                  No lock rows are available in this sample. Check the Lock table source status
                  before concluding there are no locks.
                </p>
              ) : null}
            </section>
          ) : null}
          {view === 'findings' ? (
            <section className="panel padded">
              <h2>Review findings</h2>
              {findings.map((finding) => (
                <article key={finding.id} className={'runtime-finding finding-' + finding.severity}>
                  <span>
                    {finding.severity} ·{' '}
                    {sourceNames[finding.source as RuntimeSource] ?? 'Sample comparison'}
                  </span>
                  <h3>{finding.title}</h3>
                  <p>{finding.detail}</p>
                </article>
              ))}
              {!findings.length ? (
                <p>
                  No selected threshold or completeness check produced a finding. This does not
                  certify the instance as healthy.
                </p>
              ) : null}
            </section>
          ) : null}
          {view === 'sources' ? (
            <section className="panel padded">
              <h2>Native source records</h2>
              {current.sample.sources.map((source) => (
                <details className="capture-source" key={source.source}>
                  <summary>
                    <strong>{sourceNames[source.source]}</strong>
                    <span>
                      {source.status} · {source.elapsedMs} ms
                    </span>
                  </summary>
                  <p>{source.notice}</p>
                  <small>
                    {source.path} · {source.capturedAt}
                  </small>
                  <DataValue value={source.data} />
                </details>
              ))}
            </section>
          ) : null}
        </>
      ) : !busy ? (
        <section className="panel padded">
          <h2>Capture the current runtime</h2>
          <p>
            Start with capacity, inventory and lock data. Choose up to 12 processes from that
            inventory and capture again to collect their native identities and counters.
          </p>
        </section>
      ) : null}
    </>
  );
}
function CapacityMetric({
  title,
  value,
  unit,
  note,
}: {
  title: string;
  value?: number;
  unit: string;
  note: string;
}) {
  return (
    <section className="panel runtime-metric">
      <h3>{title}</h3>
      <strong>{value === undefined ? 'Unavailable' : value.toFixed(1) + unit}</strong>
      <p>{note}</p>
    </section>
  );
}
function RuntimeChart({
  points,
  field,
  title,
  unit,
}: {
  points: CapacityPoint[];
  field: 'memoryUsedPercent' | 'diskUsedPercent' | 'cpuBusyPercent';
  title: string;
  unit: string;
}) {
  const valid = points
    .map((point, index) => ({ index, value: point[field] }))
    .filter((point): point is { index: number; value: number } => point.value !== undefined);
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    const value = point[field];
    if (value === undefined) {
      if (current.length) segments.push(current.join(' '));
      current = [];
    } else current.push(`${25 + (index / Math.max(1, points.length - 1)) * 250},${115 - value}`);
  });
  if (current.length) segments.push(current.join(' '));
  return (
    <figure className="runtime-chart">
      <figcaption>{title}</figcaption>
      <svg
        viewBox="0 0 300 145"
        role="img"
        aria-label={title + ' over ' + points.length + ' captured samples'}
      >
        <line x1="25" y1="115" x2="275" y2="115" />
        <line x1="25" y1="15" x2="25" y2="115" />
        <text x="0" y="20">
          100
        </text>
        <text x="10" y="120">
          0
        </text>
        {segments.map((segment, index) => (
          <polyline key={index} points={segment} />
        ))}
        {valid.map((point) => (
          <circle
            key={point.index}
            cx={25 + (point.index / Math.max(1, points.length - 1)) * 250}
            cy={115 - point.value}
            r="3"
          >
            <title>
              {new Date(points[point.index].at).toLocaleTimeString()}: {point.value.toFixed(1)}
              {unit}
            </title>
          </circle>
        ))}
      </svg>
      <span>{valid.length} valid readings</span>
    </figure>
  );
}
