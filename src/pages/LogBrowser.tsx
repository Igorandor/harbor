import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, FileText, RefreshCw, Search } from 'lucide-react';
import { request, download } from '../api';
import { ErrorBox, Loading, PageHeader } from '../components/ui';
import { filterLogLines, logLevel, type LogCatalog, type LogWindow } from '../../shared/log-window';

export function LogBrowser() {
  const generation = useRef(0);
  const [catalog, setCatalog] = useState<LogCatalog>(),
    [file, setFile] = useState('messages.log');
  const [page, setPage] = useState<LogWindow>(),
    [history, setHistory] = useState<LogWindow[]>([]);
  const [query, setQuery] = useState(''),
    [level, setLevel] = useState('all'),
    [limit, setLimit] = useState(200);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<number>();
  const [follow, setFollow] = useState(false),
    [copied, setCopied] = useState(false);
  async function loadCatalog() {
    try {
      setCatalog(await request<LogCatalog>('log-files'));
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function load(cursor?: string, replace = false) {
    if (busy && !replace) return;
    const requestId = ++generation.current;
    setBusy(true);
    setError('');
    setSelected(undefined);
    try {
      const result = await request<LogWindow>('log-page', {
        ...(cursor ? { cursor } : { file }),
        limit,
      });
      if (requestId !== generation.current) return;
      if (cursor && page) setHistory((previous) => [...previous, page].slice(-20));
      else setHistory([]);
      setPage(result);
    } catch (error) {
      if (requestId === generation.current) setError((error as Error).message);
    } finally {
      if (requestId === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void loadCatalog();
  }, []);
  useEffect(() => {
    setPage(undefined);
    setHistory([]);
    void load(undefined, true);
    return () => {
      generation.current++;
    };
  }, [file, limit]);
  useEffect(() => {
    if (!follow) return;
    const timer = setInterval(() => {
      if (!document.hidden && !busy && !history.length) void load();
    }, 15000);
    return () => clearInterval(timer);
  }, [follow, busy, file, limit, history.length]);
  const visible = useMemo(
    () => filterLogLines(page?.lines ?? [], query, level),
    [page, query, level],
  );
  const counts = useMemo(() => {
    const result = { error: 0, warning: 0, information: 0 };
    for (const line of page?.lines ?? []) result[logLevel(line.text)]++;
    return result;
  }, [page]);
  const inspected = page?.lines.find((line) => line.offset === selected);
  const chosen = catalog?.files.find((item) => item.id === file);
  function newer() {
    const previous = history.at(-1);
    if (!previous) return;
    setPage(previous);
    setHistory(history.slice(0, -1));
    setSelected(undefined);
    setError('');
  }
  return (
    <>
      <PageHeader
        title="Log files"
        description="Browse current and rotated system messages and alerts."
      >
        <button
          disabled={busy}
          onClick={() => {
            void loadCatalog();
            void load();
          }}
        >
          <RefreshCw size={16} /> Start a fresh view
        </button>
        <button
          disabled={!page}
          onClick={() =>
            page &&
            download('harbor-' + page.file + '-page.json', {
              ...page,
              olderCursor: undefined,
              lines: visible,
              filter: { query, level },
            })
          }
        >
          <Download size={16} /> Export page
        </button>
      </PageHeader>
      {error ? <ErrorBox error={error} /> : null}
      <section className="panel log-browser">
        <div className="log-browser-controls">
          <label className="field">
            File
            <select
              value={file}
              onChange={(event) => {
                setFollow(false);
                setFile(event.target.value);
              }}
            >
              {!catalog?.files.some((item) => item.id === file) ? (
                <option value={file}>{file}</option>
              ) : null}
              {catalog?.files.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                  {item.active ? ' · current' : ' · rotated'} · {formatBytes(item.bytes)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Lines per page
            <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
              {[100, 200, 500].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              disabled={history.length > 0 || chosen?.active === false}
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
            />{' '}
            Follow current file every 15s
          </label>
        </div>
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search this log page"
              placeholder="Find words on this page"
              value={query}
              maxLength={300}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="inline-label">
            Level
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="all">All ({page?.lines.length ?? 0})</option>
              <option value="error">Error words ({counts.error})</option>
              <option value="warning">Warning words ({counts.warning})</option>
              <option value="information">Other ({counts.information})</option>
            </select>
          </label>
        </div>
        <div className="log-window-status">
          <FileText size={17} />
          <strong>{file}</strong>
          {page ? (
            <>
              <span>
                Bytes {page.start.toLocaleString()}–{page.end.toLocaleString()} of{' '}
                {page.snapshotBytes.toLocaleString()}
              </span>
              <span>Observed {new Date(page.observedAt).toLocaleTimeString()}</span>
              {page.currentBytes > page.snapshotBytes ? (
                <span>
                  {formatBytes(page.currentBytes - page.snapshotBytes)} appended since this view
                  began
                </span>
              ) : null}
            </>
          ) : null}
        </div>
        {!page && busy ? <Loading /> : null}
        {page ? (
          <div className="historical-log" role="region" aria-label="Log page" tabIndex={0}>
            {visible.map((line) => (
              <button
                key={line.offset}
                className={
                  'historical-line line-' +
                  logLevel(line.text) +
                  (selected === line.offset ? ' selected' : '')
                }
                onClick={() => setSelected(line.offset)}
                aria-label={'Inspect line at byte ' + line.offset}
              >
                <span>{line.offset}</span>
                <code>{line.text || ' '}</code>
                {line.clipped ? <small>clipped</small> : null}
              </button>
            ))}
            {!visible.length ? (
              <p className="padded">
                {page.lines.length
                  ? 'No matching lines on this page. Try another filter or open an older page.'
                  : page.notice || 'No complete lines in this page.'}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="table-footer">
          <span>{visible.length} visible lines · Reads scan at most 256 KiB</span>
          <div>
            <button disabled={busy || !history.length} onClick={newer}>
              <ArrowLeft size={15} /> Newer page
            </button>
            <button
              disabled={busy || !page?.olderCursor}
              onClick={() => {
                setFollow(false);
                void load(page?.olderCursor);
              }}
            >
              Older page <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </section>
      {inspected ? (
        <section className="panel log-inspector">
          <div className="section-heading">
            <h2>Line at byte {inspected.offset}</h2>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inspected.text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setError(
                    'The browser could not copy this text. Select the line and copy it manually.',
                  );
                }
              }}
            >
              {copied ? 'Copied' : 'Copy line'}
            </button>
          </div>
          <pre>{inspected.text}</pre>
          <p>
            Word-based level: {logLevel(inspected.text)}. This is a display filter, not an
            authoritative IRIS severity classification.
          </p>
        </section>
      ) : null}
      <p className="scope-note">
        Search covers the displayed page. The cursor stays on a fixed file-size boundary for 30
        minutes and expires on gateway restart. Replacement or truncation requires a new view. Logs
        may contain sensitive application data.
      </p>
      {catalog ? (
        <details className="scope-note">
          <summary>Available sources and limits</summary>
          <p>{catalog.notice}</p>
          {catalog.limited ? (
            <p>
              The catalog reached its file or directory-entry limit. Additional files may exist.
            </p>
          ) : null}
          <p>
            Each line is clipped after 16,384 characters. Exports include only the current filtered
            page. Older pages are retained in browser memory for navigation, up to 20 pages.
          </p>
        </details>
      ) : null}
    </>
  );
}
function formatBytes(value: number) {
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB';
  return (value / (1024 * 1024)).toFixed(1) + ' MiB';
}
