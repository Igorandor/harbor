import { useState, type ReactNode } from 'react';
import { resolveSchema, type Schema } from '../../shared/schema';
import { label } from '../../shared/catalog';

const safeKey = (key: string) =>
  key.length > 0 && !['__proto__', 'prototype', 'constructor'].includes(key);
function initial(schema: Schema): unknown {
  const s = resolveSchema(schema);
  return s.type === 'array'
    ? []
    : s.type === 'object' || s.properties
      ? {}
      : s.type === 'boolean'
        ? false
        : s.type === 'number' || s.type === 'integer'
          ? 0
          : '';
}

function NestedEditor({ title, children }: { title: string; children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="structured-section"
      onToggle={(e) => {
        if (e.target === e.currentTarget) setOpen(e.currentTarget.open);
      }}
    >
      <summary>{title}</summary>
      {open && children()}
    </details>
  );
}

/** Schema-guided nested controls, with explicit key/value editing for free-form maps. */
export function StructuredField({
  id,
  value,
  schema = {},
  onChange,
  depth = 0,
}: {
  id: string;
  value: any;
  schema?: Schema;
  onChange: (value: any) => void;
  depth?: number;
}) {
  const s = resolveSchema(schema),
    [newKey, setNewKey] = useState(''),
    [type, setType] = useState('string');
  const properties = s.properties ?? {},
    array = Array.isArray(value),
    object = value !== null && typeof value === 'object';
  if (depth > 8) return <p>Nested configuration exceeds the editor depth limit.</p>;
  if (!object) {
    if (s.enum)
      return (
        <select
          id={id}
          aria-label={id}
          value={String(value ?? '')}
          onChange={(e) => onChange(s.enum!.find((v) => String(v) === e.target.value))}
        >
          {s.enum.map((v) => (
            <option key={String(v)} value={String(v)}>
              {String(v)}
            </option>
          ))}
        </select>
      );
    if (typeof value === 'boolean' || s.type === 'boolean')
      return (
        <select
          id={id}
          aria-label={id}
          value={String(value ?? false)}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    const number = typeof value === 'number' || s.type === 'integer' || s.type === 'number';
    return (
      <input
        id={id}
        aria-label={id}
        type={
          number ? 'number' : /secret|password|token|credential/i.test(id) ? 'password' : 'text'
        }
        step={s.type === 'integer' ? 1 : 'any'}
        value={value ?? ''}
        onChange={(e) =>
          onChange(
            number ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value,
          )
        }
      />
    );
  }
  const entries = Object.entries(value),
    available = Object.keys(properties).filter(
      (k) => !Object.hasOwn(value, k) && !properties[k].readOnly,
    );
  return (
    <fieldset className="structured-field">
      <legend>{array ? `${entries.length} entries` : `${entries.length} settings`}</legend>
      {entries.slice(0, 100).map(([key, v]) => (
        <div className="structured-item" key={key}>
          <div className="structured-pair">
            <label htmlFor={`${id}-${key}`}>
              {array ? `Entry ${Number(key) + 1}` : label(key)}
            </label>
            {v !== null && typeof v === 'object' ? (
              <NestedEditor
                title={`${array ? `Entry ${Number(key) + 1}` : label(key)} · ${Object.keys(v).length} ${Array.isArray(v) ? 'entries' : 'settings'}`}
              >
                {() => (
                  <StructuredField
                    id={`${id}-${key}`}
                    value={v}
                    schema={array ? s.items : properties[key]}
                    depth={depth + 1}
                    onChange={(next) =>
                      onChange(
                        array
                          ? value.map((item: unknown, i: number) =>
                              i === Number(key) ? next : item,
                            )
                          : { ...value, [key]: next },
                      )
                    }
                  />
                )}
              </NestedEditor>
            ) : (
              <StructuredField
                id={`${id}-${key}`}
                value={v}
                schema={array ? s.items : properties[key]}
                depth={depth + 1}
                onChange={(next) =>
                  onChange(
                    array
                      ? value.map((item: unknown, i: number) => (i === Number(key) ? next : item))
                      : { ...value, [key]: next },
                  )
                }
              />
            )}
          </div>
          <button
            type="button"
            aria-label={`Remove ${array ? `entry ${Number(key) + 1}` : label(key)}`}
            onClick={() =>
              onChange(
                array
                  ? value.filter((_: unknown, i: number) => i !== Number(key))
                  : Object.fromEntries(entries.filter(([k]) => k !== key)),
              )
            }
          >
            Remove
          </button>
        </div>
      ))}
      {entries.length >= 100 ? (
        <p>Editor limit: 100 entries. Use a narrower configuration.</p>
      ) : array ? (
        <button type="button" onClick={() => onChange([...value, initial(s.items ?? {})])}>
          Add entry
        </button>
      ) : (
        <div className="data-toolbar">
          <label>
            Add setting
            {Object.keys(properties).length ? (
              <select value={newKey} onChange={(e) => setNewKey(e.target.value)}>
                <option value="">Select a setting</option>
                {available.map((key) => (
                  <option key={key}>{key}</option>
                ))}
              </select>
            ) : (
              <input
                aria-label={`New setting name for ${id}`}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
            )}
          </label>
          {!Object.keys(properties).length && (
            <label>
              Value type
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {['string', 'number', 'boolean', 'array', 'object'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={!safeKey(newKey) || Object.hasOwn(value, newKey)}
            onClick={() => {
              onChange({ ...value, [newKey]: initial(properties[newKey] ?? { type }) });
              setNewKey('');
            }}
          >
            Add setting
          </button>
        </div>
      )}
    </fieldset>
  );
}
