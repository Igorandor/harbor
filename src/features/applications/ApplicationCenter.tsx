import { useEffect, useState } from 'react';
import { ArrowLeft, Download, RefreshCw } from 'lucide-react';
import { download, iris, request, RequestError } from '../../api';
import { useData } from '../../hooks';
import { Badge, Details, Empty, ErrorBox, Loading, PageHeader, Value } from '../../components/ui';
import {
  applicationFindings,
  applicationKinds,
  applicationRelations,
  authenticationMethods,
  configurationText,
  corsOrigin,
  serviceFindings,
  type ApplicationFinding,
  type ApplicationObservation,
  type ApplicationSource,
  type ConfigurationRecord,
} from '../../../shared/application-analysis';
import './application-center.css';

function FieldList({ record, fields }: { record: ConfigurationRecord; fields: string[] }) {
  return (
    <dl className="application-fields">
      {fields.map((field) => (
        <div key={field}>
          <dt>{field}</dt>
          <dd>
            <Value value={record[field]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
function Findings({ items }: { items: ApplicationFinding[] }) {
  return (
    <section className="panel padded">
      <h2>Configuration review</h2>
      <p className="scope-note">
        Configuration checks. Verify application behavior before changing access.
      </p>
      {!items.length ? (
        <p>No review points were identified in the available configuration.</p>
      ) : (
        <ul className="application-findings">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <Badge tone={item.level === 'review' ? 'warning' : 'neutral'}>{item.level}</Badge>
                <strong>{item.title}</strong>
              </div>
              <p>{item.detail}</p>
              {item.fields.length > 0 && <small>Fields: {item.fields.join(', ')}</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
function Authentication({ value, service = false }: { value: unknown; service?: boolean }) {
  const parsed = authenticationMethods(value, service);
  return (
    <section className="panel padded">
      <h2>Authentication methods</h2>
      {!parsed.valid ? (
        <p>The authentication mask is unavailable or invalid.</p>
      ) : (
        <>
          <p className="scope-note">
            Native AutheEnabled: <code>{configurationText(value)}</code>
          </p>
          {parsed.methods.length ? (
            <ul className="application-auth-list">
              {parsed.methods.map((method) => (
                <li key={method.bit}>
                  <Badge tone={method.kind === 'anonymous' ? 'warning' : 'neutral'}>
                    {method.kind}
                  </Badge>
                  <span>{method.name}</span>
                  <small>Bit {method.bit}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No documented methods are set in the returned mask.</p>
          )}
          {!!parsed.unknownMask && (
            <p className="application-notice">
              Additional mask value {parsed.unknownMask} is not interpreted by this catalogue.
            </p>
          )}
        </>
      )}
    </section>
  );
}
function SourceCard({
  title,
  source,
  fields,
}: {
  title: string;
  source: ApplicationSource<ConfigurationRecord>;
  fields?: string[];
}) {
  return (
    <section className="panel padded">
      <div className="application-heading">
        <h2>{title}</h2>
        <Badge tone={source.status === 'available' ? 'good' : 'neutral'}>{source.status}</Badge>
      </div>
      <p className="scope-note">Observed {source.observedAt}</p>
      {source.notice && <p>{source.notice}</p>}
      {source.data &&
        (fields ? (
          <FieldList record={source.data} fields={fields} />
        ) : (
          <Details data={source.data} />
        ))}
    </section>
  );
}
function CorsSettings({ app }: { app: ConfigurationRecord }) {
  const origins = Array.isArray(app.CorsAllowlist) ? app.CorsAllowlist : [];
  return (
    <section className="panel padded">
      <h2>Cross-origin requests</h2>
      <FieldList record={app} fields={['CorsCredentialsAllowed', 'CorsHeadersList']} />
      {!origins.length ? (
        <p>No CORS allowlist entries were returned.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Configured entry</th>
                <th>Interpretation</th>
                <th>Transport</th>
              </tr>
            </thead>
            <tbody>
              {origins.map((entry, index) => {
                const parsed = corsOrigin(entry);
                return (
                  <tr key={index}>
                    <td className="application-break">
                      {configurationText(entry) || 'Non-string entry'}
                    </td>
                    <td>{parsed.kind === 'origin' ? parsed.origin : parsed.kind}</td>
                    <td>
                      {parsed.kind === 'origin'
                        ? parsed.secure
                          ? 'HTTPS'
                          : 'HTTP'
                        : 'Not applicable'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="scope-note">
        This view does not issue cross-origin requests or inspect deployed response headers.
      </p>
    </section>
  );
}
function ApplicationRoles({ app }: { app: ConfigurationRecord }) {
  const rows = Array.isArray(app.MatchRoles)
    ? (app.MatchRoles.filter((row) => row && typeof row === 'object') as ConfigurationRecord[])
    : [];
  return (
    <section className="panel padded">
      <h2>Application role grants</h2>
      {!rows.length ? (
        <p>No application-specific role grants were returned.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Matching role</th>
                <th>Target roles</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td>{configurationText(row.MatchRole) || 'Always grant'}</td>
                  <td>
                    <Value value={row.TargetRoles} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="scope-note">
        These grants apply in the application context. They do not replace a complete review of
        account roles and runtime authorization.
      </p>
    </section>
  );
}
function RelatedRoutes({
  observation,
  select,
}: {
  observation: ApplicationObservation;
  select: (name: string) => void;
}) {
  const related = applicationRelations(
    observation.name,
    observation.application.data ?? {},
    observation.routes.data ?? [],
  );
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(0);
  const filtered = related.filter(
    (row) =>
      row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
      (kind === 'all' || row.relations.includes(kind)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 15)),
    current = Math.min(page, pages - 1);
  return (
    <section className="panel padded">
      <h2>Related application routes</h2>
      {observation.routes.status !== 'available' ? (
        <p>{observation.routes.notice}</p>
      ) : (
        <>
          <div className="application-filter-row">
            <label>
              Search routes
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              Relationship
              <select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All relationships</option>
                <option>Parent route</option>
                <option>Child route</option>
                <option>Same namespace</option>
              </select>
            </label>
          </div>
          {!filtered.length ? (
            <Empty
              title="No related routes match"
              description="Relationships are based on route names and the configured namespace."
            />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Namespace</th>
                    <th>Relationship</th>
                    <th>Enabled in list</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(current * 15, current * 15 + 15).map((row) => (
                    <tr key={row.name}>
                      <td>
                        <button className="text-link" onClick={() => select(row.name)}>
                          {row.name}
                        </button>
                      </td>
                      <td>{row.namespace}</td>
                      <td>{row.relations.join(', ')}</td>
                      <td>
                        <Value value={row.enabled} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="application-pagination">
              <span>
                {filtered.length} routes · Page {current + 1} of {pages}
              </span>
              <button disabled={!current} onClick={() => setPage(current - 1)}>
                Previous
              </button>
              <button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
      <p className="scope-note">
        A parent or child path is a configuration relationship, not proof of which route a reverse
        proxy will select.
      </p>
    </section>
  );
}
function ApplicationDetail({
  name,
  back,
  select,
  onManage,
}: {
  name: string;
  back: () => void;
  select: (name: string) => void;
  onManage: (kind: 'apps' | 'security') => void;
}) {
  const [observation, setObservation] = useState<ApplicationObservation>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState('review');
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError('');
    request<ApplicationObservation>('application-center?name=' + encodeURIComponent(name))
      .then((value) => {
        if (live) setObservation(value);
      })
      .catch((caught) => {
        if (live) {
          if (caught instanceof RequestError && caught.status === 403) setObservation(undefined);
          setError((caught as Error).message);
        }
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [name, version]);
  const app = observation?.application.data;
  return (
    <>
      <button className="text-link" onClick={back}>
        <ArrowLeft size={16} /> All applications
      </button>
      <PageHeader
        title={name}
        description={
          app
            ? configurationText(app.Description) || 'Application configuration and dependencies.'
            : 'Application configuration and dependencies.'
        }
      >
        <button disabled={busy} onClick={() => setVersion((value) => value + 1)}>
          <RefreshCw size={16} className={busy ? 'spin' : ''} /> Refresh
        </button>
        <button
          disabled={!observation}
          onClick={() => download('harbor-application-inspection.json', observation)}
        >
          <Download size={16} /> Export
        </button>
        <button onClick={() => onManage('apps')}>Application administration</button>
      </PageHeader>
      {busy && <Loading />}
      {error && <ErrorBox error={error} retry={() => setVersion((value) => value + 1)} />}
      {observation && (
        <>
          {(busy || error) && (
            <p className="application-notice">
              The inspection below is from the previous successful collection.
            </p>
          )}
          <div className="application-summary">
            <div>
              <span>Enabled</span>
              <Value value={app?.Enabled} />
            </div>
            <div>
              <span>Namespace</span>
              <strong>{configurationText(app?.NameSpace) || 'Not returned'}</strong>
            </div>
            <div>
              <span>Entry resource</span>
              <strong>{configurationText(app?.Resource) || 'None returned'}</strong>
            </div>
            <div>
              <span>Handler</span>
              <strong>{app ? applicationKinds(app).join(' · ') : 'Unknown'}</strong>
            </div>
          </div>
          <div className="tabs" aria-label="Application inspection views">
            {['review', 'authentication', 'dependencies', 'configuration'].map((value) => (
              <button
                key={value}
                className={tab === value ? 'active' : ''}
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {
                  (
                    {
                      review: 'Review',
                      authentication: 'Authentication & cookies',
                      dependencies: 'Dependencies',
                      configuration: 'Configuration',
                    } as Record<string, string>
                  )[value]
                }
              </button>
            ))}
          </div>
          <div className="application-sections">
            {tab === 'review' && <Findings items={applicationFindings(observation)} />}
            {tab === 'authentication' && app && (
              <>
                <Authentication value={app.AutheEnabled} />
                <section className="panel padded">
                  <h2>Session and token configuration</h2>
                  <FieldList
                    record={app}
                    fields={[
                      'UseCookies',
                      'CookiePath',
                      'SessionScope',
                      'UserCookieScope',
                      'CSRFToken',
                      'Timeout',
                      'JWTAuthEnabled',
                      'JWTAccessTokenTimeout',
                      'JWTRefreshTokenTimeout',
                      'TwoFactorEnabled',
                      'GroupById',
                    ]}
                  />
                </section>
                <CorsSettings app={app} />
                <ApplicationRoles app={app} />
              </>
            )}
            {tab === 'dependencies' && (
              <>
                <div
                  className="application-dependency-chain"
                  aria-label="Configured dependency chain"
                >
                  <div>
                    <small>Application</small>
                    <strong>{name}</strong>
                  </div>
                  <span aria-hidden="true">→</span>
                  <div>
                    <small>Namespace</small>
                    <strong>{configurationText(app?.NameSpace) || 'Unknown'}</strong>
                  </div>
                  <span aria-hidden="true">→</span>
                  <div>
                    <small>Default databases</small>
                    <strong>
                      {observation.databases.map((database) => database.name).join(', ') ||
                        'Unknown'}
                    </strong>
                  </div>
                </div>
                <SourceCard
                  title="Namespace defaults"
                  source={observation.namespace}
                  fields={['Globals', 'Routines', 'TempGlobals']}
                />
                <p className="scope-note">
                  Namespace mappings can override these defaults. This view does not infer file
                  health or database availability from configuration.
                </p>
                {observation.databases.map((database) => (
                  <SourceCard
                    key={database.name}
                    title={database.name + ' · ' + database.uses.join(', ')}
                    source={database.source}
                  />
                ))}
                <SourceCard
                  title={
                    'Entry resource' +
                    (configurationText(app?.Resource)
                      ? ' · ' + configurationText(app?.Resource)
                      : '')
                  }
                  source={observation.resource}
                  fields={['Description', 'PublicPermission']}
                />
                <RelatedRoutes observation={observation} select={select} />
              </>
            )}
            {tab === 'configuration' && (
              <SourceCard
                title="Native application configuration"
                source={observation.application}
              />
            )}
          </div>
          <p className="scope-note">
            Collected {observation.startedAt} – {observation.finishedAt}. Sources are read
            separately; this is not an atomic snapshot or endpoint availability test.
          </p>
        </>
      )}
    </>
  );
}
function ServiceDetail({
  name,
  back,
  onManage,
}: {
  name: string;
  back: () => void;
  onManage: () => void;
}) {
  const [data, setData] = useState<ConfigurationRecord>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [version, setVersion] = useState(0);
  const [at, setAt] = useState('');
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError('');
    iris<ConfigurationRecord>('/v2/security/service', { name })
      .then((result) => {
        if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data))
          throw new Error('IRIS returned an unexpected service configuration.');
        if (live) {
          setData(result.data);
          setAt(new Date().toISOString());
        }
      })
      .catch((caught) => {
        if (live) {
          if (caught instanceof RequestError && caught.status === 403) {
            setData(undefined);
            setAt('');
          }
          setError((caught as Error).message);
        }
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [name, version]);
  return (
    <>
      <button className="text-link" onClick={back}>
        <ArrowLeft size={16} /> All services
      </button>
      <PageHeader title={name} description="Native service authentication and client restrictions.">
        <button disabled={busy} onClick={() => setVersion((value) => value + 1)}>
          <RefreshCw size={16} /> Refresh
        </button>
        <button onClick={onManage}>Security administration</button>
        <button
          disabled={!data}
          onClick={() =>
            download('harbor-service-inspection.json', { name, at, configuration: data })
          }
        >
          Export
        </button>
      </PageHeader>
      {busy && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && (
        <div className="application-sections">
          {(busy || error) && (
            <p className="application-notice">Showing the previous collection from {at}.</p>
          )}
          <Findings items={serviceFindings(data)} />
          <Authentication value={data.AutheEnabled} service />
          <section className="panel padded">
            <h2>Native service configuration</h2>
            <Details data={data} />
          </section>
          <p className="scope-note">
            An enabled service is not proof of network reachability. Review the listener, gateway
            and firewall configuration separately.
          </p>
        </div>
      )}
    </>
  );
}
export function ApplicationCenter({ onManage }: { onManage: (kind: 'apps' | 'security') => void }) {
  const [kind, setKind] = useState<'apps' | 'services'>('apps');
  const inventory = useData<ConfigurationRecord[]>(
    kind === 'apps' ? '/v2/web-apps' : '/v2/security/services',
  );
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [namespace, setNamespace] = useState('');
  const [page, setPage] = useState(0);
  const rows = Array.isArray(inventory.data) ? inventory.data : [];
  const namespaces = [
    ...new Set(rows.map((row) => configurationText(row.Namespace)).filter(Boolean)),
  ].sort();
  const filtered = rows.filter(
    (row) =>
      (!namespace || configurationText(row.Namespace) === namespace) &&
      [row.Name, row.Description, row.Namespace, row.DispatchClass].some((value) =>
        configurationText(value).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      ),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 20)),
    current = Math.min(page, pages - 1);
  if (selected)
    return (
      <div className="application-center">
        {kind === 'apps' ? (
          <ApplicationDetail
            key={selected}
            name={selected}
            select={setSelected}
            back={() => setSelected('')}
            onManage={onManage}
          />
        ) : (
          <ServiceDetail
            key={selected}
            name={selected}
            back={() => setSelected('')}
            onManage={() => onManage('security')}
          />
        )}
      </div>
    );
  return (
    <div className="application-center">
      <PageHeader
        title="Application & service inspector"
        description="Review authentication, configuration and related resources."
      >
        <button disabled={inventory.loading} onClick={inventory.refresh}>
          <RefreshCw size={16} /> Refresh inventory
        </button>
      </PageHeader>
      <div className="tabs" aria-label="Inspector inventories">
        {(['apps', 'services'] as const).map((value) => (
          <button
            key={value}
            className={kind === value ? 'active' : ''}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setNamespace('');
              setSearch('');
              setPage(0);
            }}
          >
            {value === 'apps' ? 'Web applications' : 'Native services'}
          </button>
        ))}
      </div>
      <section className="panel padded">
        <div className="application-filter-row">
          <label>
            Search {kind === 'apps' ? 'applications' : 'services'}
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </label>
          {kind === 'apps' && (
            <label>
              Namespace
              <select
                value={namespace}
                onChange={(event) => {
                  setNamespace(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">All namespaces</option>
                {namespaces.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {inventory.loading && <Loading />}
        {inventory.error && <ErrorBox error={inventory.error} retry={inventory.refresh} />}
        {!inventory.loading && !filtered.length && (
          <Empty
            title="No matching entries"
            description="Change the search or inspect the source error, if present."
          />
        )}
        {!!filtered.length && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>{kind === 'apps' ? 'Namespace' : 'Description'}</th>
                    <th>Enabled in list</th>
                    <th>{kind === 'apps' ? 'Dispatch class' : 'Authentication methods'}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(current * 20, current * 20 + 20).map((row, index) => (
                    <tr key={configurationText(row.Name) + index}>
                      <td>
                        <button
                          className="text-link"
                          disabled={!configurationText(row.Name)}
                          onClick={() => setSelected(configurationText(row.Name))}
                        >
                          {configurationText(row.Name) || 'Unnamed entry'}
                        </button>
                      </td>
                      <td>
                        {configurationText(kind === 'apps' ? row.Namespace : row.Description)}
                      </td>
                      <td>
                        <Value value={row.Enabled} />
                      </td>
                      <td>
                        <Value
                          value={kind === 'apps' ? row.DispatchClass : row.AuthenticationMethods}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="application-pagination">
              <span>
                {filtered.length} entries · Page {current + 1} of {pages}
              </span>
              <button disabled={!current} onClick={() => setPage(current - 1)}>
                Previous
              </button>
              <button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
