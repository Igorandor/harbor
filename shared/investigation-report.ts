import type { Investigation } from './investigation.js';

export function investigationReport(record: Investigation) {
  const escape = (value: unknown) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escape(record.title) +
    '</title><style>body{font:16px/1.5 system-ui;max-width:1000px;margin:40px auto;padding:20px}h1,h2,h3,p,li,blockquote,small{overflow-wrap:anywhere}p,blockquote{white-space:pre-wrap}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{border-top:1px solid #bbb;padding-top:20px}small{color:#555}dl{display:grid;grid-template-columns:150px minmax(0,1fr);gap:6px 16px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}@media screen and (max-width:600px){body{margin:16px auto;padding:16px}h1{font-size:26px}dl{grid-template-columns:minmax(0,1fr);gap:4px}dd{margin-bottom:8px}}</style></head><body><h1>' +
    escape(record.title) +
    '</h1><p>' +
    escape(record.description) +
    '</p><h2>Investigation record</h2><dl>' +
    [
      ['Case ID', record.id],
      ['Owner', record.owner],
      ['Instance', record.instance],
      ['Revision', record.revision],
      ['Current status', record.status],
      ['Severity', record.severity],
      ['Created', record.createdAt],
      ['Updated', record.updatedAt],
    ]
      .map(([label, value]) => '<dt>' + escape(label) + '</dt><dd>' + escape(value) + '</dd>')
      .join('') +
    '</dl>' +
    (record.resolution
      ? '<h2>' +
        (['resolved', 'archived'].includes(record.status)
          ? 'Recorded resolution'
          : 'Previous resolution') +
        '</h2><p>' +
        escape(record.resolution) +
        '</p>'
      : '<p>No resolution has been recorded.</p>') +
    '<h2>Timeline</h2>' +
    record.notes
      .map(
        (note) =>
          '<section><small>' +
          escape(note.at) +
          ' · ' +
          escape(note.author) +
          '</small><p>' +
          escape(note.text) +
          '</p></section>',
      )
      .join('') +
    '<h2>Checklist</h2>' +
    (record.checklist
      ?.map(
        (item) =>
          '<section><h3>' +
          escape(item.title) +
          '</h3><p>' +
          escape(item.instruction) +
          '</p><p>' +
          escape(item.state) +
          ' · ' +
          (item.required ? 'Required' : 'Optional') +
          '</p><p>' +
          escape(item.note) +
          '</p><small>' +
          escape(item.updatedBy) +
          ' · ' +
          escape(item.updatedAt) +
          '</small></section>',
      )
      .join('') || '<p>No checklist attached.</p>') +
    '<h2>Evidence reviews</h2>' +
    (record.evidenceReviews
      ?.map(
        (review) =>
          '<section><h3>' +
          escape(review.title) +
          '</h3><p>' +
          escape(review.beforeId) +
          ' → ' +
          escape(review.afterId) +
          '</p><p>' +
          (review.conclusion ? 'Concluded' : 'Open') +
          ' · ' +
          review.decisions.length +
          ' current decisions · ' +
          review.history.length +
          ' decision revisions</p>' +
          (review.conclusion
            ? '<blockquote>' +
              escape(review.conclusion.text) +
              '</blockquote><small>' +
              escape(review.conclusion.author) +
              ' · ' +
              escape(review.conclusion.at) +
              '</small>'
            : '') +
          '<pre>' +
          escape(JSON.stringify(review.decisions, null, 2)) +
          '</pre></section>',
      )
      .join('') || '<p>No evidence reviews saved.</p>') +
    '<h2>Related changes</h2><ul>' +
    record.linkedChanges.map((id) => '<li>' + escape(id) + '</li>').join('') +
    '</ul>' +
    '<h2>Captures</h2>' +
    record.captures
      .map(
        (capture) =>
          '<section><h3>' +
          escape(capture.title) +
          '</h3><p><strong>Capture ID:</strong> ' +
          escape(capture.id) +
          '</p><p><strong>Captured by:</strong> ' +
          escape(capture.capturedBy) +
          '</p><pre>' +
          escape(JSON.stringify(capture.bundle, null, 2)) +
          '</pre></section>',
      )
      .join('') +
    '</body></html>';
  return html;
}
