import { useMemo, useState } from 'react';
import { Download, GitCompareArrows, CheckCircle2, Search } from 'lucide-react';
import { download } from '../api';
import '../evidence.css';
import type { Investigation } from '../../shared/investigation';
import {
  compareEvidence,
  captureOrderingNotice,
  captureWindowNotice,
  comparisonCsv,
  comparisonReport,
  defaultEvidenceFilter,
  filterDifferences,
  reviewDispositions,
  reviewProgress,
  type EvidenceComparison,
  type EvidenceDecision,
  type EvidenceDifference,
  type EvidenceReview,
  type EvidenceValue,
  type ReviewDisposition,
} from '../../shared/evidence-comparison';

type Save = (action: string, input: Record<string, unknown>) => Promise<boolean>;
const stamp = (value: string) => new Date(value).toLocaleString();

export function EvidenceWorkbench({
  record,
  busy,
  onChange,
}: {
  record: Investigation;
  busy: boolean;
  onChange: Save;
}) {
  const [beforeId, setBeforeId] = useState(record.captures.at(-2)?.id ?? '');
  const [afterId, setAfterId] = useState(record.captures.at(-1)?.id ?? '');
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState(defaultEvidenceFilter);
  const [page, setPage] = useState(0);
  const before = record.captures.find((capture) => capture.id === beforeId);
  const after = record.captures.find((capture) => capture.id === afterId);
  const comparison = useMemo(
    () => (before && after && before.id !== after.id ? compareEvidence(before, after) : undefined),
    [before, after],
  );
  const review = record.evidenceReviews?.find(
    (item) => item.beforeId === beforeId && item.afterId === afterId,
  );
  const editable = !['resolved', 'archived'].includes(record.status);
  const differences = useMemo(
    () => (comparison ? filterDifferences(comparison, review?.decisions ?? [], filter) : []),
    [comparison, review, filter],
  );
  const maxPage = Math.max(0, Math.ceil(differences.length / 20) - 1);
  const currentPage = Math.min(page, maxPage);
  const shown = differences.slice(currentPage * 20, currentPage * 20 + 20);
  const progress = comparison ? reviewProgress(comparison, review) : undefined;
  function selectPair(earlier: string, later: string) {
    setBeforeId(earlier);
    setAfterId(later);
    setPage(0);
    setFilter(defaultEvidenceFilter);
    setTitle('');
  }
  function updateFilter(key: keyof typeof filter, value: string | boolean) {
    setFilter((current) => ({ ...current, [key]: value }));
    setPage(0);
  }
  return (
    <div className="evidence-workbench padded">
      <h3>
        <GitCompareArrows size={18} /> Compare captures
      </h3>
      {record.captures.length < 2 ? (
        <p>Collect at least two captures in this investigation to compare evidence.</p>
      ) : null}
      {record.evidenceReviews?.length ? (
        <label className="field">
          Saved review
          <select
            value={review?.id ?? ''}
            disabled={busy}
            onChange={(event) => {
              const selected = record.evidenceReviews?.find(
                (item) => item.id === event.target.value,
              );
              if (selected) selectPair(selected.beforeId, selected.afterId);
            }}
          >
            <option value="">Choose a saved review</option>
            {record.evidenceReviews.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.conclusion ? 'concluded' : 'open'}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="form-grid">
        <label className="field">
          Earlier capture
          <select
            value={beforeId}
            disabled={busy}
            onChange={(event) => selectPair(event.target.value, afterId)}
          >
            <option value="">Choose a capture</option>
            {record.captures.map((capture) => (
              <option key={capture.id} value={capture.id}>
                {capture.title} · {stamp(capture.bundle.finishedAt)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Later capture
          <select
            value={afterId}
            disabled={busy}
            onChange={(event) => selectPair(beforeId, event.target.value)}
          >
            <option value="">Choose a capture</option>
            {record.captures.map((capture) => (
              <option key={capture.id} value={capture.id}>
                {capture.title} · {stamp(capture.bundle.finishedAt)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {beforeId && beforeId === afterId ? (
        <p role="status">Choose two different captures.</p>
      ) : null}
      {comparison ? (
        <>
          {comparison.notices.includes(captureOrderingNotice) ? (
            <p className="notice warning" role="status">
              {captureOrderingNotice}
            </p>
          ) : null}
          <SourceCoverage comparison={comparison} />
          <p className="notice">{captureWindowNotice}</p>
          {!review && editable ? (
            <form
              className="evidence-review-create"
              onSubmit={async (event) => {
                event.preventDefault();
                if (await onChange('evidence-reviews', { title, beforeId, afterId })) setTitle('');
              }}
            >
              <label className="field">
                Review title
                <input
                  required
                  minLength={3}
                  maxLength={120}
                  value={title}
                  disabled={busy}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="For example, post-maintenance checks"
                />
              </label>
              <button className="primary" disabled={busy || title.trim().length < 3}>
                Start evidence review
              </button>
              <small>Save decisions and a conclusion for this capture pair.</small>
            </form>
          ) : null}
          {review ? (
            <div className="evidence-review-heading">
              <h4>{review.title}</h4>
              <small>
                {review.createdBy} · {stamp(review.createdAt)}
              </small>
              <span>{review.conclusion ? 'Concluded' : 'Open review'}</span>
            </div>
          ) : null}
          <div className="evidence-progress" aria-label="Difference review progress">
            {reviewDispositions.map((state) => (
              <span key={state}>
                <strong>{progress?.[state]}</strong> {state}
              </span>
            ))}
          </div>
          <div className="inline-actions">
            <button
              onClick={() =>
                download(`harbor-comparison-${beforeId}-${afterId}.json`, { comparison, review })
              }
            >
              <Download size={16} /> JSON report
            </button>
            <button
              onClick={() =>
                saveText(
                  `harbor-comparison-${beforeId}-${afterId}.csv`,
                  comparisonCsv(comparison, review?.decisions ?? []),
                  'text/csv;charset=utf-8',
                )
              }
            >
              <Download size={16} /> Difference CSV
            </button>
            <button
              onClick={() =>
                saveText(
                  `harbor-comparison-${beforeId}-${afterId}.html`,
                  comparisonReport(comparison, review),
                  'text/html;charset=utf-8',
                )
              }
            >
              <Download size={16} /> Printable report
            </button>
          </div>
          <div className="evidence-filters">
            <label className="field">
              <span>
                <Search size={14} /> Find a path
              </span>
              <input
                value={filter.query}
                maxLength={200}
                onChange={(event) => updateFilter('query', event.target.value)}
                placeholder="Field name or path"
              />
            </label>
            <label className="field">
              Source
              <select
                value={filter.source}
                onChange={(event) => updateFilter('source', event.target.value)}
              >
                <option value="all">All sources</option>
                {comparison.sources.map((source) => (
                  <option key={source.source} value={source.source}>
                    {source.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Difference
              <select
                value={filter.kind}
                onChange={(event) => updateFilter('kind', event.target.value)}
              >
                <option value="all">All differences</option>
                {['added', 'removed', 'changed', 'type changed'].map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Review status
              <select
                value={filter.disposition}
                onChange={(event) => updateFilter('disposition', event.target.value)}
              >
                <option value="all">All statuses</option>
                {reviewDispositions.map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="evidence-search-values">
            <input
              type="checkbox"
              checked={filter.searchValues}
              onChange={(event) => updateFilter('searchValues', event.target.checked)}
            />
            Search value previews too
          </label>
          <div className="evidence-pagination">
            <span>
              {differences.length} of {comparison.differenceCount} retained differences
            </span>
            <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
              Previous
            </button>
            <span>
              Page {currentPage + 1} of {maxPage + 1}
            </span>
            <button disabled={currentPage === maxPage} onClick={() => setPage(currentPage + 1)}>
              Next
            </button>
          </div>
          {shown.map((difference) => {
            const decision = review?.decisions.find(
              (entry) => entry.differenceId === difference.id,
            );
            return (
              <DifferenceCard
                key={`${beforeId}:${afterId}:${difference.id}:${decision?.at ?? ''}`}
                difference={difference}
                decision={decision}
                busy={busy}
                writable={Boolean(review && editable && !review.conclusion)}
                onSave={(disposition, note) =>
                  onChange(`evidence-reviews/${review!.id}/decisions`, {
                    differenceId: difference.id,
                    disposition,
                    note,
                  })
                }
              />
            );
          })}
          {!differences.length ? (
            <p className="scope-note">
              {comparison.differenceCount
                ? 'No retained differences match these filters.'
                : 'No differences were retained in comparable sources. Check unavailable and limited sources above.'}
            </p>
          ) : null}
          {review && progress ? (
            <ReviewConclusion
              key={review.id + ':' + (review.conclusion?.at ?? 'open')}
              review={review}
              editable={editable}
              busy={busy}
              unresolved={progress.unreviewed + progress.investigate}
              onChange={onChange}
            />
          ) : null}
          {review?.history.length ? (
            <DecisionHistory review={review} comparison={comparison} />
          ) : null}
          <details className="scope-note">
            <summary>Comparison scope and limits</summary>
            <ul>
              {comparison.notices
                .filter(
                  (notice) => notice !== captureOrderingNotice && notice !== captureWindowNotice,
                )
                .map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
            </ul>
            <p>
              Each source retains up to 200 differences and examines up to 12,000 nodes. Value
              previews stop at 1,600 characters. Captures retain their complete bounded source
              payloads.
            </p>
            <p>
              A concluded review records the analyst's assessment of retained differences. It does
              not certify instance health.
            </p>
          </details>
        </>
      ) : null}
    </div>
  );
}

function SourceCoverage({ comparison }: { comparison: EvidenceComparison }) {
  return (
    <div className="evidence-sources" aria-label="Source comparison coverage">
      {comparison.sources.map((source) => (
        <details key={source.source} className={'evidence-source evidence-' + source.status}>
          <summary>
            <strong>{source.title}</strong>
            <span>{source.status}</span>
            <small>{source.differences.length} differences</small>
          </summary>
          <dl>
            <dt>Earlier</dt>
            <dd>
              {source.beforeStatus}
              {source.beforeObservedAt ? ' · ' + stamp(source.beforeObservedAt) : ''}
            </dd>
            <dt>Later</dt>
            <dd>
              {source.afterStatus}
              {source.afterObservedAt ? ' · ' + stamp(source.afterObservedAt) : ''}
            </dd>
            <dt>Compared nodes</dt>
            <dd>{source.examinedNodes.toLocaleString()}</dd>
          </dl>
          {source.notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
        </details>
      ))}
    </div>
  );
}

function DifferenceCard({
  difference,
  decision,
  writable,
  busy,
  onSave,
}: {
  difference: EvidenceDifference;
  decision?: EvidenceDecision;
  writable: boolean;
  busy: boolean;
  onSave: (disposition: ReviewDisposition, note: string) => Promise<boolean>;
}) {
  const [disposition, setDisposition] = useState<ReviewDisposition>(
    decision?.disposition ?? 'unreviewed',
  );
  const [note, setNote] = useState(decision?.note ?? '');
  const [editing, setEditing] = useState(false);
  return (
    <article className="evidence-difference">
      <div className="evidence-difference-heading">
        <strong>
          {difference.source} · {difference.kind}
        </strong>
        <span>{decision?.disposition ?? 'unreviewed'}</span>
      </div>
      <code className="evidence-path">{difference.path}</code>
      {difference.context ? <small>{difference.context}</small> : null}
      <div className="evidence-values">
        <ValuePreview label="Earlier" value={difference.before} />
        <ValuePreview label="Later" value={difference.after} />
      </div>
      {difference.numericDelta !== undefined ? (
        <p className="evidence-delta">
          Numeric difference: {difference.numericDelta > 0 ? '+' : ''}
          {difference.numericDelta}
        </p>
      ) : null}
      {decision ? (
        <div className="evidence-decision">
          <p>{decision.note}</p>
          <small>
            {decision.author} · {stamp(decision.at)}
          </small>
        </div>
      ) : null}
      {writable && !editing ? (
        <button disabled={busy} onClick={() => setEditing(true)}>
          {decision ? 'Revise decision' : 'Record decision'}
        </button>
      ) : null}
      {writable && editing ? (
        <form
          className="evidence-decision-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onSave(disposition, note)) setEditing(false);
          }}
        >
          <label className="field">
            Decision
            <select
              value={disposition}
              disabled={busy}
              onChange={(event) => setDisposition(event.target.value as ReviewDisposition)}
            >
              {reviewDispositions.map((state) => (
                <option key={state}>{state}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Evidence or reasoning
            <textarea
              required
              maxLength={2000}
              rows={3}
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="inline-actions">
            <button className="primary" disabled={busy || !note.trim()}>
              Save decision
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

function ValuePreview({ label, value }: { label: string; value?: EvidenceValue }) {
  return (
    <div className="evidence-value">
      <h5>
        {label} <small>{value?.type ?? 'not present'}</small>
      </h5>
      {value ? (
        <>
          <pre>{value.preview === '' ? '"" (empty string)' : value.preview}</pre>
          {value.clipped ? (
            <small>Preview clipped. Open the capture for the retained value.</small>
          ) : null}
        </>
      ) : (
        <p className="muted">Not present</p>
      )}
    </div>
  );
}

function ReviewConclusion({
  review,
  editable,
  busy,
  unresolved,
  onChange,
}: {
  review: EvidenceReview;
  editable: boolean;
  busy: boolean;
  unresolved: number;
  onChange: Save;
}) {
  const [text, setText] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <section className="evidence-conclusion">
      <h4>
        <CheckCircle2 size={18} /> Review conclusion
      </h4>
      {review.conclusion ? (
        <>
          <blockquote>{review.conclusion.text}</blockquote>
          <small>
            {review.conclusion.author} · {stamp(review.conclusion.at)}
          </small>
          {editable ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                await onChange(`evidence-reviews/${review.id}/reopen`, { reason: text });
              }}
            >
              <label className="field">
                Reason for reopening
                <textarea
                  required
                  minLength={3}
                  maxLength={2000}
                  rows={3}
                  value={text}
                  disabled={busy}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <button disabled={busy || text.trim().length < 3}>Reopen review</button>
            </form>
          ) : null}
        </>
      ) : editable ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            await onChange(`evidence-reviews/${review.id}/conclusion`, {
              text,
              acknowledgeLimits: acknowledged,
            });
          }}
        >
          {unresolved ? (
            <p>{unresolved} differences remain unreviewed or need investigation.</p>
          ) : null}
          <label className="field">
            Conclusion
            <textarea
              required
              minLength={3}
              maxLength={4000}
              rows={4}
              value={text}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label className="evidence-acknowledgement">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I reviewed source availability, comparison limits and remaining gaps in the evidence.
          </label>
          <button
            className="primary"
            disabled={busy || unresolved > 0 || !acknowledged || text.trim().length < 3}
          >
            Conclude review
          </button>
        </form>
      ) : (
        <p>No conclusion recorded.</p>
      )}
    </section>
  );
}

function DecisionHistory({
  review,
  comparison,
}: {
  review: EvidenceReview;
  comparison: EvidenceComparison;
}) {
  const [page, setPage] = useState(0);
  const rows = [...review.history].reverse();
  const maximum = Math.max(0, Math.ceil(rows.length / 20) - 1);
  const current = Math.min(page, maximum);
  const paths = new Map(
    comparison.sources.flatMap((source) =>
      source.differences.map((row) => [row.id, row.path] as const),
    ),
  );
  return (
    <details className="evidence-history">
      <summary>Decision history ({rows.length})</summary>
      <div className="evidence-pagination">
        <button disabled={!current} onClick={() => setPage(current - 1)}>
          Newer decisions
        </button>
        <span>
          Page {current + 1} of {maximum + 1}
        </span>
        <button disabled={current === maximum} onClick={() => setPage(current + 1)}>
          Older decisions
        </button>
      </div>
      <ol>
        {rows.slice(current * 20, current * 20 + 20).map((entry) => (
          <li key={entry.eventId}>
            <strong>{entry.disposition}</strong> · {entry.author} · {stamp(entry.at)}
            <code>{paths.get(entry.differenceId) ?? entry.differenceId}</code>
            <p>{entry.note}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

function saveText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
