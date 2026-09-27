import { useState } from 'react';
import {
  diagnosticSources,
  type DiagnosticBundle,
  type DiagnosticId,
} from '../../shared/diagnostics';
import { download, request } from '../api';
import { DataView } from '../components/DataView';
import { PageHeader, ErrorBox } from '../components/ui';

export function Diagnostics() {
  const [sources, setSources] = useState<DiagnosticId[]>([
    'identity',
    'health',
    'capacity',
    'messages',
  ]);
  const [bundle, setBundle] = useState<DiagnosticBundle>(),
    [selected, setSelected] = useState<DiagnosticId>('identity');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [note, setNote] = useState('');
  async function collect() {
    setBusy(true);
    setError('');
    try {
      const result = await request<DiagnosticBundle>('diagnostics', { sources });
      setBundle(result);
      setSelected(result.sections[0].id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const section = bundle?.sections.find((section) => section.id === selected);
  return (
    <>
      <PageHeader
        title="Diagnostic bundle"
        description="Collect instance data and logs in one report."
      >
        <button
          className="primary"
          disabled={busy || !sources.length}
          onClick={() => void collect()}
        >
          {busy ? 'Collecting sources…' : 'Capture selected sources'}
        </button>
      </PageHeader>
      <section className="panel diagnostics-setup">
        <h2>Sources</h2>
        <p>
          No configuration changes are made. Each source uses your current IRIS permissions and
          records its own outcome.
        </p>
        <div className="diagnostic-sources">
          {diagnosticSources.map((source) => (
            <label key={source.id}>
              <input
                type="checkbox"
                checked={sources.includes(source.id)}
                disabled={busy}
                onChange={(e) =>
                  setSources(
                    e.target.checked
                      ? [...sources, source.id]
                      : sources.filter((id) => id !== source.id),
                  )
                }
              />
              {source.title}
            </label>
          ))}
        </div>
        <label className="field">
          Investigation note
          <textarea
            maxLength={2000}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What prompted this capture? What should the next operator check?"
          />
        </label>
        <p className="scope-note">
          Reports remain in this tab until sign-out or reload. Review operational text before
          sharing an export.
        </p>
      </section>
      {error && <ErrorBox error={error} />}
      {bundle && (
        <section className="panel diagnostic-report">
          <div className="section-heading">
            <div>
              <h2>
                {bundle.sections.every((section) => section.status === 'collected')
                  ? 'Sources collected'
                  : 'Some sources could not be collected'}
              </h2>
              <p>
                {bundle.instance} · {new Date(bundle.finishedAt).toLocaleString()} ·{' '}
                {bundle.sections.filter((section) => section.status === 'collected').length}/
                {bundle.sections.length} sources collected
              </p>
            </div>
            <button onClick={() => download('harbor-diagnostics.json', { ...bundle, note })}>
              Export bundle
            </button>
          </div>
          <details>
            <summary>Capture limits and interpretation</summary>
            <ul>
              {bundle.limits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          </details>
          <div className="diagnostic-layout">
            <nav aria-label="Captured diagnostic sources">
              {bundle.sections.map((section) => (
                <button
                  key={section.id}
                  aria-pressed={selected === section.id}
                  onClick={() => setSelected(section.id)}
                >
                  <strong>{section.title}</strong>
                  <span>
                    {section.status} · {section.elapsedMs} ms
                  </span>
                </button>
              ))}
            </nav>
            {section && (
              <div className="diagnostic-evidence">
                <h3>{section.title}</h3>
                <p>
                  {section.path} · HTTP {section.httpStatus} · {section.observedAt}
                </p>
                {section.notice && <p className="notice">{section.notice}</p>}
                {section.status === 'collected' && <DataView data={section.data} />}
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
