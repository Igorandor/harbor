import type { CaseCapture } from './investigation.js';
import type { DiagnosticId, DiagnosticSection } from './diagnostics.js';

export const captureOrderingNotice =
  'The selected earlier capture did not finish before the later capture. Check capture ordering.';

export const reviewDispositions = ['unreviewed', 'expected', 'investigate', 'explained'] as const;
export type ReviewDisposition = (typeof reviewDispositions)[number];
export type DifferenceKind = 'added' | 'removed' | 'changed' | 'type changed';
export type EvidenceValue = {
  type: string;
  preview: string;
  clipped: boolean;
};
export type EvidenceDifference = {
  id: string;
  source: DiagnosticId;
  path: string;
  kind: DifferenceKind;
  before?: EvidenceValue;
  after?: EvidenceValue;
  numericDelta?: number;
  context?: string;
};
export type EvidenceSourceComparison = {
  source: DiagnosticId;
  title: string;
  status: 'changed' | 'unchanged' | 'unavailable' | 'limited';
  beforeStatus: string;
  afterStatus: string;
  beforeObservedAt?: string;
  afterObservedAt?: string;
  differences: EvidenceDifference[];
  notices: string[];
  examinedNodes: number;
};
export type EvidenceComparison = {
  version: 1;
  instance: string;
  beforeId: string;
  afterId: string;
  beforeTitle: string;
  afterTitle: string;
  beforeFinishedAt: string;
  afterFinishedAt: string;
  sources: EvidenceSourceComparison[];
  differenceCount: number;
  unavailableCount: number;
  limitedCount: number;
  notices: string[];
};
export type EvidenceDecision = {
  differenceId: string;
  disposition: ReviewDisposition;
  note: string;
  at: string;
  author: string;
};
export type EvidenceReview = {
  id: string;
  comparisonVersion: 1;
  title: string;
  beforeId: string;
  afterId: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  decisions: EvidenceDecision[];
  history: Array<EvidenceDecision & { eventId: string }>;
  conclusion?: { text: string; at: string; author: string; limitsAcknowledged: true };
};

const maxDifferences = 200;
const maxNodes = 12_000;
const maxDepth = 14;
const maxPreview = 1600;
const missing = Symbol('missing');
type Value = unknown | typeof missing;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const valueType = (value: unknown) =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const token = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1');

export function evidenceValue(value: unknown): EvidenceValue {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (value === undefined) text = 'undefined';
  else text = JSON.stringify(value, null, 2);
  return {
    type: valueType(value),
    preview: text.slice(0, maxPreview),
    clipped: text.length > maxPreview,
  };
}

type ArrayIdentity = {
  label: string;
  key: (value: unknown) => string | undefined;
};
/** Pair known configuration identities only when every row supplies a unique key. */
function arrayIdentity(
  source: DiagnosticId,
  path: string,
  left: unknown[],
  right: unknown[],
): ArrayIdentity | undefined {
  // Only root inventory arrays have unordered identity semantics. Named rows in
  // a nested configuration can encode precedence, so their order is preserved.
  if (path !== '' || !['tasks', 'journals', 'processes'].includes(source)) return undefined;
  const rows = [...left, ...right];
  if (!rows.length || !rows.every(object)) return undefined;
  const candidates: ArrayIdentity[] =
    source === 'processes'
      ? [
          {
            label: 'process generation',
            key: (row) => {
              if (!object(row) || row.Pid === undefined || typeof row.StartTimeUTC !== 'string')
                return undefined;
              return JSON.stringify([row.Pid, row.StartTimeUTC, row.JobNumber ?? null]);
            },
          },
        ]
      : (source === 'tasks' ? ['Id', 'ID'] : ['FileName']).map((field) => ({
          label: field,
          key: (row: unknown) => {
            if (!object(row)) return undefined;
            const value = row[field];
            return typeof value === 'string' || typeof value === 'number'
              ? String(value)
              : undefined;
          },
        }));
  for (const candidate of candidates) {
    const valid = [left, right].every((values) => {
      const keys = values.map(candidate.key);
      return (
        keys.every((key) => key !== undefined && key.length > 0) &&
        new Set(keys).size === keys.length
      );
    });
    if (valid) return candidate;
  }
  return undefined;
}

