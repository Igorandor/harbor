import { useState, type ReactNode } from 'react';
import { label } from '../../shared/catalog';
import { capacity, formatBytes, record, scalar, columnsFor, filterRows } from './data-model';
import './data-view.css';

function Disclosure({ title, children }: { title: string; children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => e.target === e.currentTarget && setOpen(e.currentTarget.open)}>
      <summary>{title}</summary>
      {open && children()}
    </details>
  );
}

/** Bounded, text-only presentation of native API values; never interprets markup. */
export function DataValue({
  value,
  depth = 0,
  field = '',
}: {
  value: unknown;
  depth?: number;
  field?: string;
}) {
  if (value === null || value === undefined) return <span className="muted">Not set</span>;
  if (value === '') return <span className="muted">Empty text</span>;
  if (typeof value === 'boolean')
    return (
      <span className="data-boolean">
        {field === 'Suspended'
          ? value
            ? 'Paused'
            : 'Scheduled'
          : field === 'Enabled'
            ? value
              ? 'Enabled'
              : 'Disabled'
            : value
              ? 'Yes'
              : 'No'}
      </span>
    );
  if (typeof value !== 'object') return <span className="data-scalar">{scalar(value)}</span>;
  const entries = Object.entries(value);
  if (!entries.length)
    return <span className="muted">{Array.isArray(value) ? 'No entries' : 'No fields'}</span>;
  if (depth >= 6)
    return <span className="muted">Nested data: use the response export to inspect further.</span>;
  if (Array.isArray(value) && value.every((v) => v === null || typeof v !== 'object'))
    return (
      <ul className="data-list">
        {value.slice(0, 100).map((v, i) => (
          <li key={i}>
            <DataValue value={v} depth={depth + 1} />
          </li>
        ))}
        {value.length > 100 && <li>{value.length - 100} more entries in the export</li>}
      </ul>
    );
  return (
    <dl className="data-fields">
      {entries.slice(0, 100).map(([key, v]) => (
        <div key={key}>
          <dt>{Array.isArray(value) ? `Entry ${Number(key) + 1}` : label(key)}</dt>
          <dd>
            {v && typeof v === 'object' ? (
              <Disclosure
                title={Array.isArray(v) ? `${v.length} entries` : `${Object.keys(v).length} fields`}
              >
                {() => <DataValue value={v} depth={depth + 1} />}
              </Disclosure>
            ) : (
              <DataValue value={v} field={key} depth={depth + 1} />
            )}
          </dd>
        </div>
      ))}
      {entries.length > 100 && (
        <div>
          <dt>Display limit</dt>
          <dd>{entries.length - 100} further fields in the export</dd>
        </div>
      )}
    </dl>
  );
}

