import { useState } from 'react';
import { Download, Play, Search } from 'lucide-react';
import { parameters, plainDescription, readablePaths } from '../../shared/schema';
import { iris, download, type ApiResult } from '../api';
import { Badge, ErrorBox, PageHeader } from '../components/ui';
export function Explorer() {
  const [search, setSearch] = useState(''),
    [path, setPath] = useState('/info'),
    [query, setQuery] = useState<Record<string, string>>({}),
    [result, setResult] = useState<ApiResult>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [elapsed, setElapsed] = useState(0);
  const selected = readablePaths.find((p) => p.path === path);
  async function run() {
    setLoading(true);
    setError('');
    setResult(undefined);
    const start = performance.now();
    try {
      setResult(
        await iris(path, Object.fromEntries(Object.entries(query).filter(([, v]) => v !== ''))),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setElapsed(Math.round(performance.now() - start));
      setLoading(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Developer tools"
        title="REST explorer"
        description="Explore the official SysAdmin API using your current IRIS permissions."
      />
      <div className="explorer">
        <aside className="panel endpoint-list">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search endpoints"
              placeholder="Find an endpoint…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            {readablePaths
              .filter((p) => (p.path + p.summary).toLowerCase().includes(search.toLowerCase()))
              .map((p) => (
                <button
                  key={p.path}
                  className={path === p.path ? 'selected' : ''}
                  onClick={() => {
                    setPath(p.path);
                    setQuery({});
                    setResult(undefined);
                    setError('');
                  }}
                >
                  <span>GET</span>
                  <code>{p.path}</code>
                </button>
              ))}
          </div>
        </aside>
        <section className="panel endpoint-workbench">
          <div className="endpoint-title">
            <Badge tone="good">GET</Badge>
            <code>/api/admin{path}</code>
          </div>
          <p>{plainDescription(selected?.summary)}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <div className="form-grid">
              {parameters(path).map((p) => (
                <div className="field" key={p.name}>
                  <label htmlFor={'query-' + p.name}>
                    {p.name}
                    {p.required ? ' *' : ''}
                  </label>
                  <input
                    id={'query-' + p.name}
                    required={p.required}
                    value={query[p.name] ?? ''}
                    placeholder={
                      p.schema?.type === 'integer' ? 'Number' : p.example ? String(p.example) : ''
                    }
                    onChange={(e) => setQuery({ ...query, [p.name]: e.target.value })}
                  />
                  <small>{plainDescription(p.description)}</small>
                </div>
              ))}
            </div>
            <button className="primary" disabled={loading}>
              <Play size={15} />
              {loading ? 'Waiting for IRIS…' : 'Send request'}
            </button>
          </form>
          <div className="notice">
            Exploration is read-only. Use the workspace editors for administrative changes.
            Secret-value endpoints are excluded.
          </div>
          {error && <ErrorBox error={error} />}{' '}
          {result && (
            <>
              <div className="response-heading">
                <Badge tone="good">HTTP {result.status}</Badge>
                <span>{elapsed} ms</span>
                <button
                  className="subtle small"
                  onClick={() => download('iris-response.json', result.data)}
                >
                  <Download size={14} /> Save response
                </button>
              </div>
              <pre className="json-output">{JSON.stringify(result.data, null, 2)}</pre>
              {result.console?.length > 0 && <pre>{result.console.join('\n')}</pre>}
            </>
          )}
        </section>
      </div>
    </>
  );
}
