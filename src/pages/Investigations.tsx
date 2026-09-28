import { useEffect, useRef, useState } from 'react';
import { Download, FilePlus2, Search, RefreshCw, Camera, X } from 'lucide-react';
import { request, download, RequestError, creationFailure } from '../api';
import { ErrorBox, Loading, Modal, PageHeader } from '../components/ui';
import { DataValue } from '../components/DataView';
import { InvestigationChecklist } from '../components/InvestigationChecklist';
import { EvidenceWorkbench } from '../components/EvidenceWorkbench';
import { diagnosticSources, type DiagnosticId } from '../../shared/diagnostics';
import { investigationReport } from '../../shared/investigation-report';
import {
  caseSeverity,
  caseStatus,
  type Investigation,
  type CaseSummary,
  type CaseCapture,
} from '../../shared/investigation';

type Listing = { records: CaseSummary[]; unreadable: string[]; total: number };
export function Investigations({
  created,
  onCreatedConsumed,
}: {
  created?: Investigation;
  onCreatedConsumed?: () => void;
} = {}) {
  const [listing, setListing] = useState<Listing>(),
    [selected, setSelected] = useState<Investigation | undefined>(() => created);
  const [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState('active');
  const [accessCheckId, setAccessCheckId] = useState<string>();
  const [mutationErrorAttempt, setMutationErrorAttempt] = useState(0);
  const mutationErrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mutationErrorAttempt) return;
    mutationErrorRef.current?.focus({ preventScroll: true });
    mutationErrorRef.current?.scrollIntoView({ block: 'center' });
  }, [mutationErrorAttempt]);
  const pending = useRef(false),
    generation = useRef(0);
  function begin() {
    // The ref also rejects clicks queued before React renders disabled controls.
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    return ++generation.current;
  }
  function finish(requestGeneration: number) {
    if (requestGeneration !== generation.current) return;
    pending.current = false;
    setBusy(false);
  }
  function acceptListing(value: Listing) {
    setListing(value);
    setAccessCheckId((id) => (value.records.some((record) => record.id === id) ? undefined : id));
    setSelected((current) =>
      current &&
      (value.records.some((record) => record.id === current.id) ||
        value.unreadable.includes(current.id))
        ? current
        : undefined,
    );
  }
  function clearDeniedListing(error: unknown) {
    if (error instanceof RequestError && error.status === 403) {
      setListing(undefined);
      setSelected(undefined);
    }
  }
  async function load() {
    const requestGeneration = begin();
    if (requestGeneration === undefined) return;
    try {
      const value = await request<Listing>('investigations');
      if (requestGeneration === generation.current) acceptListing(value);
    } catch (error) {
      if (requestGeneration === generation.current) {
        clearDeniedListing(error);
        setError((error as Error).message);
      }
    } finally {
      finish(requestGeneration);
    }
  }
  useEffect(() => {
    if (created) onCreatedConsumed?.();
    void load();
    return () => {
      ++generation.current;
      pending.current = false;
    };
  }, []);
  function removeDeniedCase(id: string) {
    setSelected((current) => (current?.id === id ? undefined : current));
    setAccessCheckId((current) => (current === id ? undefined : current));
    setListing(
      (current) =>
        current && {
          ...current,
          records: current.records.filter((record) => record.id !== id),
          unreadable: current.unreadable.filter((recordId) => recordId !== id),
        },
    );
  }
  async function inspect(id: string) {
    const requestGeneration = begin();
    if (requestGeneration === undefined) return;
    try {
      const value = await request<Investigation>('investigations/' + id);
      if (requestGeneration === generation.current) {
        setSelected(value);
        setAccessCheckId((current) => (current === id ? undefined : current));
      }
    } catch (error) {
      if (requestGeneration === generation.current) {
        if (error instanceof RequestError && [403, 404].includes(error.status))
          removeDeniedCase(id);
        setError((error as Error).message);
      }
    } finally {
      finish(requestGeneration);
    }
  }
  async function change(action: string, input: Record<string, unknown>) {
    if (!selected) return false;
    const requestGeneration = begin();
    if (requestGeneration === undefined) return false;
    let mutationFailed = false;
    try {
      const value = await request<Investigation>('investigations/' + selected.id + '/' + action, {
        ...input,
        revision: selected.revision,
      });
      if (requestGeneration !== generation.current) return true;
      setSelected(value);
      try {
        const refreshed = await request<Listing>('investigations');
        if (requestGeneration === generation.current) acceptListing(refreshed);
      } catch (error) {
        if (requestGeneration === generation.current) {
          clearDeniedListing(error);
          setError('Investigation saved. Could not refresh the list: ' + (error as Error).message);
        }
      }
      return true;
    } catch (error) {
      if (requestGeneration !== generation.current) return false;
      mutationFailed = true;
      const unknownSave =
        error instanceof TypeError ||
        (error instanceof RequestError &&
          (error.status >= 500 || (error.status >= 200 && error.status < 300)));
      setError(
        unknownSave && (action === 'notes' || action === 'captures')
          ? action === 'notes'
            ? `Could not confirm whether the note was saved. Refresh this investigation and check Timeline before saving again. Your draft is kept. ${(error as Error).message}`
            : `Could not confirm whether the capture was saved. Refresh this investigation and check Captures before collecting again. Your draft is kept. ${(error as Error).message}`
          : (error as Error).message,
      );
      if (error instanceof RequestError && error.status === 403) {
        // The refusal may concern a new linked change rather than this case.
        // Revalidate the case itself before retaining its evidence and exports.
        const id = selected.id;
        setAccessCheckId(id);
        try {
          const value = await request<Investigation>('investigations/' + id);
          if (requestGeneration !== generation.current) return false;
          setSelected((current) => (current?.id === id ? value : current));
          setAccessCheckId((current) => (current === id ? undefined : current));
        } catch (readError) {
          if (requestGeneration !== generation.current) return false;
          if (readError instanceof RequestError && [403, 404].includes(readError.status)) {
            removeDeniedCase(id);
            setError((readError as Error).message);
          } else {
            setError(
              'The change was refused. Could not confirm current access to this investigation: ' +
                (readError as Error).message,
            );
          }
        }
      }
      return false;
    } finally {
      finish(requestGeneration);
      if (mutationFailed && requestGeneration === generation.current)
        setMutationErrorAttempt((attempt) => attempt + 1);
    }
  }
  const records = (listing?.records ?? []).filter(
    (record) =>
      (status === 'all' ||
        (status === 'active'
          ? !['resolved', 'archived'].includes(record.status)
          : record.status === status)) &&
      (record.title + ' ' + record.description + ' ' + record.tags.join(' '))
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        title="Investigations"
        description="Keep diagnostic captures, notes and related changes together."
      >
        <button disabled={busy} onClick={() => void load()}>
          <RefreshCw size={16} /> Refresh
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            if (!pending.current) setCreating(true);
          }}
        >
          <FilePlus2 size={16} /> New investigation
        </button>
      </PageHeader>
      {error && (
        <div ref={mutationErrorRef} tabIndex={-1}>
          <ErrorBox error={error} />
        </div>
      )}
      {listing?.unreadable.length ? (
        <div className="notice warning">
          {listing.unreadable.length} stored investigations could not be read. Preserve the data
          directory before recovery.
        </div>
      ) : null}
      <div className="operations-split investigation-workspace">
        <section className="panel record-index" aria-label="Investigations">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search investigations"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, description or tag"
            />
          </label>
          <label className="field">
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="active">Active investigations</option>
              <option value="all">All investigations</option>
              {caseStatus.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {!listing && busy ? <Loading /> : null}
          {records.map((record) => (
            <button
              key={record.id}
              disabled={busy}
              className={'record-choice ' + (selected?.id === record.id ? 'active' : '')}
              onClick={() => void inspect(record.id)}
            >
              <strong>{record.title}</strong>
              <span>
                {record.severity} · {record.status}
              </span>
              <small>
                {record.captureCount} captures · {record.noteCount} entries
              </small>
              <small>{new Date(record.updatedAt).toLocaleString()}</small>
            </button>
          ))}
          {listing && !records.length ? (
            <p className="padded muted">No investigations match this view.</p>
          ) : null}
        </section>
        {selected ? (
          <div>
            {accessCheckId === selected.id && (
              <section className="panel padded" role="status">
                <h2>Checking investigation access</h2>
                <p>
                  The last change was refused. Saved evidence and exports are hidden until this
                  investigation can be read again. Your draft is kept in this session.
                </p>
                <button disabled={busy} onClick={() => void inspect(selected.id)}>
                  Check access again
                </button>
              </section>
            )}
            <div hidden={accessCheckId === selected.id}>
              <CaseDetail
                key={selected.id}
                record={selected}
                busy={busy}
                onChange={change}
                onRefresh={() => void inspect(selected.id)}
                onClose={() => {
                  if (!pending.current) setSelected(undefined);
                }}
              />
            </div>
          </div>
        ) : (
          <section className="panel record-workbench">
            <div className="atlas-empty">
              <Search size={32} />
              <h2>Select an investigation</h2>
              <p>
                Create an investigation to retain captures and notes across gateway restarts.
                Records are scoped to your IRIS account and this instance.
              </p>
            </div>
          </section>
        )}
      </div>
      {creating ? (
        <NewCase
          onClose={() => setCreating(false)}
          onCreated={(value) => {
            setSelected(value);
            setCreating(false);
            void load();
          }}
        />
      ) : null}
    </>
  );
}
function NewCase({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (record: Investigation) => void;
}) {
  const [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [severity, setSeverity] = useState<Investigation['severity']>('minor'),
    [tags, setTags] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const [failure, setFailure] = useState(0);
  useEffect(() => {
    if (!failure) return;
    errorRef.current?.focus({ preventScroll: true });
    errorRef.current?.scrollIntoView({ block: 'center' });
  }, [failure]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      onCreated(
        await request<Investigation>('investigations', {
          title,
          description,
          severity,
          tags: tags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      );
    } catch (error) {
      setError(creationFailure(error, 'investigations'));
      setFailure((value) => value + 1);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="New investigation"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <form onSubmit={(event) => void create(event)}>
        <div className="modal-body">
          {error ? (
            <div ref={errorRef} tabIndex={-1}>
              <ErrorBox error={error} />
            </div>
          ) : null}
          <label className="field">
            Title
            <input
              disabled={busy}
              required
              minLength={3}
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            What needs investigation?
            <textarea
              disabled={busy}
              required
              rows={5}
              maxLength={4000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="field">
            Severity
            <select
              disabled={busy}
              value={severity}
              onChange={(event) => setSeverity(event.target.value as Investigation['severity'])}
            >
              {caseSeverity.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Tags
            <input
              disabled={busy}
              value={tags}
              maxLength={480}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Comma-separated, up to 12 tags"
            />
          </label>
        </div>
        <footer>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!pending.current) onClose();
            }}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy} type="submit">
            Create investigation
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function CaseDetail({
  record,
  busy,
  onChange,
  onRefresh,
  onClose,
}: {
  record: Investigation;
  busy: boolean;
  onChange: (action: string, input: Record<string, unknown>) => Promise<boolean>;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState('timeline'),
    [note, setNote] = useState(''),
    [statusReason, setStatusReason] = useState(''),
    [changeContext, setChangeContext] = useState(''),
    [nextStatus, setNextStatus] = useState<Investigation['status']>('investigating');
  const [captureTitle, setCaptureTitle] = useState(''),
    [sources, setSources] = useState<DiagnosticId[]>(
      record.profile?.sources ?? ['identity', 'health', 'capacity', 'messages'],
    );
  const [captureId, setCaptureId] = useState(''),
    [changeId, setChangeId] = useState('');
  const selectedCapture =
    record.captures.find((capture) => capture.id === captureId) ?? record.captures.at(-1);
  const editable = record.status !== 'archived';
  useEffect(() => {
    setNextStatus(
      record.status === 'archived' ? 'open' : record.status === 'open' ? 'investigating' : 'open',
    );
  }, [record.status]);
  return (
    <section className="panel record-workbench">
      <div className="section-heading">
        <div>
          <h2>{record.title}</h2>
          <p>{record.description}</p>
        </div>
        <button aria-label="Close investigation" disabled={busy} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="record-meta">
        <strong>{record.severity}</strong>
        <span>{record.status}</span>
        <span>{record.owner}</span>
        <span>{record.instance}</span>
      </div>
      <div className="inline-actions padded">
        <button disabled={busy} onClick={onRefresh}>
          <RefreshCw size={16} /> Refresh
        </button>
        <button onClick={() => download('harbor-investigation-' + record.id + '.json', record)}>
          <Download size={16} /> Export investigation
        </button>
        <button onClick={() => printCase(record)}>
          <Download size={16} /> Download report
        </button>
      </div>
      <nav className="tabs" aria-label="Investigation sections">
        {[
          ['timeline', 'Timeline'],
          ['checklist', 'Checklist'],
          ['captures', 'Captures'],
          ['compare', 'Compare captures'],
          ['status', 'Status'],
          ['changes', 'Related changes'],
        ].map(([id, label]) => (
          <button
            key={id}
            disabled={busy}
            aria-pressed={view === id}
            className={view === id ? 'active' : ''}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {view === 'checklist' ? (
        <InvestigationChecklist
          record={record}
          busy={busy}
          onUpdate={(itemId, state, note) => onChange('checklist', { itemId, state, note })}
        />
      ) : null}
      {view === 'timeline' ? (
        <>
          {editable ? (
            <form
              className="record-actions"
              onSubmit={async (event) => {
                event.preventDefault();
                if (await onChange('notes', { text: note }))
                  setNote((current) => (current === note ? '' : current));
              }}
            >
              <label className="field">
                Add a note
                <textarea
                  required
                  disabled={busy}
                  maxLength={4000}
                  rows={4}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="What changed, what was checked, and the next action"
                />
              </label>
              <button className="primary" disabled={busy || !note.trim()}>
                Save note
              </button>
            </form>
          ) : null}
          <ol className="record-timeline">
            {[...record.notes].reverse().map((entry) => (
              <li key={entry.id}>
                <time>{new Date(entry.at).toLocaleString()}</time>
                <strong>
                  {entry.author} · {entry.kind}
                </strong>
                <p>{entry.text}</p>
                {entry.captureId ? (
                  <button
                    className="text-link"
                    onClick={() => {
                      setCaptureId(entry.captureId!);
                      setView('captures');
                    }}
                  >
                    Open capture
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {!record.notes.length ? <p className="padded muted">No timeline entries yet.</p> : null}
        </>
      ) : null}
      {view === 'captures' ? (
        <>
          {!['resolved', 'archived'].includes(record.status) ? (
            <form
              className="record-actions"
              onSubmit={async (event) => {
                event.preventDefault();
                if (await onChange('captures', { title: captureTitle, sources }))
                  setCaptureTitle((current) => (current === captureTitle ? '' : current));
              }}
            >
              <h3>Capture current data</h3>
              <label className="field">
                Capture title
                <input
                  required
                  disabled={busy}
                  maxLength={120}
                  value={captureTitle}
                  onChange={(event) => setCaptureTitle(event.target.value)}
                  placeholder="Before maintenance, after restart…"
                />
              </label>
              <div className="diagnostic-sources">
                {diagnosticSources.map((source) => (
                  <label key={source.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={sources.includes(source.id)}
                      onChange={(event) =>
                        setSources(
                          event.target.checked
                            ? [...sources, source.id]
                            : sources.filter((id) => id !== source.id),
                        )
                      }
                    />
                    {source.title}
                  </label>
                ))}
              </div>
              <button
                className="primary"
                disabled={busy || !sources.length || !captureTitle.trim()}
              >
                <Camera size={16} /> Capture selected sources
              </button>
              <small>{record.captures.length} / 12 captures</small>
            </form>
          ) : null}
          <div className="padded">
            <label className="field">
              Saved capture
              <select
                value={selectedCapture?.id ?? ''}
                onChange={(event) => setCaptureId(event.target.value)}
              >
                <option value="" disabled>
                  Choose a capture
                </option>
                {record.captures.map((capture) => (
                  <option key={capture.id} value={capture.id}>
                    {capture.title} · {new Date(capture.bundle.finishedAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedCapture ? (
            <CaptureView capture={selectedCapture} />
          ) : (
            <p className="padded muted">No data has been captured for this investigation.</p>
          )}
        </>
      ) : null}
      {view === 'compare' ? (
        <EvidenceWorkbench record={record} busy={busy} onChange={onChange} />
      ) : null}
      {view === 'status' ? (
        <form
          className="record-actions"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onChange('status', { status: nextStatus, reason: statusReason }))
              setStatusReason((current) => (current === statusReason ? '' : current));
          }}
        >
          <h3>Change investigation status</h3>
          <p>
            Current status: <strong>{record.status}</strong>
          </p>
          {record.resolution ? <blockquote>{record.resolution}</blockquote> : null}
          <label className="field">
            New status
            <select
              value={nextStatus}
              disabled={busy}
              onChange={(event) => setNextStatus(event.target.value as Investigation['status'])}
            >
              {caseStatus
                .filter((value) => value !== record.status)
                .map((value) => (
                  <option key={value}>{value}</option>
                ))}
            </select>
          </label>
          <label className="field">
            Reason or resolution
            <textarea
              required
              disabled={busy}
              rows={4}
              maxLength={4000}
              value={statusReason}
              onChange={(event) => setStatusReason(event.target.value)}
            />
          </label>
          <button className="primary" disabled={busy || !statusReason.trim()}>
            Save status
          </button>
          <p className="scope-note">
            Resolve an investigation before archiving. Archived records can be reopened; their
            captures and prior notes remain unchanged.
          </p>
        </form>
      ) : null}
      {view === 'changes' ? (
        <div className="record-actions">
          <h3>Related administrative changes</h3>
          <p>
            Link a change record from Change history to document an action taken during this
            investigation.
          </p>
          {record.linkedChanges.map((id) => (
            <p key={id}>
              <code>{id}</code>
            </p>
          ))}
          {editable ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (await onChange('changes', { changeId, note: changeContext })) {
                  setChangeId((current) => (current === changeId ? '' : current));
                  setChangeContext((current) => (current === changeContext ? '' : current));
                }
              }}
            >
              <label className="field">
                Change record ID
                <input
                  required
                  disabled={busy}
                  value={changeId}
                  onChange={(event) => setChangeId(event.target.value)}
                  maxLength={36}
                />
              </label>
              <label className="field">
                Context
                <textarea
                  disabled={busy}
                  value={changeContext}
                  onChange={(event) => setChangeContext(event.target.value)}
                  maxLength={4000}
                  rows={3}
                />
              </label>
              <button disabled={busy || changeId.length !== 36}>Link change</button>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
function CaptureView({ capture }: { capture: CaseCapture }) {
  return (
    <div className="padded">
      <h3>{capture.title}</h3>
      <p>
        {new Date(capture.bundle.finishedAt).toLocaleString()} · {capture.capturedBy}
      </p>
      {capture.bundle.sections.map((section) => (
        <details key={section.id} className="capture-source">
          <summary>
            <strong>{section.title}</strong>
            <span>{section.status}</span>
          </summary>
          <p>{section.notice}</p>
          <small>
            {section.path} · {section.observedAt} · {section.elapsedMs} ms
          </small>
          {section.data !== undefined ? <DataValue value={section.data} /> : null}
        </details>
      ))}
      <details className="scope-note">
        <summary>Capture limits</summary>
        <ul>
          {capture.bundle.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
function printCase(record: Investigation) {
  const html = investigationReport(record);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' })),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'harbor-investigation-' + record.id + '.html';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