function compareSection(
  id: DiagnosticId,
  left: DiagnosticSection | undefined,
  right: DiagnosticSection | undefined,
): EvidenceSourceComparison {
  const result: EvidenceSourceComparison = {
    source: id,
    title: right?.title ?? left?.title ?? id,
    status: 'unavailable',
    beforeStatus: left?.status ?? 'not selected',
    afterStatus: right?.status ?? 'not selected',
    beforeObservedAt: left?.observedAt,
    afterObservedAt: right?.observedAt,
    differences: [],
    notices: [],
    examinedNodes: 0,
  };
  if (left?.status !== 'collected' || right?.status !== 'collected') {
    result.notices.push(
      'Both captures must contain a collected source before values can be compared.',
    );
    if (left?.notice) result.notices.push('Earlier: ' + left.notice);
    if (right?.notice) result.notices.push('Later: ' + right.notice);
    return result;
  }
  if (left.data === undefined || right.data === undefined) {
    result.notices.push('A collected source has no retained payload. It is not an empty result.');
    return result;
  }
  const notices = new Set<string>();
  let limited = false;
  function add(a: Value, b: Value, path: string, context?: string) {
    if (result.differences.length >= maxDifferences) {
      limited = true;
      return;
    }
    const kind: DifferenceKind =
      a === missing
        ? 'added'
        : b === missing
          ? 'removed'
          : valueType(a) !== valueType(b)
            ? 'type changed'
            : 'changed';
    const delta = typeof a === 'number' && typeof b === 'number' ? b - a : undefined;
    result.differences.push({
      // Captures are immutable and traversal is deterministic. A compact ordinal
      // avoids persisting arbitrarily long upstream keys as decision identifiers.
      id: `${id}:${result.differences.length}`,
      source: id,
      path: path || '/',
      kind,
      ...(a === missing ? {} : { before: evidenceValue(a) }),
      ...(b === missing ? {} : { after: evidenceValue(b) }),
      ...(delta !== undefined && Number.isFinite(delta) ? { numericDelta: delta } : {}),
      ...(context ? { context } : {}),
    });
  }
  function walk(a: Value, b: Value, path: string, depth: number, context?: string) {
    result.examinedNodes++;
    if (result.examinedNodes > maxNodes || result.differences.length >= maxDifferences) {
      limited = true;
      return;
    }
    if (Object.is(a, b)) return;
    if (depth >= maxDepth) {
      // Compare the subtree before emitting a collapsed difference. Never call it unchanged
      // just because the presentation depth has been reached.
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        add(a, b, path, 'Subtree collapsed at comparison depth limit.');
        notices.add('Deeply nested values are shown as a whole subtree.');
      }
      return;
    }
    if (a === missing || b === missing || valueType(a) !== valueType(b)) {
      add(a, b, path, context);
      return;
    }
    if (object(a) && object(b)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        walk(
          Object.hasOwn(a, key) ? a[key] : missing,
          Object.hasOwn(b, key) ? b[key] : missing,
          path + '/' + token(key),
          depth + 1,
          context,
        );
        if (limited) break;
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const identity = arrayIdentity(id, path, a, b);
      if (identity) {
        const before = new Map(a.map((row) => [identity.key(row)!, row]));
        const after = new Map(b.map((row) => [identity.key(row)!, row]));
        for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
          walk(
            before.has(key) ? before.get(key) : missing,
            after.has(key) ? after.get(key) : missing,
            path + '/@' + token(identity.label) + '=' + token(key),
            depth + 1,
            'Rows matched by ' + identity.label + '; order differences are ignored.',
          );
          if (limited) break;
        }
      } else {
        if (a.some(object) || b.some(object))
          notices.add(
            'Some rows have no unique stable identity. Their array positions are compared; a reorder can appear as changes.',
          );
        for (let index = 0; index < Math.max(a.length, b.length); index++) {
          walk(
            index < a.length ? a[index] : missing,
            index < b.length ? b[index] : missing,
            path + '/' + index,
            depth + 1,
            'Array position ' + index,
          );
          if (limited) break;
        }
      }
      return;
    }
    add(a, b, path, context);
  }
  walk(left.data, right.data, '', 0);
  if (limited)
    notices.add(
      `Comparison stopped at ${maxDifferences} differences or ${maxNodes.toLocaleString()} nodes. Additional differences may exist.`,
    );
  result.status = limited ? 'limited' : result.differences.length ? 'changed' : 'unchanged';
  result.notices = [...notices];
  return result;
}