export function DataTable({ rows }: { rows: unknown[] }) {
  const [query, setQuery] = useState(''),
    [sort, setSort] = useState(''),
    [descending, setDescending] = useState(false),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<number>();
  const columns = columnsFor(rows),
    filtered = filterRows(rows, query, sort, descending),
    pages = Math.max(1, Math.ceil(filtered.length / 20)),
    current = Math.min(page, pages - 1);
  const chosen = selected === undefined ? undefined : rows[selected];
  return (
    <div className="data-browser">
      <div className="data-toolbar">
        <label>
          Filter records
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search returned values"
          />
        </label>
        <span>
          {filtered.length} of {rows.length} records
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((key) => (
                <th
                  key={key}
                  aria-sort={sort === key ? (descending ? 'descending' : 'ascending') : 'none'}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDescending(sort === key && !descending);
                      setSort(key);
                    }}
                  >
                    {label(key)}
                    {sort === key ? (descending ? ' ↓' : ' ↑') : ''}
                  </button>
                </th>
              ))}
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(current * 20, current * 20 + 20).map(({ row, index }) => (
              <tr key={index}>
                {columns.map((key) => (
                  <td key={key}>
                    <DataValue value={record(row)[key]} field={key} />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    onClick={() => setSelected(selected === index ? undefined : index)}
                    aria-expanded={selected === index}
                  >
                    Inspect record {index + 1}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <p className="padded">No records match this filter.</p>}
      <div className="data-pagination">
        <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
          Previous
        </button>
        <span>
          Page {current + 1} / {pages}
        </span>
        <button type="button" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
          Next
        </button>
      </div>
      {chosen !== undefined && (
        <section className="data-record" aria-label="Selected record">
          <div className="data-toolbar">
            <h4>Record {selected! + 1}</h4>
            <button type="button" onClick={() => setSelected(undefined)}>
              Close record
            </button>
          </div>
          <DataValue value={chosen} />
        </section>
      )}
    </div>
  );
}

function CapacityBar({
  title,
  total,
  available,
  unit,
}: {
  title: string;
  total: unknown;
  available: unknown;
  unit: string;
}) {
  const d = capacity(total, available);
  return (
    <section className="capacity-panel">
      <h4>{title}</h4>
      {d ? (
        <>
          <strong>{d.percent.toFixed(1)}% used</strong>
          <meter min={0} max={100} value={d.percent} aria-label={`${title} used`} />
          <div className="capacity-key">
            <span>
              Used <b>{formatBytes(d.used, unit)}</b>
            </span>
            <span>
              Available <b>{formatBytes(d.available, unit)}</b>
            </span>
            <span>
              Total <b>{formatBytes(d.total, unit)}</b>
            </span>
          </div>
        </>
      ) : (
        <p>Capacity not available in this sample.</p>
      )}
    </section>
  );
}

export function HostView({ data }: { data: unknown }) {
  const d = record(data),
    memory = record(d.memory),
    disk = record(d.disk),
    cpu = record(d.cpu),
    [unit, setUnit] = useState('GiB');
  const loads = Array.isArray(cpu.loadAverage) ? cpu.loadAverage.slice(0, 3) : [],
    cpus =
      typeof cpu.logicalCount === 'number' &&
      Number.isFinite(cpu.logicalCount) &&
      cpu.logicalCount > 0
        ? cpu.logicalCount
        : undefined;
  const peak = Math.max(
    cpus ?? 1,
    ...loads.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)),
  );
  return (
    <div className="host-view">
      <div className="data-toolbar">
        <span>
          {scalar(d.platform)} host
          {typeof d.sampledAt === 'number' && Number.isFinite(d.sampledAt)
            ? ` · ${new Date(d.sampledAt * 1000).toLocaleString()}`
            : ''}
        </span>
        <label>
          Capacity units
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option>GiB</option>
            <option>MiB</option>
          </select>
        </label>
      </div>
      <div className="capacity-grid">
        <CapacityBar title="Memory" total={memory.total} available={memory.available} unit={unit} />
        <CapacityBar title="Disk" total={disk.total} available={disk.free} unit={unit} />
      </div>
      {typeof disk.path === 'string' && (
        <p className="scope-note">
          Disk volume: <code>{disk.path}</code>
        </p>
      )}
      <section className="load-chart">
        <h4>CPU load averages · {cpus ?? 'Unknown number of'} logical CPUs</h4>
        <p>
          Runnable or waiting processes, not CPU utilization. Bars share a scale of 0–
          {peak.toFixed(2)}.
        </p>
        {[1, 5, 15].map((minutes, index) => {
          const value = loads[index];
          return (
            <div className="load-row" key={minutes}>
              <span>{minutes} min</span>
              {typeof value === 'number' && Number.isFinite(value) && value >= 0 ? (
                <>
                  <meter
                    min={0}
                    max={peak}
                    value={value}
                    aria-label={`${minutes} minute load average`}
                  />
                  <b>{value.toFixed(2)}</b>
                </>
              ) : (
                <span>Not reported</span>
              )}
            </div>
          );
        })}
      </section>
      <p className="scope-note">
        {typeof d.scope === 'string' ? d.scope : 'Host metrics; container limits may differ.'}{' '}
        {typeof d.notice === 'string' ? d.notice : ''}
      </p>
      <details className="data-extra">
        <summary>Sample details and CPU counters</summary>
        <p>
          A single counter sample cannot determine current CPU utilization. System resources uses
          successive live samples.
        </p>
        <DataValue
          value={{
            uptimeSeconds: d.uptimeSeconds,
            totalTicks: cpu.totalTicks,
            idleTicks: cpu.idleTicks,
          }}
        />
      </details>
    </div>
  );
}

export function LogView({ data }: { data: unknown }) {
  const d = record(data),
    lines = Array.isArray(d.lines) ? d.lines.filter((x): x is string => typeof x === 'string') : [],
    [query, setQuery] = useState(''),
    [severity, setSeverity] = useState('all');
  const kind = (line: string) =>
    /error|severe|failed/i.test(line) ? 'error' : /warning/i.test(line) ? 'warning' : 'other';
  const visible = lines
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line }) =>
        line.toLowerCase().includes(query.toLowerCase()) &&
        (severity === 'all' || kind(line) === severity),
    );
  return (
    <section className="data-log">
      <div className="data-toolbar">
        <label>
          Search captured messages
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          Text classification
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="all">All messages</option>
            <option value="error">Error / failed</option>
            <option value="warning">Warning</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <p>
        {visible.length} of {lines.length} captured lines · classification uses words in the
        message, not native severity codes.
      </p>
      <div className="log-lines">
        {visible.slice(0, 500).map(({ line, index }) => (
          <div key={index} className={`log-${kind(line)}`}>
            <span>{index + 1}</span>
            <code>{line}</code>
          </div>
        ))}
      </div>
      {!visible.length && (
        <p>{typeof d.notice === 'string' ? d.notice : 'No messages match this filter.'}</p>
      )}
      {d.bounded === true && (
        <p className="scope-note">Bounded log excerpt. This is not the complete source file.</p>
      )}
    </section>
  );
}

