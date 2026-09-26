import {
  Activity,
  ArrowUpRight,
  Clock3,
  Database,
  Server,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { useData } from '../hooks';
import { Badge, ErrorBox, Loading, PageHeader, Refresh, Table } from '../components/ui';
export function Overview({ navigate, info }: { navigate: (page: string) => void; info: any }) {
  const state = useData('/v2/monitor/dashboard/main', {}, 30000),
    d = state.data;
  return (
    <>
      <PageHeader
        eyebrow="Instance overview"
        title="A clear view of your IRIS."
        description="System health, upcoming work and the places you use every day."
      >
        <Refresh loading={state.loading} onClick={state.refresh} at={state.at} />
      </PageHeader>
      {state.error && <ErrorBox error={state.error} retry={state.refresh} />}{' '}
      {!d ? (
        state.loading && <Loading />
      ) : (
        <>
          <div className="instance-strip">
            <div className="instance-icon">
              <Server size={24} />
            </div>
            <div>
              <strong>InterSystems {info.product === 'iris' ? 'IRIS' : info.product}</strong>
              <span>
                {info.serverVersion?.match(/20\d\d\.\d[^ ]*/)?.[0] ?? 'Connected instance'} ·{' '}
                {info.namespaces?.length ?? 0} namespaces · API v{info.apiVersion}
              </span>
            </div>
            <Badge tone={d.Status?.SystemMonitor ? 'good' : 'warning'}>
              {d.Status?.SystemMonitor
                ? 'System monitor running'
                : 'System monitor is not updating'}
            </Badge>
            <span className="instance-mode">{info.systemMode || 'Mode not configured'}</span>
          </div>
          <div className="metric-grid">
            <Metric
              icon={<Clock3 size={19} />}
              title="Instance uptime"
              value={d.Status?.UpTime ?? '—'}
              note="Since the last restart"
            />
            <Metric
              icon={<Activity size={19} />}
              title="Active processes"
              value={d.Status?.SystemMonitor ? (d.SystemUsage?.Processes ?? '—') : '—'}
              note={
                d.Status?.SystemMonitor
                  ? `${d.SystemUsage?.CSPSessions ?? '—'} web sessions`
                  : 'Monitor is not updating'
              }
            />
            <Metric
              icon={<Database size={19} />}
              title="Global references / sec"
              value={
                d.Status?.SystemMonitor
                  ? (d.Performance?.GlobalRefsPerSecond?.toLocaleString() ?? '—')
                  : '—'
              }
              note={
                d.Status?.SystemMonitor ? 'Latest IRIS monitor sample' : 'Monitor is not updating'
              }
            />
            <Metric
              icon={<ShieldCheck size={19} />}
              title="Serious alerts"
              value={d.Alerts?.SeriousAlerts ?? '—'}
              note={`${d.Alerts?.ApplicationErrors ?? '—'} application errors`}
              warning={d.Alerts?.SeriousAlerts > 0}
            />
          </div>
          <div className="overview-columns">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Operational health</h2>
                  <p>
                    {d.Status?.SystemMonitor
                      ? 'Reported by the IRIS system monitor'
                      : 'Last reported values · monitor is not updating'}
                  </p>
                </div>
                <span className="small-caption">30 sec refresh</span>
              </div>
              <div className="health-list">
                {[
                  ['Database space', 'DatabaseSpace'],
                  ['Database journal', 'DatabaseJournal'],
                  ['Journal space', 'JournalSpace'],
                  ['Lock table', 'LockTable'],
                  ['Write daemon', 'WriteDaemon'],
                ].map(([title, key]) => (
                  <div key={key}>
                    <span>{title}</span>
                    <Badge
                      tone={
                        !d.Status?.SystemMonitor
                          ? 'neutral'
                          : d.SystemUsage?.[key] === 'Normal'
                            ? 'good'
                            : d.SystemUsage?.[key]
                              ? 'warning'
                              : 'neutral'
                      }
                    >
                      {d.SystemUsage?.[key] || 'Not reported'}
                    </Badge>
                  </div>
                ))}
              </div>
              <div className="panel-note">
                <strong>Last full backup</strong>
                <span>{d.Status?.LastBackup ?? 'Not reported'}</span>
              </div>
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Coming up next</h2>
                  <p>Scheduled work on this instance</p>
                </div>
                <button className="text-link" onClick={() => navigate('tasks')}>
                  All tasks <ArrowUpRight size={15} />
                </button>
              </div>
              <Table
                rows={(d.UpcomingTasks ?? []).slice(0, 5)}
                columns={['Task', 'Time', 'Status']}
                keyField="Task"
              />
              {!d.UpcomingTasks?.length && (
                <p className="padded muted">No upcoming tasks were reported.</p>
              )}
            </section>
          </div>
          <div className="section-heading standalone">
            <h2>Your administration workspace</h2>
            <span className="muted">Six areas. One connected instance.</span>
          </div>
          <div className="workspace-grid">
            {[
              ['apps', '01', 'Web applications', 'Routes, authentication and REST APIs'],
              ['permissions', '02', 'Access & permissions', 'Accounts, roles and resource grants'],
              ['security', '03', 'Security & secrets', 'Wallet, certificates and OAuth'],
              ['tasks', '04', 'Scheduled tasks', 'Schedules, history and on-demand work'],
              ['system', '05', 'System resources', 'Processes, storage and devices'],
              ['logs', '06', 'Logs & activity', 'Messages, audit and task outcomes'],
            ].map(([page, n, title, desc]) => (
              <button className="workspace-card" key={page} onClick={() => navigate(page)}>
                <span className="workspace-number">{n}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{desc}</p>
                </div>
                <ArrowUpRight size={18} />
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
export function Metric({
  icon,
  title,
  value,
  note,
  warning = false,
}: {
  icon: React.ReactNode;
  title: string;
  value: any;
  note: string;
  warning?: boolean;
}) {
  return (
    <div className={'metric ' + (warning ? 'metric-warning' : '')}>
      <div className="metric-title">
        {title}
        {icon}
      </div>
      <strong>{value}</strong>
      <span>{note}</span>
    </div>
  );
}
