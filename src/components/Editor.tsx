import { DataValue } from './DataView';
import { StructuredField } from './StructuredField';
import { useState } from 'react';

import { ArrowLeft, ArrowRight, Check, Plus, Trash2 } from 'lucide-react';

import {
  bodySchema,
  parameters,
  resolveSchema,
  plainDescription,
  type Schema,
  type RecordData,
} from '../../shared/schema';

import { label, type Entity } from '../../shared/catalog';

import { prepareChange, executeChange, request } from '../api';
import type { ChangeRecord } from '../../shared/change-record';
import { ChangeImpact } from './ChangeImpact';

import { taskDefaults } from '../../shared/task-defaults';

import { redact } from '../../shared/redaction';

import { ErrorBox, Modal } from './ui';

const sensitive = (key: string) => /password|secret|credential|hotp|token|keyfile/i.test(key);

function Field({
  name,
  schema,
  value,
  onChange,
}: {
  name: string;
  schema: Schema;
  value: any;
  onChange: (value: any) => void;
}) {
  const resolved = resolveSchema(schema),
    id = 'field-' + name,
    description = plainDescription(resolved.description);

  const control =
    name === 'AutheEnabled' ? (
      <fieldset className="auth-methods">
        <legend className="sr-only">Authentication methods</legend>
        {[
          [32, 'Password'],
          [2048, 'LDAP'],
          [4, 'Kerberos'],
          [8192, 'Delegated'],
          [64, 'Unauthenticated'],
        ].map(([bit, title]) => (
          <label className="checkbox" key={bit}>
            <input
              type="checkbox"
              checked={!!(Number(value ?? 0) & Number(bit))}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? Number(value ?? 0) | Number(bit)
                    : Number(value ?? 0) & ~Number(bit),
                )
              }
            />
            {title}
          </label>
        ))}
      </fieldset>
    ) : resolved.enum ? (
      <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {resolved.enum.map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    ) : resolved.type === 'boolean' ? (
      <select
        id={id}
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
      >
        <option value="">Use IRIS default</option>
        <option value="true">{name === 'Suspended' ? 'Paused' : 'Yes'}</option>
        <option value="false">{name === 'Suspended' ? 'Scheduled' : 'No'}</option>
      </select>
    ) : name === 'Resources' ? (
      <ResourceGrants value={Array.isArray(value) ? value : []} onChange={onChange} />
    ) : resolved.type === 'array' && (resolved.items?.type === 'string' || !resolved.items) ? (
      <StringList id={id} value={value ?? []} onChange={onChange} />
    ) : resolved.type === 'object' || resolved.type === 'array' ? (
      <StructuredField
        schema={resolved}
        id={id}
        value={value ?? (resolved.type === 'array' ? [] : {})}
        onChange={onChange}
      />
    ) : (
      <input
        id={id}
        type={
          sensitive(name)
            ? 'password'
            : resolved.type === 'integer' || resolved.type === 'number'
              ? 'number'
              : 'text'
        }
        autoComplete="off"
        value={value ?? ''}
        onChange={(e) =>
          onChange(
            resolved.type === 'integer' || resolved.type === 'number'
              ? e.target.value === ''
                ? undefined
                : Number(e.target.value)
              : e.target.value,
          )
        }
      />
    );

  return (
    <div className="field">
      <label htmlFor={id}>{label(name)}</label>
      {control}
      {description && (
        <small>{description.length > 220 ? description.slice(0, 220) + '…' : description}</small>
      )}
    </div>
  );
}

