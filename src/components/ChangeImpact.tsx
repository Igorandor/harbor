import { AlertTriangle, Info } from 'lucide-react';
import {
  impactTitle,
  summarizeRelated,
  type ChangeImpact as Impact,
} from '../../shared/change-impact';
export function ChangeImpact({ impact }: { impact: Impact }) {
  return (
    <section className={'impact-review impact-' + impact.level} aria-label="Change impact">
      <h3>
        {impact.level === 'high' ? <AlertTriangle size={18} /> : <Info size={18} />}{' '}
        {impactTitle(impact.level)}
      </h3>
      <p>{impact.summary}</p>
      {impact.consequences.length ? (
        <ul>
          {impact.consequences.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      ) : null}
      {impact.related.length ? (
        <details>
          <summary>Related configuration: {summarizeRelated(impact.related)}</summary>
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Name</th>
                <th>Relationship</th>
              </tr>
            </thead>
            <tbody>
              {impact.related.map((item, index) => (
                <tr key={index}>
                  <td>{item.kind}</td>
                  <td>
                    <code>{item.name}</code>
                  </td>
                  <td>{item.relationship}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
      {impact.sources.length ? (
        <details>
          <summary>Dependency checks{impact.incomplete ? ' · incomplete' : ''}</summary>
          <ul>
            {impact.sources.map((source) => (
              <li key={source.path}>
                <code>{source.path}</code>: {source.status}, {source.count} records. {source.notice}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <small>
        Assessed {new Date(impact.assessedAt).toLocaleTimeString()}. Direct configuration references
        are advisory; application-code dependencies may not be visible.
      </small>
    </section>
  );
}
