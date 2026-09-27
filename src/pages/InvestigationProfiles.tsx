import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  FilePlus2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { download, request } from '../api';
import { ErrorBox, Modal, PageHeader } from '../components/ui';
import { diagnosticSources } from '../../shared/diagnostics';
import {
  importProfile,
  profileExport,
  profileInputSchema,
  sourceTitle,
  starterProfiles,
  type InvestigationProfile,
  type ProfileDefinition,
  type ProfileSummary,
} from '../../shared/investigation-profile';
import { caseSeverity } from '../../shared/investigation';

type ProfileListing = { records: ProfileSummary[]; unreadable: string[] };
export function InvestigationProfiles({ onStarted }: { onStarted: () => void }) {
  const [listing, setListing] = useState<ProfileListing>(),
    [selected, setSelected] = useState<InvestigationProfile>();
  const [editing, setEditing] = useState<ProfileDefinition>(),
    [editTarget, setEditTarget] = useState<Pick<InvestigationProfile, 'id' | 'revision'>>(),
    [starting, setStarting] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [includeArchived, setIncludeArchived] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const selectionRequest = useRef(0);
  async function load() {
    setError('');
    try {
      setListing(await request<ProfileListing>('investigation-profiles'));
    } catch (error) {
      setError((error as Error).message);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      selectionRequest.current++;
    };
  }, []);
  async function inspect(id: string) {
    const generation = ++selectionRequest.current;
    setBusy(true);
    setError('');
    try {
      const profile = await request<InvestigationProfile>('investigation-profiles/' + id);
      if (generation === selectionRequest.current) setSelected(profile);
    } catch (error) {
      if (generation === selectionRequest.current) setError((error as Error).message);
    } finally {
      if (generation === selectionRequest.current) setBusy(false);
    }
  }
  async function save(definition: ProfileDefinition, reason: string) {
    const generation = ++selectionRequest.current;
    setBusy(true);
    try {
      const profile = editTarget
        ? await request<InvestigationProfile>(
            'investigation-profiles/' + editTarget.id + '/revise',
            { definition, revision: editTarget.revision, reason },
          )
        : await request<InvestigationProfile>('investigation-profiles', definition);
      if (generation === selectionRequest.current) setSelected(profile);
      setEditing(undefined);
      void load();
    } finally {
      if (generation === selectionRequest.current) setBusy(false);
    }
  }
  async function status() {
    if (!selected) return;
    const generation = ++selectionRequest.current;
    setBusy(true);
    setError('');
    try {
      const profile = await request<InvestigationProfile>(
        'investigation-profiles/' + selected.id + '/status',
        { revision: selected.revision, archived: selected.status === 'active' },
      );
      if (generation === selectionRequest.current) setSelected(profile);
      void load();
    } catch (error) {
      if (generation === selectionRequest.current) setError((error as Error).message);
    } finally {
      if (generation === selectionRequest.current) setBusy(false);
    }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 64000) throw new Error('Profile files are limited to 64 KB.');
      const definition = importProfile(JSON.parse(await file.text()));
      setEditing(definition);
      setEditTarget(undefined);
      setError('');
    } catch (error) {
      setError('Could not import the profile: ' + (error as Error).message);
    }
  }
  const definition = (profile: InvestigationProfile): ProfileDefinition => ({
    title: profile.title,
    description: profile.description,
    sources: profile.sources,
    steps: profile.steps,
  });
  return (
    <>
      <PageHeader
        title="Investigation profiles"
        description="Reuse source selections and review checklists for recurring operational work."
      >
        <button disabled={busy} onClick={() => void load()}>
          <RefreshCw size={16} /> Refresh
        </button>
        <button onClick={() => importInput.current?.click()}>
          <Upload size={16} /> Import profile
        </button>
        <button
          className="primary"
          onClick={() => {
            setEditing({
              title: '',
              description: '',
              sources: ['identity', 'health', 'messages'],
              steps: [{ title: '', instruction: '', required: true }],
            });
            setEditTarget(undefined);
          }}
        >
          <Plus size={16} /> New profile
        </button>
      </PageHeader>
      <input
        type="file"
        accept="application/json,.json"
        ref={importInput}
        hidden
        onChange={(event) => {
          void importFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {error ? <ErrorBox error={error} /> : null}
      {listing?.unreadable.length ? (
        <p className="notice warning">
          {listing.unreadable.length} profiles could not be read. Preserve the files for inspection.
        </p>
      ) : null}
      <div className="operations-split">
        <section className="panel record-index">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />{' '}
            Include archived profiles
          </label>
          {listing?.records
            .filter((profile) => includeArchived || profile.status === 'active')
            .map((profile) => (
              <button
                className={'record-choice ' + (selected?.id === profile.id ? 'active' : '')}
                key={profile.id}
                onClick={() => void inspect(profile.id)}
              >
                <strong>{profile.title}</strong>
                <span>
                  {profile.stepCount} steps · {profile.requiredCount} required
                </span>
                <small>
                  Revision {profile.revision} · {profile.status}
                </small>
              </button>
            ))}
          {!listing?.records.length ? (
            <p>No saved profiles yet. Start with a template below or create your own.</p>
          ) : null}
          <h3>Starting templates</h3>
          {starterProfiles.map((profile, index) => (
            <button
              className="record-choice"
              key={index}
              onClick={() => {
                setEditing(structuredClone(profile));
                setEditTarget(undefined);
              }}
            >
              <strong>{profile.title}</strong>
              <small>{profile.steps.length} checklist items</small>
            </button>
          ))}
        </section>
        <section className="panel record-workbench">
          {selected ? (
            <>
              <div className="section-heading">
                <div>
                  <h2>{selected.title}</h2>
                  <p>{selected.description}</p>
                </div>
              </div>
              <div className="record-meta">
                <strong>{selected.status}</strong>
                <span>Revision {selected.revision}</span>
                <span>{selected.owner}</span>
                <span>{selected.instance}</span>
              </div>
              <div className="inline-actions padded">
                <button
                  className="primary"
                  disabled={busy || selected.status !== 'active'}
                  onClick={() => setStarting(true)}
                >
                  <Play size={16} /> Start investigation
                </button>
                <button
                  disabled={busy || selected.status !== 'active'}
                  onClick={() => {
                    setEditing(definition(selected));
                    setEditTarget({ id: selected.id, revision: selected.revision });
                  }}
                >
                  Edit profile
                </button>
                <button
                  onClick={() => {
                    setEditing({ ...definition(selected), title: selected.title + ' copy' });
                    setEditTarget(undefined);
                  }}
                >
                  <Copy size={16} /> Duplicate
                </button>
                <button
                  onClick={() =>
                    download('harbor-profile-' + selected.id + '.json', profileExport(selected))
                  }
                >
                  <Download size={16} /> Export
                </button>
                <button disabled={busy} onClick={() => void status()}>
                  {selected.status === 'active' ? 'Archive' : 'Restore'}
                </button>
              </div>
              <div className="padded">
                <h3>Suggested capture sources</h3>
                <div className="profile-source-tags">
                  {selected.sources.map((source) => (
                    <span key={source}>{sourceTitle(source)}</span>
                  ))}
                </div>
                <h3>Investigation checklist</h3>
                <ol className="profile-steps">
                  {selected.steps.map((step, index) => (
                    <li key={index}>
                      <strong>{step.title}</strong>
                      <span>{step.required ? 'Required before resolution' : 'Optional'}</span>
                      <p>{step.instruction}</p>
                    </li>
                  ))}
                </ol>
                <p className="scope-note">
                  Starting an investigation copies this profile’s current revision. Later edits do
                  not rewrite checklists or decisions in existing investigations. The profile issues
                  no native writes.
                </p>
                {selected.history.length ? (
                  <details>
                    <summary>Previous definitions ({selected.history.length} retained)</summary>
                    {[...selected.history].reverse().map((entry) => (
                      <section key={entry.revision} className="profile-history">
                        <h4>Revision {entry.revision}</h4>
                        <time>{new Date(entry.at).toLocaleString()}</time>
                        <p>{entry.reason}</p>
                        <strong>{entry.definition.title}</strong>
                        <p>{entry.definition.description}</p>
                        <ol>
                          {entry.definition.steps.map((step, index) => (
                            <li key={index}>{step.title}</li>
                          ))}
                        </ol>
                      </section>
                    ))}
                  </details>
                ) : null}
              </div>
            </>
          ) : (
            <div className="atlas-empty">
              <FilePlus2 size={32} />
              <h2>Select or create a profile</h2>
              <p>
                A profile saves the checks your team repeats. Each new investigation records its own
                outcomes and captured data.
              </p>
            </div>
          )}
        </section>
      </div>
      {editing ? (
        <ProfileEditor
          initial={editing}
          existing={Boolean(editTarget)}
          onClose={() => setEditing(undefined)}
          onSave={save}
        />
      ) : null}
      {starting && selected ? (
        <StartProfile profile={selected} onClose={() => setStarting(false)} onStarted={onStarted} />
      ) : null}
    </>
  );
}
function ProfileEditor({
  initial,
  existing,
  onClose,
  onSave,
}: {
  initial: ProfileDefinition;
  existing: boolean;
  onClose: () => void;
  onSave: (definition: ProfileDefinition, reason: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial)),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= draft.steps.length) return;
    const steps = [...draft.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    setDraft({ ...draft, steps });
  }
  function edit(index: number, key: 'title' | 'instruction' | 'required', value: string | boolean) {
    setDraft({
      ...draft,
      steps: draft.steps.map((step, at) => (at === index ? { ...step, [key]: value } : step)),
    });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const parsed = profileInputSchema.parse(draft);
      await onSave(parsed, reason);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={existing ? 'Edit investigation profile' : 'New investigation profile'}
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="modal-body">
          {error ? <ErrorBox error={error} /> : null}
          <label className="field">
            Title
            <input
              required
              minLength={3}
              maxLength={120}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label className="field">
            Purpose
            <textarea
              required
              maxLength={3000}
              rows={3}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          <fieldset className="profile-source-fieldset">
            <legend>Suggested sources</legend>
            <div className="diagnostic-sources">
              {diagnosticSources.map((source) => (
                <label key={source.id}>
                  <input
                    type="checkbox"
                    checked={draft.sources.includes(source.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        sources: event.target.checked
                          ? [...draft.sources, source.id]
                          : draft.sources.filter((id) => id !== source.id),
                      })
                    }
                  />
                  {source.title}
                </label>
              ))}
            </div>
          </fieldset>
          <h3>Checklist ({draft.steps.length} / 20)</h3>
          {draft.steps.map((step, index) => (
            <section className="profile-step-editor" key={index}>
              <div className="inline-actions">
                <strong>Step {index + 1}</strong>
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={'Move step ' + (index + 1) + ' earlier'}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  disabled={index === draft.steps.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={'Move step ' + (index + 1) + ' later'}
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  disabled={draft.steps.length === 1}
                  onClick={() =>
                    setDraft({ ...draft, steps: draft.steps.filter((_, at) => at !== index) })
                  }
                  aria-label={'Remove step ' + (index + 1)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <label className="field">
                Check title
                <input
                  required
                  minLength={3}
                  maxLength={160}
                  value={step.title}
                  onChange={(event) => edit(index, 'title', event.target.value)}
                />
              </label>
              <label className="field">
                Instructions
                <textarea
                  required
                  maxLength={2000}
                  rows={3}
                  value={step.instruction}
                  onChange={(event) => edit(index, 'instruction', event.target.value)}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={step.required}
                  onChange={(event) => edit(index, 'required', event.target.checked)}
                />{' '}
                Require a recorded outcome before resolution
              </label>
            </section>
          ))}
          <button
            type="button"
            disabled={draft.steps.length >= 20}
            onClick={() =>
              setDraft({
                ...draft,
                steps: [...draft.steps, { title: '', instruction: '', required: true }],
              })
            }
          >
            <Plus size={15} /> Add checklist item
          </button>
          {existing ? (
            <label className="field">
              Reason for revision
              <textarea
                required
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
              />
            </label>
          ) : null}
          <p className="scope-note">
            Profiles contain instructions and allowed source selections. They cannot run shell
            commands, scripts or arbitrary API requests.
          </p>
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !draft.sources.length}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function StartProfile({
  profile,
  onClose,
  onStarted,
}: {
  profile: InvestigationProfile;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [title, setTitle] = useState(profile.title),
    [description, setDescription] = useState(profile.description),
    [severity, setSeverity] = useState('minor'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function start(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('investigation-profiles/' + profile.id + '/start', {
        revision: profile.revision,
        investigation: { title, description, severity, tags: [] },
      });
      onStarted();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Start investigation"
      subtitle={profile.title + ' · revision ' + profile.revision}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={(event) => void start(event)}>
        <div className="modal-body">
          {error ? <ErrorBox error={error} /> : null}
          <label className="field">
            Investigation title
            <input
              required
              minLength={3}
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            Current problem
            <textarea
              required
              rows={4}
              maxLength={4000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="field">
            Severity
            <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
              {caseSeverity.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <p>
            {profile.steps.length} checklist items will be copied. Capture sources are suggestions;
            no data is collected until you request a capture.
          </p>
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Create investigation
          </button>
        </footer>
      </form>
    </Modal>
  );
}