export function compareEvidence(before: CaseCapture, after: CaseCapture): EvidenceComparison {
  if (before.id === after.id) throw new Error('Choose two different captures.');
  if (before.bundle.instance !== after.bundle.instance)
    throw new Error('Captures belong to different instances.');
  const ids = [
    ...new Set([
      ...before.bundle.sections.map((section) => section.id),
      ...after.bundle.sections.map((section) => section.id),
    ]),
  ];
  const sources = ids.map((id) =>
    compareSection(
      id,
      before.bundle.sections.find((section) => section.id === id),
      after.bundle.sections.find((section) => section.id === id),
    ),
  );
  const notices = [
    'Each source was read separately. A comparison is not an atomic snapshot or proof of causation.',
    'Counters and timestamps normally change. A numeric difference is not a rate or an incident verdict.',
    'Values are compared as returned by the source. Missing data and null are different.',
  ];
  if (Date.parse(before.bundle.finishedAt) >= Date.parse(after.bundle.finishedAt))
    notices.push(captureOrderingNotice);
  return {
    version: 1,
    instance: before.bundle.instance,
    beforeId: before.id,
    afterId: after.id,
    beforeTitle: before.title,
    afterTitle: after.title,
    beforeFinishedAt: before.bundle.finishedAt,
    afterFinishedAt: after.bundle.finishedAt,
    sources,
    differenceCount: sources.reduce((sum, source) => sum + source.differences.length, 0),
    unavailableCount: sources.filter((source) => source.status === 'unavailable').length,
    limitedCount: sources.filter((source) => source.status === 'limited').length,
    notices,
  };
}

export type EvidenceFilter = {
  query: string;
  source: string;
  kind: string;
  disposition: string;
  searchValues: boolean;
};
export const defaultEvidenceFilter: EvidenceFilter = {
  query: '',
  source: 'all',
  kind: 'all',
  disposition: 'all',
  searchValues: false,
};
export function filterDifferences(
  comparison: EvidenceComparison,
  decisions: EvidenceDecision[],
  filter: EvidenceFilter,
) {
  const byId = new Map(decisions.map((decision) => [decision.differenceId, decision]));
  const query = filter.query.trim().toLocaleLowerCase();
  return comparison.sources
    .flatMap((source) => source.differences)
    .filter((difference) => {
      if (filter.source !== 'all' && difference.source !== filter.source) return false;
      if (filter.kind !== 'all' && difference.kind !== filter.kind) return false;
      const disposition = byId.get(difference.id)?.disposition ?? 'unreviewed';
      if (filter.disposition !== 'all' && filter.disposition !== disposition) return false;
      const text = [
        difference.path,
        difference.source,
        ...(filter.searchValues ? [difference.before?.preview, difference.after?.preview] : []),
      ]
        .join(' ')
        .toLocaleLowerCase();
      return !query || text.includes(query);
    });
}

export function reviewProgress(comparison: EvidenceComparison, review?: EvidenceReview) {
  const ids = new Set(
    comparison.sources.flatMap((source) => source.differences.map((row) => row.id)),
  );
  const decisions = (review?.decisions ?? []).filter((decision) => ids.has(decision.differenceId));
  const counts = Object.fromEntries(reviewDispositions.map((state) => [state, 0])) as Record<
    ReviewDisposition,
    number
  >;
  for (const decision of decisions) counts[decision.disposition]++;
  counts.unreviewed += ids.size - decisions.length;
  return counts;
}

