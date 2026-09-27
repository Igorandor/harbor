import { useState } from 'react';
import { CheckCircle2, Circle, MinusCircle } from 'lucide-react';
import type { Investigation } from '../../shared/investigation';
type ChecklistItem = NonNullable<Investigation['checklist']>[number];
export function InvestigationChecklist({
  record,
  busy,
  onUpdate,
}: {
  record: Investigation;
  busy: boolean;
  onUpdate: (id: string, state: ChecklistItem['state'], note: string) => Promise<boolean>;
}) {
  if (!record.checklist?.length)
    return (
      <div className="padded">
        <h3>No checklist attached</h3>
        <p>
          Start an investigation from a saved profile to include a reusable checklist. Existing
          investigations retain their original steps.
        </p>
      </div>
    );
  const open = record.checklist.filter((item) => item.required && item.state === 'open').length;
  return (
    <div className="padded">
      <h3>Investigation checklist</h3>
      {record.profile ? (
        <p>
          From {record.profile.title}, revision {record.profile.revision}.
        </p>
      ) : null}
      <p>
        {open} required items remain open. Required items need a completed or not-applicable
        decision before resolution.
      </p>
      {record.checklist.map((item) => (
        <ChecklistRow
          key={item.id + ':' + (item.updatedAt ?? 'new')}
          item={item}
          busy={busy}
          readonly={['resolved', 'archived'].includes(record.status)}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  );
}
function ChecklistRow({
  item,
  busy,
  readonly,
  onUpdate,
}: {
  item: ChecklistItem;
  busy: boolean;
  readonly: boolean;
  onUpdate: (id: string, state: ChecklistItem['state'], note: string) => Promise<boolean>;
}) {
  const [state, setState] = useState(item.state),
    [note, setNote] = useState(item.note ?? '');
  const Icon =
    item.state === 'completed'
      ? CheckCircle2
      : item.state === 'not applicable'
        ? MinusCircle
        : Circle;
  return (
    <article className={'checklist-row checklist-' + item.state.replaceAll(' ', '-')}>
      <div className="checklist-heading">
        <Icon size={20} />
        <h4>{item.title}</h4>
        <span>
          {item.required ? 'Required' : 'Optional'} · {item.state}
        </span>
      </div>
      <p>{item.instruction}</p>
      {item.updatedAt ? (
        <small>
          {item.updatedBy} · {new Date(item.updatedAt).toLocaleString()}
        </small>
      ) : null}
      {readonly ? (
        <blockquote>{item.note ?? 'No decision recorded.'}</blockquote>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            await onUpdate(item.id, state, note);
          }}
        >
          <div className="form-grid">
            <label className="field">
              Outcome
              <select
                value={state}
                onChange={(event) => setState(event.target.value as ChecklistItem['state'])}
              >
                <option value="open">Open</option>
                <option value="completed">Completed</option>
                <option value="not applicable">Not applicable</option>
              </select>
            </label>
            <label className="field">
              Result or reason
              <textarea
                required
                rows={3}
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </div>
          <button disabled={busy || !note.trim() || (state === item.state && note === item.note)}>
            Record outcome
          </button>
        </form>
      )}
    </article>
  );
}