function StringList({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [text, setText] = useState(value.join(', '));

  return (
    <input
      id={id}
      value={text}
      placeholder="Separate entries with commas"
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

function ResourceGrants({ value, onChange }: { value: any[]; onChange: (value: any) => void }) {
  return (
    <div className="grant-list">
      {value.map((grant, i) => (
        <div className="grant" key={i}>
          <input
            aria-label={'Resource ' + (i + 1)}
            placeholder="Resource name"
            value={grant.Name ?? ''}
            onChange={(e) =>
              onChange(value.map((g, j) => (i === j ? { ...g, Name: e.target.value } : g)))
            }
          />
          <select
            aria-label={'Permission ' + (i + 1)}
            value={grant.Permissions ?? 'R'}
            onChange={(e) =>
              onChange(value.map((g, j) => (i === j ? { ...g, Permissions: e.target.value } : g)))
            }
          >
            {['R', 'W', 'U', 'RW', 'RU', 'WU', 'RWU'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <button
            type="button"
            className="icon-button"
            aria-label={'Remove grant ' + (i + 1)}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="subtle small"
        onClick={() => onChange([...value, { Name: '', Permissions: 'R' }])}
      >
        <Plus size={14} /> Add resource grant
      </button>
    </div>
  );
}
function WalletConfig({
  value,
  onChange,
}: {
  value: RecordData;
  onChange: (value: RecordData) => void;
}) {
  const [pairs, setPairs] = useState<[string, string][]>(() => Object.entries(value.Secret ?? {}));
  const updatePairs = (next: [string, string][]) => {
    setPairs(next);
    onChange({ ...value, Secret: Object.fromEntries(next.filter(([key]) => key)) });
  };
  return (
    <div className="field full wallet-config">
      <h3>Key-value secret</h3>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="allowed-hosts">Allowed hosts</label>
          <StringList
            id="allowed-hosts"
            value={value.AllowedHosts ?? []}
            onChange={(AllowedHosts) => onChange({ ...value, AllowedHosts })}
          />
          <small>DNS names allowed to receive this secret, separated by commas.</small>
        </div>
        <div className="field">
          <label htmlFor="secret-usage">Usage</label>
          <StringList
            id="secret-usage"
            value={value.Usage ?? ['HTTP']}
            onChange={(Usage) => onChange({ ...value, Usage })}
          />
        </div>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={value.RequireTLS !== false}
          onChange={(e) => onChange({ ...value, RequireTLS: e.target.checked })}
        />{' '}
        Require TLS when using this secret
      </label>
      {pairs.map(([key, secret], i) => (
        <div className="grant" key={i}>
          <input
            aria-label={'Secret key ' + (i + 1)}
            placeholder="Key, e.g. apiKey"
            required
            value={key}
            onChange={(e) =>
              updatePairs(pairs.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))
            }
          />
          <input
            aria-label={'Secret value ' + (i + 1)}
            placeholder="Secret value"
            type="password"
            autoComplete="new-password"
            required
            value={secret}
            onChange={(e) =>
              updatePairs(pairs.map((p, j) => (j === i ? [p[0], e.target.value] : p)))
            }
          />
          <button
            type="button"
            className="icon-button"
            aria-label={'Remove secret field ' + (i + 1)}
            onClick={() => updatePairs(pairs.filter((_, j) => j !== i))}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="subtle small"
        onClick={() => updatePairs([...pairs, ['', '']])}
      >
        <Plus size={14} /> Add secret field
      </button>
      <small>
        Values are write-only. Rotating a secret requires supplying the complete replacement
        configuration.
      </small>
    </div>
  );
}
export function Editor({
  entity,
  identity = '',
  initial,
  onClose,
  onSaved,
  currentUser = '',
  methodOverride,
}: {
  entity: Entity;
  identity?: string;
  initial?: RecordData;
  onClose: () => void;
  onSaved: () => void;
  currentUser?: string;
  methodOverride?: 'POST';
}) {
  const editing = !!identity,
    method = methodOverride ?? (editing ? 'PUT' : (entity.createMethod ?? 'PUT')),
    path = entity.detail!;

  const schema = bodySchema(path, method),
    props =
      entity.id === 'users' && !editing
        ? (bodySchema(path, 'PUT').properties ?? {})
        : (schema.properties ?? {});

  const [name, setName] = useState(identity),
    [password, setPassword] = useState(''),
    [form, setForm] = useState<RecordData>(
      initial ?? (entity.id === 'tasks' ? taskDefaults(currentUser) : (entity.defaults ?? {})),
    ),
    [fields, setFields] = useState(() =>
      [
        ...new Set([
          ...(entity.fields ?? []),
          ...Object.keys(entity.defaults ?? {}),
          ...(!editing && entity.id === 'certificates'
            ? ['CertificateFile', 'PrivateKeyFile', 'PrivateKeyPassword']
            : []),
        ]),
      ].filter((k) => props[k]),
    );

  const [step, setStep] = useState<'edit' | 'review'>('edit'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [discover, setDiscover] = useState(true);
  const [prepared, setPrepared] = useState<ChangeRecord>();
  const payload = Object.fromEntries(
    Object.entries(form).filter(
      ([k, v]) =>
        props[k] &&
        v !== undefined &&
        v !== '[redacted]' &&
        (!editing || JSON.stringify(v) !== JSON.stringify(initial?.[k])),
    ),
  );

  const needIdentity = parameters(path, method.toLowerCase()).some(
    (p) => p.required && p.name === entity.param,
  );

  async function prepare() {
    setBusy(true);
    setError('');

    try {
      const body =
        entity.id === 'users' && !editing
          ? { User: payload, Password: password }
          : entity.id === 'tasks' && !editing
            ? form
            : entity.id === 'certificates' && !editing
              ? { ...payload, Alias: name.trim() }
              : payload;
      const review = await prepareChange(
        {
          path,
          method,
          body,
          query: {
            ...(needIdentity ? { [entity.param!]: name.trim() } : {}),
            ...(entity.id === 'oauthServers' && !editing && discover ? { discover: '1' } : {}),
          },
        },
        editing && !entity.noDetail
          ? Object.fromEntries(
              Object.keys(payload)
                .filter((key) => !sensitive(key))
                .map((key) => [key, initial?.[key]]),
            )
          : undefined,
      );
      setPrepared(review);
      setStep('review');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!prepared) return;
    setBusy(true);
    setError('');
    try {
      await executeChange(prepared);
      onSaved();
    } catch (error) {
      setError((error as Error).message);
      setPrepared(undefined);
    } finally {
      setBusy(false);
    }
  }
  async function back() {
    if (prepared) {
      try {
        await request('changes/' + prepared.id + '/cancel', { revision: prepared.revision });
      } catch {
        /* A prepared review expires without dispatch if it cannot be canceled. */
      }
    }
    setPrepared(undefined);
    setStep('edit');
  }

  return (
    <Modal
      title={(editing ? 'Edit ' : 'Create ') + entity.singular}
      subtitle={editing ? identity : 'Changes are applied to the connected IRIS instance.'}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="step-line">
        <span className={step === 'edit' ? 'active' : ''}>1 · Configure</span>
        <ArrowRight size={14} />
        <span className={step === 'review' ? 'active' : ''}>2 · Review changes</span>
      </div>

      {error && <ErrorBox error={error} />}

      {step === 'edit' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            if (!Object.keys(payload).length && editing) {
              setError('No fields have changed.');
              return;
            }
            void prepare();
          }}
        >
          <div className="modal-body form-grid">
            {!editing && needIdentity && (
              <div className="field full">
                <label htmlFor="record-name">
                  {entity.id === 'secrets' ? 'Full secret name (collection.name)' : 'Name'}
                </label>
                <input
                  id="record-name"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}

            {entity.id === 'users' && !editing && (
              <div className="field full">
                <label htmlFor="new-password">Initial password</label>
                <input
                  id="new-password"
                  required
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}

            {entity.id === 'oauthServers' && !editing && (
              <label className="checkbox full">
                <input
                  type="checkbox"
                  checked={discover}
                  onChange={(e) => setDiscover(e.target.checked)}
                />{' '}
                Discover OAuth metadata from the issuer URL
              </label>
            )}
            {fields.map((key) =>
              key === 'WalletSecretConfig' && form.Type === '%Wallet.KeyValue' ? (
                <WalletConfig
                  key={key}
                  value={form[key] ?? { RequireTLS: true, Usage: ['HTTP'] }}
                  onChange={(value) => setForm({ ...form, [key]: value })}
                />
              ) : (
                <Field
                  key={key}
                  name={key}
                  schema={props[key]}
                  value={form[key]}
                  onChange={(value) =>
                    setForm({
                      ...form,
                      [key]: value,
                      ...(entity.id === 'secrets' && key === 'Type'
                        ? { WalletSecretConfig: {} }
                        : {}),
                    })
                  }
                />
              ),
            )}
            <div className="field full advanced-field">
              <label htmlFor="additional-property">Additional setting</label>
              <select
                id="additional-property"
                value=""
                onChange={(e) => setFields([...fields, e.target.value])}
              >
                <option value="">Add a setting from the IRIS schema…</option>
                {Object.keys(props)
                  .filter((k) => !fields.includes(k) && !props[k].readOnly)
                  .map((k) => (
                    <option key={k} value={k}>
                      {label(k)}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <footer>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'Preparing review…' : 'Review changes'} <ArrowRight size={16} />
            </button>
          </footer>
        </form>
      ) : (
        <>
          <div className="modal-body">
            {prepared?.impact && <ChangeImpact impact={prepared.impact} />}
            <div className="notice">
              {editing
                ? 'Only the changed fields will be sent.'
                : 'IRIS validates this configuration when it is created.'}{' '}
              Secret values are hidden in this review.
            </div>
            <div className="review-target">
              <span>{method}</span>
              <code>{path}</code>
              <strong>{name}</strong>
            </div>
            <table className="diff">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(payload).map(([k, v]) => (
                  <tr key={k}>
                    <td>{label(k)}</td>
                    <td>
                      {sensitive(k) ? (
                        'Hidden'
                      ) : (
                        <DataValue value={redact(initial?.[k])} field={k} />
                      )}
                    </td>
                    <td>{sensitive(k) ? '••••••••' : <DataValue value={redact(v)} field={k} />}</td>
                  </tr>
                ))}
                {password && (
                  <tr>
                    <td>Initial password</td>
                    <td>Not set</td>
                    <td>••••••••</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <footer>
            <button disabled={busy} onClick={() => void back()}>
              <ArrowLeft size={16} /> Back
            </button>
            <button className="primary" disabled={busy || !prepared} onClick={save}>
              {busy ? 'Applying…' : 'Apply changes'} <Check size={16} />
            </button>
          </footer>
        </>
      )}
    </Modal>
  );
}