export function comparisonCsv(comparison: EvidenceComparison, decisions: EvidenceDecision[]) {
  const byId = new Map(decisions.map((decision) => [decision.differenceId, decision]));
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    // Spreadsheet formula protection applies even when strings contain leading whitespace.
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const rows: unknown[][] = [
    [
      'Source',
      'Path',
      'Kind',
      'Before type',
      'Before',
      'Before clipped',
      'After type',
      'After',
      'After clipped',
      'Numeric delta',
      'Disposition',
      'Note',
      'Reviewer',
      'Reviewed at',
    ],
  ];
  for (const source of comparison.sources) {
    for (const difference of source.differences) {
      const decision = byId.get(difference.id);
      rows.push([
        difference.source,
        difference.path,
        difference.kind,
        difference.before?.type,
        difference.before?.preview,
        difference.before?.clipped ?? '',
        difference.after?.type,
        difference.after?.preview,
        difference.after?.clipped ?? '',
        difference.numericDelta,
        decision?.disposition ?? 'unreviewed',
        decision?.note,
        decision?.author,
        decision?.at,
      ]);
    }
  }
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

export function comparisonReport(comparison: EvidenceComparison, review?: EvidenceReview) {
  const escape = (value: unknown) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
  const decisions = new Map(review?.decisions.map((item) => [item.differenceId, item]));
  const textValue = (value: EvidenceValue | undefined) =>
    value
      ? `<small>${escape(value.type)}${value.clipped ? ' · preview clipped' : ''}</small><pre>${escape(value.preview)}</pre>`
      : '<em>Not present</em>';
  return (
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Evidence comparison</title>' +
    '<style>body{font:15px/1.5 system-ui;max-width:1100px;margin:30px auto;padding:20px}article,section{border-top:1px solid #ccc;padding:15px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;table-layout:fixed}td,th{vertical-align:top;text-align:left;padding:8px;border:1px solid #ddd}code{overflow-wrap:anywhere}small{color:#555}@media print{article{break-inside:avoid}}</style>' +
    `<h1>${escape(review?.title ?? 'Evidence comparison')}</h1><p>${escape(comparison.instance)}</p>` +
    `<p>${escape(comparison.beforeTitle)} (${escape(comparison.beforeFinishedAt)}) → ${escape(comparison.afterTitle)} (${escape(comparison.afterFinishedAt)})</p>` +
    `<p>${comparison.differenceCount} retained differences; ${comparison.unavailableCount} unavailable sources; ${comparison.limitedCount} limited comparisons.</p>` +
    '<ul>' +
    comparison.notices.map((notice) => '<li>' + escape(notice) + '</li>').join('') +
    '</ul>' +
    comparison.sources
      .map(
        (source) =>
          `<section><h2>${escape(source.title)} · ${escape(source.status)}</h2>` +
          `<p>${escape(source.beforeStatus)} → ${escape(source.afterStatus)}</p>` +
          source.notices.map((notice) => '<p>' + escape(notice) + '</p>').join('') +
          source.differences
            .map((difference) => {
              const decision = decisions.get(difference.id);
              return (
                `<article><h3>${escape(difference.kind)}: <code>${escape(difference.path)}</code></h3>` +
                `<table><tr><th>Earlier</th><th>Later</th></tr><tr><td>${textValue(difference.before)}</td><td>${textValue(difference.after)}</td></tr></table>` +
                `<p>${escape(decision?.disposition ?? 'unreviewed')}${decision ? ' · ' + escape(decision.author) + ' · ' + escape(decision.at) : ''}</p>` +
                (decision ? '<p>' + escape(decision.note) + '</p>' : '') +
                '</article>'
              );
            })
            .join('') +
          '</section>',
      )
      .join('') +
    (review?.conclusion
      ? '<section><h2>Reviewer conclusion</h2><p>' +
        escape(review.conclusion.text) +
        '</p><small>' +
        escape(review.conclusion.author) +
        ' · ' +
        escape(review.conclusion.at) +
        '</small></section>'
      : '') +
    '</html>'
  );
}
