import { useEffect, useRef, type ReactNode } from 'react';

import { AlertCircle, Check, ChevronRight, LoaderCircle, RefreshCw, X } from 'lucide-react';

import { label } from '../../shared/catalog';

export function IconButton({
  title,
  onClick,
  children,
  disabled = false,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon-button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={'badge ' + tone}>{children}</span>;
}

export function Value({ value, field = '' }: { value: any; field?: string }) {
  if (value === undefined || value === null || value === '')
    return <span className="muted">—</span>;

  if (typeof value === 'boolean')
    return (
      <Badge tone={(field === 'Suspended' ? !value : value) ? 'good' : 'neutral'}>
        {field === 'Suspended'
          ? value
            ? 'Paused'
            : 'Scheduled'
          : field === 'Enabled'
            ? value
              ? 'Enabled'
              : 'Disabled'
            : value
              ? 'Yes'
              : 'No'}
      </Badge>
    );

  if (Array.isArray(value))
    return (
      <span className="chips">
        {value.length ? (
          value.map((v, i) => (
            <span key={i} className="chip">
              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </span>
          ))
        ) : (
          <span className="muted">None</span>
        )}
      </span>
    );

  if (typeof value === 'object') return <code>{JSON.stringify(value)}</code>;

  return <span>{String(value)}</span>;
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={18} />
      <div>
        <strong>Could not complete this request</strong>
        <p>{error}</p>
      </div>
      {retry && <button onClick={retry}>Try again</button>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={20} /> Loading from IRIS…
    </div>
  );
}

export function Empty({
  title = 'Nothing here yet',
  description = 'No records match the current view.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="empty">
      <span className="empty-mark">
        <Check size={22} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="header-actions">{children}</div>
    </header>
  );
}

export function Refresh({
  onClick,
  loading,
  at,
}: {
  onClick: () => void;
  loading: boolean;
  at?: Date;
}) {
  return (
    <div className="refresh">
      <span>
        {at
          ? 'Updated ' + at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'Not yet loaded'}
      </span>
      <IconButton title="Refresh data" onClick={onClick} disabled={loading}>
        <RefreshCw size={16} className={loading ? 'spin' : ''} />
      </IconButton>
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={'modal ' + (wide ? 'wide' : '')}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <IconButton title="Close dialog" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </header>
      {children}
    </dialog>
  );
}

export function Table({
  rows,
  columns,
  onSelect,
  keyField = 'Name',
}: {
  rows: any[];
  columns: string[];
  onSelect?: (row: any) => void;
  keyField?: string;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col">
                {label(c)}
              </th>
            ))}
            {onSelect && (
              <th>
                <span className="sr-only">Details</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row[keyField] ?? '') + '-' + i}>
              {columns.map((c, j) => (
                <td key={c}>
                  {j === 0 && onSelect ? (
                    <button className="text-link row-name" onClick={() => onSelect(row)}>
                      <Value value={row[c]} field={c} />
                    </button>
                  ) : (
                    <Value value={row[c]} field={c} />
                  )}
                </td>
              ))}
              {onSelect && (
                <td>
                  <IconButton
                    title={'Open ' + String(row[keyField] ?? 'record')}
                    onClick={() => onSelect(row)}
                  >
                    <ChevronRight size={16} />
                  </IconButton>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Details({ data }: { data: Record<string, any> }) {
  return (
    <dl className="details">
      {Object.entries(data).map(([k, v]) => (
        <div key={k}>
          <dt>{label(k)}</dt>
          <dd>
            <Value value={v} field={k} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
