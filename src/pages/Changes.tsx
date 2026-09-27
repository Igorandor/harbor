import { useEffect, useState } from 'react';
import { Download, RefreshCw, Search, X, CheckCircle2, AlertTriangle, Clock3 } from 'lucide-react';
import { download, request } from '../api';
import { DataValue } from '../components/DataView';
import { ChangeImpact } from '../components/ChangeImpact';
import { ErrorBox, Loading, PageHeader } from '../components/ui';
import {
  changeLabels,
  changeNeedsAttention,
  type ChangeRecord,
  type ChangeState,
} from '../../shared/change-record';

type Summary = Omit<ChangeRecord, 'baseline' | 'result' | 'observation' | 'fields' | 'events'> & {
  fieldCount: number;
};
type Listing = { records: Summary[]; unreadable: string[]; total: number };
export function Changes() {
  const [listing, setListing] = useState<Listing>(),
    [selected, setSelected] = useState<ChangeRecord>();
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState('');
  async function load() {
    setBusy(true);
    setError('');
    try {
      setListing(await request<Listing>('changes'));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function inspect(id: string) {
    setBusy(true);
    setError('');
    setConfirmation('');
    try {
      setSelected(await request<ChangeRecord>('changes/' + id));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(action: 'execute' | 'cancel' | 'reconcile') {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<ChangeRecord>('changes/' + selected.id + '/' + action, {
        revision: selected.revision,
        ...(action === 'execute' ? { confirmation } : {}),
      });
      setSelected(result);
      setConfirmation('');
      setListing(await request<Listing>('changes'));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rows = (listing?.records ?? []).filter((record) => {
    const found = (record.target + ' ' + record.path + ' ' + record.title)
      .toLowerCase()
      .includes(query.toLowerCase());
    return (
      found &&
      (filter === 'all' ||
        (filter === 'attention'
          ? ['uncertain', 'sending', 'conflict'].includes(record.state)
          : record.state === filter))
    );
  });
  return (
    <>
      <PageHeader
        title="Change history"
        description="Review administrative requests and their observed results."
      >
        <button disabled={busy} onClick={() => void load()}>
          <RefreshCw size={16} /> Refresh
        </button>
      </PageHeader>
      {error && <ErrorBox error={error} />}
      {listing?.unreadable.length ? (
        <div className="notice warning">
          {listing.unreadable.length} stored records could not be read. Preserve the data directory
          and inspect them before continuing.
        </div>
      ) : null}
      <div className="operations-split">
        <section className="panel record-index" aria-label="Stored changes">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search changes"
              placeholder="Target or operation"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="field">
            Status
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All changes</option>
              <option value="attention">Needs attention</option>
              {Object.entries(changeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {!listing && busy ? <Loading /> : null}
          {rows.map((record) => (
            <button
              key={record.id}
              className={'record-choice ' + (selected?.id === record.id ? 'active' : '')}
              onClick={() => void inspect(record.id)}
            >
              <strong>{record.target}</strong>
              <span>
                {record.method} {record.path}
              </span>
              <ChangeStatus state={record.state} />
              <small>{new Date(record.updatedAt).toLocaleString()}</small>
            </button>
          ))}
          {listing && !rows.length ? (
            <p className="padded muted">No changes match these filters.</p>
          ) : null}
        </section>
        <section className="panel record-workbench" aria-label="Change details">
          {selected ? (
            <>
              <div className="section-heading">
                <div>
                  <h2>{selected.title}</h2>
                  <code>{selected.target}</code>
                </div>
                <button onClick={() => setSelected(undefined)} aria-label="Close change details">
                  <X size={16} />
                </button>
              </div>
              <div className="record-meta">
                <ChangeStatus state={selected.state} />
                <span>Reviewed by {selected.owner}</span>
                <span>{selected.instance}</span>
              </div>
              <p className={changeNeedsAttention(selected) ? 'notice warning' : 'notice'}>
                {selected.explanation}
              </p>
              {selected.impact && <ChangeImpact impact={selected.impact} />}
              <dl className="record-facts">
                <div>
                  <dt>Operation</dt>
                  <dd>
                    <code>
                      {selected.method} {selected.path}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(selected.createdAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Native response</dt>
                  <dd>{selected.nativeStatus ?? 'Not sent'}</dd>
                </div>
                <div>
                  <dt>Record</dt>
                  <dd>
                    <code>{selected.id}</code>
                  </dd>
                </div>
              </dl>
              {selected.fields.length ? (
                <div className="table-scroll">
                  <table className="diff">
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Before</th>
                        <th>Requested</th>
                        <th>Observed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.fields.map((field) => (
                        <tr key={field.name}>
                          <th scope="row">{field.name}</th>
                          <td>
                            <DataValue value={field.before} field={field.name} />
                          </td>
                          <td>
                            <DataValue value={field.requested} field={field.name} />
                          </td>
                          <td>
                            {field.readable ? (
                              <>
                                <DataValue value={field.observed} field={field.name} />
                                {field.matches !== undefined ? (
                                  <small className={field.matches ? 'good-text' : 'warning-text'}>
                                    {field.matches ? 'Matches' : 'Does not match'}
                                  </small>
                                ) : null}
                              </>
                            ) : (
                              'Write-only'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {selected.state === 'prepared' ? (
                <div className="record-actions">
                  <p>
                    Type <strong>{selected.target}</strong> to send this reviewed request once. The
                    review expires at {new Date(selected.expiresAt).toLocaleTimeString()}.
                  </p>
                  <label className="field">
                    Confirm target
                    <input
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <div className="inline-actions">
                    <button disabled={busy} onClick={() => void act('cancel')}>
                      Cancel review
                    </button>
                    <button
                      className="primary"
                      disabled={busy || confirmation !== selected.target}
                      onClick={() => void act('execute')}
                    >
                      Execute reviewed change
                    </button>
                  </div>
                </div>
              ) : null}
              {['uncertain', 'sending'].includes(selected.state) ? (
                <div className="record-actions">
                  <p>
                    Read current state to check this result. This action sends no configuration
                    write.
                  </p>
                  <button disabled={busy} onClick={() => void act('reconcile')}>
                    Check current state
                  </button>
                </div>
              ) : null}
              <div className="inline-actions padded">
                <button disabled={busy} onClick={() => void inspect(selected.id)}>
                  <RefreshCw size={16} /> Refresh record
                </button>
                <button
                  onClick={() => download('harbor-change-' + selected.id + '.json', selected)}
                >
                  <Download size={16} /> Export record
                </button>
              </div>
              <details className="padded">
                <summary>Native response and observation</summary>
                <DataValue value={{ response: selected.result, observed: selected.observation }} />
              </details>
              <h3 className="padded">History</h3>
              <ol className="record-timeline">
                {selected.events.map((event, index) => (
                  <li key={index}>
                    <time>{new Date(event.at).toLocaleString()}</time>
                    <strong>{event.action}</strong>
                    <p>{event.message}</p>
                  </li>
                ))}
              </ol>
              <p className="scope-note padded">
                A verified result describes the recorded readback. Another administrator may change
                the target afterward. Preparation and readback are separate requests, not an atomic
                IRIS transaction.
              </p>
            </>
          ) : (
            <div className="atlas-empty">
              <Clock3 size={32} />
              <h2>Select a change</h2>
              <p>
                Requests made in Harbor appear here with their verification status. Credentials are
                excluded from stored records.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
export function ChangeStatus({ state }: { state: ChangeState }) {
  return (
    <span className={'change-status status-' + state}>
      {state === 'verified' ? (
        <CheckCircle2 size={14} />
      ) : ['uncertain', 'conflict', 'sending'].includes(state) ? (
        <AlertTriangle size={14} />
      ) : (
        <Clock3 size={14} />
      )}{' '}
      {changeLabels[state]}
    </span>
  );
}
