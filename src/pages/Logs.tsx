import { useEffect, useState } from 'react';

import { Download, Search } from 'lucide-react';

import { iris, request, download } from '../api';

import { Empty, ErrorBox, Loading, PageHeader, Refresh, Table } from '../components/ui';

const sources: Record<
  string,
  { label: string; path?: string; columns?: string[]; query?: Record<string, string> }
> = {
  messages: {
    label: 'System messages',
    path: '/extension/logs',
    query: { source: 'messages', limit: '300' },
  },

  alerts: {
    label: 'System alerts',
    path: '/extension/logs',
    query: { source: 'alerts', limit: '300' },
  },

  audit: {
    label: 'Security audit',
    path: '/v2/security/audit/records',
    query: { maxRows: '250', ascending: '0' },
    columns: ['TimeStamp', 'Username', 'Event', 'Description'],
  },

  tasks: {
    label: 'Task history',
    path: '/v2/task/history',
    columns: ['LastStart', 'Name', 'Status', 'Result', 'Username'],
  },

  journal: {
    label: 'Journal files',
    path: '/v2/journal/files',
    columns: ['Name', 'Size', 'CreationTime', 'Reason'],
  },

  activity: { label: 'Portal activity', columns: ['at', 'method', 'path', 'target', 'status'] },
};

export function Logs() {
  const [source, setSource] = useState('messages'),
    [search, setSearch] = useState(''),
    [data, setData] = useState<any>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [at, setAt] = useState<Date>(),
    [version, setVersion] = useState(0),
    [follow, setFollow] = useState(false),
    [from, setFrom] = useState('');

  useEffect(() => {
    let active = true,
      inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        const s = sources[source];
        const result = s.path
          ? (
              await iris(
                s.path,
                {
                  ...s.query,
                  ...(source === 'audit' && from
                    ? { beginDateTime: from.replace('T', ' ') + ':00' }
                    : {}),
                },
                source === 'audit' ? 'POST' : 'GET',
              )
            ).data
          : await request('activity');
        if (active) {
          setData(result);
          setAt(new Date());
          setError('');
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    };
    setData(undefined);
    void load();
    const timer = follow
      ? setInterval(() => {
          if (!document.hidden) void load();
        }, 15000)
      : undefined;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [source, version, follow, from]);

  const lines = data?.lines?.filter((l: string) => l.toLowerCase().includes(search.toLowerCase())),
    rows = Array.isArray(data)
      ? data.filter((r) => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
      : [];

  return (
    <>
      <PageHeader
        title="Logs & activity"
        description="System messages, security audit and task history."
      >
        <button
          disabled={!data}
          onClick={() => download(source + '-log.json', lines ? { ...data, lines } : rows)}
        >
          <Download size={16} /> Export view
        </button>
      </PageHeader>

      <div className="tabs" aria-label="Log sources">
        {Object.entries(sources).map(([id, s]) => (
          <button
            key={id}
            className={source === id ? 'active' : ''}
            aria-pressed={source === id}
            onClick={() => {
              setSource(id);
              setSearch('');
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Filter log entries"
              placeholder="Filter this source…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="toolbar-right">
            {source === 'audit' && (
              <label className="inline-label">
                Since{' '}
                <input
                  type="datetime-local"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
              />{' '}
              Follow · 15s
            </label>
            <Refresh loading={loading} at={at} onClick={() => setVersion((v) => v + 1)} />
          </div>
        </div>
        {error && <ErrorBox error={error} retry={() => setVersion((v) => v + 1)} />}{' '}
        {loading && !data ? (
          <Loading />
        ) : lines ? (
          lines.length ? (
            <div className="log-lines">
              {lines.map((line: string, i: number) => (
                <div
                  key={i}
                  className={
                    /error|severe|failed/i.test(line)
                      ? 'log-error'
                      : /warning/i.test(line)
                        ? 'log-warning'
                        : ''
                  }
                >
                  <span>{i + 1}</span>
                  <code>{line}</code>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="No log entries"
              description={data?.notice ?? 'No entries match your filter.'}
            />
          )
        ) : rows.length ? (
          <Table
            rows={rows}
            columns={sources[source].columns ?? Object.keys(rows[0]).slice(0, 5)}
            keyField={source === 'activity' ? 'at' : 'Name'}
          />
        ) : (
          !error && (
            <Empty
              title="No entries returned"
              description={
                source === 'audit'
                  ? 'The audit database may be empty or auditing may be disabled.'
                  : 'This source has no entries matching the current view.'
              }
            />
          )
        )}
        <div className="table-footer">
          <span>
            {source === 'activity'
              ? 'Last 100 requests in this portal session; not a durable audit trail.'
              : source === 'messages' || source === 'alerts'
                ? 'Latest 300 lines, bounded to 1 MB. Times are written by the IRIS host.'
                : 'Up to 250 records. Use REST explorer for additional source filters.'}
          </span>
        </div>
      </section>
      <p className="scope-note">
        Operational logs can contain sensitive application data. Exports contain the visible source
        data; review them before sharing.
      </p>
    </>
  );
}
