import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, RefreshCw, Search } from 'lucide-react';
import { download, request } from '../../api';
import { useData } from '../../hooks';
import { Badge, Details, Empty, ErrorBox, Loading, PageHeader, Value } from '../../components/ui';
import {
  executionSummary,
  filterExecutions,
  formatDuration,
  normalizeExecutions,
  scheduleDescription,
  taskChanges,
  taskFindings,
  taskText,
  type Execution,
  type ExecutionFilter,
  type TaskObservation,
  type TaskRecord,
} from '../../../shared/task-analysis';
import './task-center.css';

const initialFilter: ExecutionFilter = {
  search: '',
  outcome: 'all',
  from: '',
  to: '',
  minimumSeconds: '',
};
type Tab = 'status' | 'history' | 'schedule' | 'compare';
function Stamp({ value }: { value?: string }) {
  return value ? (
    <time className="task-stamp">{value}</time>
  ) : (
    <span className="muted">Not returned</span>
  );
}
function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="task-stat">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}
function ResultState({ state }: { state: Execution['outcome'] }) {
  return (
    <Badge tone={state === 'success' ? 'good' : state === 'failure' ? 'danger' : 'neutral'}>
      {state}
    </Badge>
  );
}
function ObservationSources({ value }: { value: TaskObservation }) {
  return (
    <div className="task-sources" aria-label="Task source availability">
      {(['configuration', 'state', 'history'] as const).map((name) => (
        <div key={name}>
          <strong>{name}</strong>
          <Badge tone={value[name].status === 'available' ? 'good' : 'neutral'}>
            {value[name].status}
          </Badge>
          <Stamp value={value[name].observedAt} />
          {value[name].message && <p>{value[name].message}</p>}
        </div>
      ))}
    </div>
  );
}
function CurrentStatus({ observation }: { observation: TaskObservation }) {
  const state = observation.state.data,
    config = observation.configuration.data;
  const findings = taskFindings(observation);
  return (
    <div className="task-section">
      <div className="task-stat-grid">
        <Stat label="Scheduling">
          {typeof state?.Suspended === 'boolean'
            ? state.Suspended
              ? 'Suspended'
              : 'Active'
            : 'Unknown'}
        </Stat>
        <Stat label="Native status">{taskText(state?.Status) || 'Unknown'}</Stat>
        <Stat label="Task class">{taskText(config?.TaskClass) || 'Unknown'}</Stat>
        <Stat label="Run as">{taskText(config?.RunAsUser) || 'Unknown'}</Stat>
      </div>
      <section className="panel padded">
        <h2>Scheduling state</h2>
        <p className="scope-note">
          Read from task info. Suspending scheduling does not stop a running task.
        </p>
        {state ? (
          <dl className="task-facts">
            <div>
              <dt>Next scheduled</dt>
              <dd>
                <Stamp value={taskText(state.NextScheduled)} />
              </dd>
            </div>
            <div>
              <dt>Last started</dt>
              <dd>
                <Stamp value={taskText(state.LastStarted)} />
              </dd>
            </div>
            <div>
              <dt>Last finished</dt>
              <dd>
                <Stamp value={taskText(state.LastFinished)} />
              </dd>
            </div>
            <div>
              <dt>Last schedule</dt>
              <dd>
                <Stamp value={taskText(state.LastSchedule)} />
              </dd>
            </div>
            <div>
              <dt>Native error</dt>
              <dd>
                <Value value={state.Error} />
              </dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>
                <Value value={state.Type} />
              </dd>
            </div>
          </dl>
        ) : (
          <p>Task state is unavailable. Check the source response below.</p>
        )}
      </section>
      {findings.length > 0 && (
        <section className="panel padded">
          <h2>Review points</h2>
          <ul className="task-findings">
            {findings.map((finding) => (
              <li key={finding.id}>
                <div>
                  <Badge tone={finding.severity === 'attention' ? 'warning' : 'neutral'}>
                    {finding.source}
                  </Badge>
                  <strong>{finding.title}</strong>
                </div>
                <p>{finding.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ObservationSources value={observation} />
    </div>
  );
}
function DurationPlot({ rows }: { rows: Execution[] }) {
  const measured = rows.filter((row) => row.durationMs !== undefined).slice(0, 30);
  const maximum = Math.max(1, ...measured.map((row) => row.durationMs!));
  if (!measured.length) return null;
  return (
    <section className="task-duration-plot" aria-label="Durations of up to 30 displayed executions">
      <h3>Execution duration</h3>
      <p className="scope-note">
        Up to 30 records in source order. Hover or focus a bar for its start time and duration.
      </p>
      <div className="task-bars">
        {measured.map((row) => (
          <div key={row.key} className="task-bar-item">
            <div
              tabIndex={0}
              role="img"
              className={'task-bar ' + row.outcome}
              style={{ height: Math.max(3, (row.durationMs! / maximum) * 100) + '%' }}
              title={row.started + ' · ' + formatDuration(row.durationMs)}
              aria-label={row.started + ': ' + formatDuration(row.durationMs) + ', ' + row.outcome}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
function ExecutionDetails({ row, close }: { row: Execution; close: () => void }) {
  return (
    <section className="panel padded task-execution-details" aria-label="Selected execution">
      <div className="task-section-heading">
        <h3>Execution details</h3>
        <button onClick={close}>Close details</button>
      </div>
      <dl className="task-facts">
        <div>
          <dt>Started</dt>
          <dd>
            <Stamp value={row.started} />
          </dd>
        </div>
        <div>
          <dt>Finished</dt>
          <dd>
            <Stamp value={row.finished} />
          </dd>
        </div>
        <div>
          <dt>Outcome</dt>
          <dd>
            <ResultState state={row.outcome} />
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(row.durationMs)}</dd>
        </div>
        <div>
          <dt>Native status</dt>
          <dd>{row.status || 'Not returned'}</dd>
        </div>
        <div>
          <dt>Native result</dt>
          <dd>{row.result || 'Not returned'}</dd>
        </div>
        <div>
          <dt>Namespace</dt>
          <dd>{row.namespace || 'Not returned'}</dd>
        </div>
        <div>
          <dt>User</dt>
          <dd>{row.user || 'Not returned'}</dd>
        </div>
        <div>
          <dt>Process at execution</dt>
          <dd>{row.process || 'Not returned'}</dd>
        </div>
      </dl>
      {row.durationNotice && <p className="scope-note">{row.durationNotice}</p>}
      <p className="scope-note">The historical process ID may now belong to a different process.</p>
      <details>
        <summary>All returned fields</summary>
        <Details data={row.row} />
      </details>
    </section>
  );
}
function TaskHistory({ observation }: { observation: TaskObservation }) {
  const [filter, setFilter] = useState<ExecutionFilter>(initialFilter);
  const [selected, setSelected] = useState<string>();
  const [page, setPage] = useState(0);
  const executions = useMemo(
    () => normalizeExecutions(observation.history.data ?? []),
    [observation],
  );
  const filtered = useMemo(() => filterExecutions(executions, filter), [executions, filter]);
  const summary = executionSummary(filtered);
  const count = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, count - 1);
  const shown = filtered.slice(currentPage * 20, currentPage * 20 + 20);
  const detail = executions.find((row) => row.key === selected);
  function change<K extends keyof ExecutionFilter>(key: K, value: ExecutionFilter[K]) {
    setFilter((previous) => ({ ...previous, [key]: value }));
    setPage(0);
  }
  if (observation.history.status !== 'available')
    return <ErrorBox error={observation.history.message || 'History is unavailable.'} />;
  return (
    <div className="task-section">
      <div className="task-stat-grid">
        <Stat label="Returned executions">{executions.length}</Stat>
        <Stat label="Failed in filtered sample">{summary.counts.failure}</Stat>
        <Stat label="Median duration">{formatDuration(summary.median)}</Stat>
        <Stat label="95th percentile duration">{formatDuration(summary.p95)}</Stat>
      </div>
      <section className="panel padded">
        <div className="task-section-heading">
          <h2>Execution history</h2>
          <button
            disabled={!filtered.length}
            onClick={() =>
              download('harbor-task-' + observation.taskId + '-history.json', {
                taskId: observation.taskId,
                observedAt: observation.history.observedAt,
                sampleLimit: observation.historyLimit,
                mayOmitOlderRuns: observation.historyMayBeLimited,
                filter,
                rows: filtered.map((row) => row.row),
              })
            }
          >
            <Download size={16} /> Export filtered history
          </button>
        </div>
        <p className="scope-note">
          IRIS returned at most {observation.historyLimit} records. Filters and statistics apply
          only to this sample; unknown outcomes are not successes.
        </p>
        {observation.historyMayBeLimited && (
          <p className="task-notice">The limit was reached. Older executions may be omitted.</p>
        )}
        <div className="task-filters">
          <label>
            Search result, user or process
            <input
              value={filter.search}
              onChange={(event) => change('search', event.target.value)}
            />
          </label>
          <label>
            Outcome
            <select
              value={filter.outcome}
              onChange={(event) =>
                change('outcome', event.target.value as ExecutionFilter['outcome'])
              }
            >
              <option value="all">All outcomes</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="unfinished">Unfinished</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            Started on or after
            <input
              type="date"
              value={filter.from}
              onChange={(event) => change('from', event.target.value)}
            />
          </label>
          <label>
            Started on or before
            <input
              type="date"
              value={filter.to}
              onChange={(event) => change('to', event.target.value)}
            />
          </label>
          <label>
            Minimum duration (seconds)
            <input
              type="number"
              min="0"
              value={filter.minimumSeconds}
              onChange={(event) => change('minimumSeconds', event.target.value)}
            />
          </label>
          <button
            onClick={() => {
              setFilter(initialFilter);
              setPage(0);
            }}
          >
            Clear filters
          </button>
        </div>
        {filter.from && filter.to && filter.from > filter.to && (
          <p className="task-notice">The end date precedes the start date.</p>
        )}
        <p className="scope-note">
          Durations use {summary.measured} records with valid start and finish times.{' '}
          {summary.counts.unknown} outcomes are unknown; {summary.counts.unfinished} have no
          completion timestamp.
        </p>
        {!filtered.length ? (
          <Empty
            title="No executions match"
            description={
              executions.length
                ? 'Change the filters to see more of the loaded sample.'
                : 'IRIS returned no history for this task.'
            }
          />
        ) : (
          <>
            <DurationPlot rows={filtered} />
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Outcome</th>
                    <th>Duration</th>
                    <th>Result</th>
                    <th>User</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <button className="text-link" onClick={() => setSelected(row.key)}>
                          {row.started || 'Unknown start'}
                        </button>
                      </td>
                      <td>
                        <ResultState state={row.outcome} />
                      </td>
                      <td>{formatDuration(row.durationMs)}</td>
                      <td className="task-result-cell">{row.result || 'Not returned'}</td>
                      <td>{row.user || 'Not returned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="task-pagination">
              <span>
                {filtered.length} matching records · Page {currentPage + 1} of {count}
              </span>
              <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                Previous
              </button>
              <button disabled={currentPage + 1 >= count} onClick={() => setPage(currentPage + 1)}>
                Next
              </button>
            </div>
          </>
        )}
      </section>
      {detail && <ExecutionDetails row={detail} close={() => setSelected(undefined)} />}
    </div>
  );
}
function TaskSchedule({
  observation,
  onManage,
}: {
  observation: TaskObservation;
  onManage: () => void;
}) {
  const config = observation.configuration.data;
  if (!config)
    return (
      <ErrorBox error={observation.configuration.message || 'Task configuration is unavailable.'} />
    );
  const schedule = scheduleDescription(config);
  return (
    <div className="task-section">
      <section className="panel padded">
        <div className="task-section-heading">
          <h2>{schedule.summary}</h2>
          <button onClick={onManage}>Open task administration</button>
        </div>
        <p>{schedule.cadence}</p>
        <ul>
          {schedule.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
        {schedule.warnings.map((warning) => (
          <p className="task-notice" key={warning}>
            {warning}
          </p>
        ))}
        <p className="scope-note">
          This describes configured fields. The next occurrence comes from IRIS task info; it is not
          predicted by Harbor.
        </p>
      </section>
      <section className="panel padded">
        <h2>Execution settings</h2>
        <dl className="task-facts">
          {[
            'NameSpace',
            'TaskClass',
            'RunAsUser',
            'Priority',
            'IsBatch',
            'SuspendOnError',
            'SuspendTerminated',
            'RescheduleOnStart',
          ].map((field) => (
            <div key={field}>
              <dt>{field}</dt>
              <dd>
                <Value value={config[field]} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="panel padded">
        <h2>Output and notifications</h2>
        <dl className="task-facts">
          {[
            'OpenOutputFile',
            'OutputDirectory',
            'OutputFilename',
            'OutputFileIsBinary',
            'EmailOutput',
            'EmailOnCompletion',
            'EmailOnError',
            'EmailOnExpiration',
          ].map((field) => (
            <div key={field}>
              <dt>{field}</dt>
              <dd>
                <Value value={config[field]} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="scope-note">
          Paths refer to the IRIS host. Harbor does not open arbitrary output files.
        </p>
      </section>
      <details className="panel padded">
        <summary>Complete task configuration</summary>
        <Details data={config} />
      </details>
    </div>
  );
}
function ConfigurationComparison({
  observation,
  baseline,
  onPin,
}: {
  observation: TaskObservation;
  baseline?: TaskObservation;
  onPin: () => void;
}) {
  const before = baseline?.configuration.data,
    after = observation.configuration.data;
  const changes = before && after ? taskChanges(before, after) : [];
  return (
    <section className="panel padded">
      <div className="task-section-heading">
        <h2>Configuration comparison</h2>
        <button disabled={!after} onClick={onPin}>
          {baseline ? 'Replace baseline' : 'Keep this baseline'}
        </button>
      </div>
      <p className="scope-note">
        Keep a baseline, refresh the task, then compare returned fields. The baseline stays in this
        view until you leave it.
      </p>
      {baseline && (
        <p>
          Baseline: <Stamp value={baseline.configuration.observedAt} /> · Current:{' '}
          <Stamp value={observation.configuration.observedAt} />
        </p>
      )}
      {!baseline ? (
        <Empty
          title="No baseline selected"
          description="Keep the current task configuration before collecting a later observation."
        />
      ) : !before || !after ? (
        <p>Both configuration reads must be available to compare them.</p>
      ) : changes.length ? (
        <>
          <p>{changes.length} changed fields</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Baseline</th>
                  <th>Current</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((change) => (
                  <tr key={change.field}>
                    <th scope="row">{change.field}</th>
                    <td>
                      <Value value={change.before} />
                    </td>
                    <td>
                      <Value value={change.after} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={() =>
              download('harbor-task-' + observation.taskId + '-comparison.json', {
                taskId: observation.taskId,
                before: baseline.configuration.observedAt,
                after: observation.configuration.observedAt,
                changes,
              })
            }
          >
            Export comparison
          </button>
        </>
      ) : (
        <p>
          No returned configuration fields changed. This comparison does not establish whether the
          task ran.
        </p>
      )}
    </section>
  );
}
function TaskDetail({
  task,
  back,
  onManage,
}: {
  task: TaskRecord;
  back: () => void;
  onManage: () => void;
}) {
  const id = taskText(task.Id);
  const [observation, setObservation] = useState<TaskObservation>();
  const [baseline, setBaseline] = useState<TaskObservation>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [limit, setLimit] = useState(100);
  const [tab, setTab] = useState<Tab>('status');
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    let live = true;
    setLoading(true);
    setError('');
    request<TaskObservation>('task-center/' + encodeURIComponent(id) + '?limit=' + limit)
      .then((value) => {
        if (live && current === sequence.current) setObservation(value);
      })
      .catch((caught) => {
        if (live && current === sequence.current) setError((caught as Error).message);
      })
      .finally(() => {
        if (live && current === sequence.current) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id, limit, version]);
  return (
    <>
      <button className="text-link" onClick={back}>
        <ArrowLeft size={16} /> All tasks
      </button>
      <PageHeader
        title={taskText(task.Name) || 'Task ' + id}
        description={'Task ' + id + ' · ' + (taskText(task.Namespace) || 'Namespace not returned')}
      >
        <button disabled={loading} onClick={() => setVersion((value) => value + 1)}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> Refresh task
        </button>
        <button
          disabled={!observation}
          onClick={() => download('harbor-task-' + id + '.json', observation)}
        >
          <Download size={16} /> Export observation
        </button>
      </PageHeader>
      <div className="task-load-settings">
        <label>
          History sample
          <select
            value={limit}
            disabled={loading}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            <option value={50}>Up to 50 executions</option>
            <option value={100}>Up to 100 executions</option>
            <option value={250}>Up to 250 executions</option>
            <option value={500}>Up to 500 executions</option>
          </select>
        </label>
        {observation && (
          <span>
            Collected <Stamp value={observation.finishedAt} />
          </span>
        )}
      </div>
      {error && <ErrorBox error={error} retry={() => setVersion((value) => value + 1)} />}
      {loading && <Loading />}
      {observation && (
        <>
          {(error || loading) && (
            <p className="task-notice">
              The observation below is from the previous successful collection.
            </p>
          )}
          <div className="tabs" aria-label="Task detail views">
            {(['status', 'history', 'schedule', 'compare'] as const).map((name) => (
              <button
                key={name}
                className={tab === name ? 'active' : ''}
                aria-pressed={tab === name}
                onClick={() => setTab(name)}
              >
                {
                  {
                    status: 'Current state',
                    history: 'Execution history',
                    schedule: 'Schedule & output',
                    compare: 'Compare configuration',
                  }[name]
                }
              </button>
            ))}
          </div>
          {tab === 'status' && <CurrentStatus observation={observation} />}
          {tab === 'history' && <TaskHistory observation={observation} />}
          {tab === 'schedule' && <TaskSchedule observation={observation} onManage={onManage} />}
          {tab === 'compare' && (
            <ConfigurationComparison
              observation={observation}
              baseline={baseline}
              onPin={() => setBaseline(observation)}
            />
          )}
          <p className="scope-note">
            These sources are read separately. Native timestamps without an offset are shown as
            returned by IRIS.
          </p>
        </>
      )}
    </>
  );
}
export function TaskCenter({ onManage }: { onManage: () => void }) {
  const inventory = useData<TaskRecord[]>('/v2/tasks');
  const [selected, setSelected] = useState<TaskRecord>();
  const [search, setSearch] = useState('');
  const [namespace, setNamespace] = useState('');
  const [page, setPage] = useState(0);
  const rows = Array.isArray(inventory.data) ? inventory.data : [];
  const namespaces = [
    ...new Set(rows.map((row) => taskText(row.Namespace)).filter(Boolean)),
  ].sort();
  const filtered = rows.filter(
    (row) =>
      (!namespace || taskText(row.Namespace) === namespace) &&
      [row.Id, row.Name, row.Namespace, row.Description, row.Type].some((value) =>
        taskText(value).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      ),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages - 1);
  if (selected)
    return (
      <div className="task-center">
        <TaskDetail
          key={taskText(selected.Id)}
          task={selected}
          back={() => setSelected(undefined)}
          onManage={onManage}
        />
      </div>
    );
  return (
    <div className="task-center">
      <PageHeader
        title="Task center"
        description="Inspect scheduling state, execution history and configuration changes."
      >
        <button onClick={onManage}>Task administration</button>
        <button disabled={inventory.loading} onClick={inventory.refresh}>
          <RefreshCw size={16} /> Refresh tasks
        </button>
      </PageHeader>
      <section className="panel padded">
        <div className="task-inventory-filters">
          <label>
            <span>
              <Search size={15} /> Find a task
            </span>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Name, ID, namespace or description"
            />
          </label>
          <label>
            Namespace
            <select
              value={namespace}
              onChange={(event) => {
                setNamespace(event.target.value);
                setPage(0);
              }}
            >
              <option value="">All namespaces</option>
              {namespaces.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        {inventory.error && <ErrorBox error={inventory.error} retry={inventory.refresh} />}
        {inventory.loading && <Loading />}
        {!inventory.loading && !filtered.length && (
          <Empty
            title="No tasks match"
            description={
              rows.length ? 'Change the task filters.' : 'No task inventory was returned.'
            }
          />
        )}
        {filtered.length > 0 && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Namespace</th>
                    <th>Type</th>
                    <th>Next scheduled in list</th>
                    <th>Last finished</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(currentPage * 20, currentPage * 20 + 20).map((row, index) => (
                    <tr key={taskText(row.Id) + ':' + index}>
                      <td>
                        <button
                          className="text-link"
                          disabled={!/^[1-9]\d{0,9}$/.test(taskText(row.Id))}
                          onClick={() => setSelected(row)}
                        >
                          {taskText(row.Name) || 'Unnamed task'} <small>#{taskText(row.Id)}</small>
                        </button>
                      </td>
                      <td>{taskText(row.Namespace)}</td>
                      <td>{taskText(row.Type)}</td>
                      <td>
                        <Stamp value={taskText(row.NextScheduled)} />
                      </td>
                      <td>
                        <Stamp value={taskText(row.LastFinished)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="task-pagination">
              <span>
                {filtered.length} tasks · Page {currentPage + 1} of {pages}
              </span>
              <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
                Previous
              </button>
              <button disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