export function HealthView({ data }: { data: unknown }) {
  const d = record(data),
    status = record(d.Status),
    usage = record(d.SystemUsage),
    fresh = status.SystemMonitor === true,
    [attention, setAttention] = useState(false);
  const checks = ['DatabaseSpace', 'DatabaseJournal', 'JournalSpace', 'LockTable', 'WriteDaemon'];
  return (
    <section className="health-evidence">
      <p className={fresh ? 'scope-note' : 'notice'}>
        {fresh
          ? 'System monitor was running when captured.'
          : 'System monitor was not updating. Values below are last reported, not current health.'}
      </p>
      <DataValue value={{ UpTime: status.UpTime, LastBackup: status.LastBackup }} />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={attention}
          onChange={(e) => setAttention(e.target.checked)}
        />{' '}
        Only checks not reported as Normal
      </label>
      <ul className="health-checks">
        {checks
          .filter((k) => !attention || usage[k] !== 'Normal')
          .map((k) => (
            <li key={k}>
              <span>{label(k)}</span>
              <strong>{scalar(usage[k])}</strong>
            </li>
          ))}
      </ul>
      {attention && checks.every((k) => usage[k] === 'Normal') && (
        <p>No non-Normal checks in this captured sample.</p>
      )}
      <h4>Reported alerts</h4>
      <DataValue value={d.Alerts} />
      <details className="data-extra">
        <summary>Captured monitor fields{!fresh ? ' (may be stale)' : ''}</summary>
        <DataValue value={data} />
      </details>
    </section>
  );
}

export function DataView({
  data,
  kind = '',
  technical = false,
}: {
  data: unknown;
  kind?: string;
  technical?: boolean;
}) {
  const d = record(data);
  const content =
    kind === 'host' || (d.memory && d.cpu && d.disk) ? (
      <HostView data={data} />
    ) : kind === 'logs' || Array.isArray(d.lines) ? (
      <LogView data={data} />
    ) : kind === 'health' || (d.Status && d.SystemUsage) ? (
      <HealthView data={data} />
    ) : ['disable-app', 'restore-app', 'suspend-task', 'restore-task'].includes(kind) ? (
      <StateChange data={d} task={kind.includes('task')} />
    ) : Array.isArray(data) ? (
      <DataTable rows={data} />
    ) : (
      <DataValue value={data} />
    );
  return (
    <div className="data-view">
      {content}
      {technical && (
        <div className="data-extra">
          <Disclosure title="Raw API response">
            {() => (
              <>
                <p>
                  Technical preview, limited to 100,000 characters. Save response exports the
                  complete returned data.
                </p>
                <pre className="json-output">{JSON.stringify(data, null, 2)?.slice(0, 100000)}</pre>
              </>
            )}
          </Disclosure>
        </div>
      )}
    </div>
  );
}

function StateChange({ data, task }: { data: Record<string, unknown>; task: boolean }) {
  const state = (value: unknown) =>
    typeof value !== 'boolean'
      ? 'Not recorded'
      : task
        ? value
          ? 'Paused'
          : 'Scheduled'
        : value
          ? 'Enabled'
          : 'Disabled';
  const verified = typeof data.observed === 'boolean' && data.observed === data.requested;
  return (
    <section>
      <div className="state-transition">
        {['before', 'requested', 'observed'].map((key) => (
          <div key={key}>
            <span>
              {key === 'before'
                ? 'Before'
                : key === 'requested'
                  ? 'Requested state'
                  : 'Read-back state'}
            </span>
            <strong>{state(data[key])}</strong>
          </div>
        ))}
      </div>
      <p>
        {verified
          ? 'Read-back matches the requested state.'
          : 'The captured result does not confirm the requested state.'}
      </p>
      <DataValue
        value={Object.fromEntries(
          Object.entries(data).filter(
            ([key]) => !['before', 'requested', 'observed'].includes(key),
          ),
        )}
      />
    </section>
  );
}

export function DataDiff({ before, after }: { before: unknown; after: unknown }) {
  const [onlyChanged, setOnlyChanged] = useState(true),
    a = record(before),
    b = record(after),
    keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return (
    <div className="data-diff">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={onlyChanged}
          onChange={(e) => setOnlyChanged(e.target.checked)}
        />{' '}
        Changed fields only
      </label>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Setting</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {keys
              .filter((k) => !onlyChanged || JSON.stringify(a[k]) !== JSON.stringify(b[k]))
              .map((k) => (
                <tr key={k}>
                  <th scope="row">{label(k)}</th>
                  <td>
                    <DataValue value={a[k]} field={k} />
                  </td>
                  <td>
                    <DataValue value={b[k]} field={k} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
