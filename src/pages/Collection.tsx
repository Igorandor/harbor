import { useEffect, useState } from 'react';
import {
  Download,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
  Pencil,
  ArrowLeft,
  Square,
  KeyRound,
} from 'lucide-react';

import type { Entity } from '../../shared/catalog';

import { useData } from '../hooks';

import { iris, download } from '../api';

import {
  Details,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  PageHeader,
  Refresh,
  Table,
} from '../components/ui';

import { Editor } from '../components/Editor';

export function Collection({
  entity,
  info,
  notify,
  query = {},
}: {
  entity: Entity;
  info: any;
  notify: (message: string) => void;
  query?: Record<string, string>;
}) {
  const resource = useData<any[]>(entity.list, query),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<any>(),
    [editing, setEditing] = useState<{ identity?: string; initial?: any }>(),
    [page, setPage] = useState(0);

  const rows = Array.isArray(resource.data) ? resource.data : [],
    filtered = rows.filter((row) =>
      JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
    );
  useEffect(
    () => setPage((p) => Math.min(p, Math.max(0, Math.ceil(filtered.length / 20) - 1))),
    [filtered.length],
  );
  const canWrite = !!info.privileges?.[entity.privilege]?.use;

  function saved() {
    setEditing(undefined);
    setSelected(undefined);
    resource.refresh();
    notify('Changes applied to IRIS.');
  }

  return (
    <>
      <PageHeader title={entity.title} description={entity.description}>
        {!entity.readonly && (
          <button
            className="primary"
            disabled={!canWrite}
            title={!canWrite ? `Requires %Admin_${entity.privilege}:USE` : undefined}
            onClick={() => setEditing({})}
          >
            <Plus size={16} /> Create {entity.singular}
          </button>
        )}
      </PageHeader>

      <section className="panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label={'Search ' + entity.title.toLowerCase()}
              placeholder={'Search ' + entity.title.toLowerCase() + '…'}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="toolbar-right">
            <span className="count">{filtered.length} records</span>
            <button
              className="subtle small"
              disabled={!rows.length}
              onClick={() => download(entity.id + '.json', filtered)}
            >
              <Download size={15} /> Export
            </button>
            <Refresh onClick={resource.refresh} loading={resource.loading} at={resource.at} />
          </div>
        </div>

        {resource.error && <ErrorBox error={resource.error} retry={resource.refresh} />}
        {resource.loading && !resource.data ? (
          <Loading />
        ) : filtered.length ? (
          <Table
            rows={filtered.slice(page * 20, (page + 1) * 20)}
            columns={entity.columns}
            keyField={entity.key}
            onSelect={setSelected}
          />
        ) : (
          !resource.error && (
            <Empty
              title={search ? 'No matching records' : 'No ' + entity.title.toLowerCase() + ' yet'}
              description={
                search
                  ? 'Try a different search.'
                  : entity.readonly
                    ? 'IRIS returned no records.'
                    : 'Create one to get started.'
              }
            />
          )
        )}

        <div className="table-footer">
          <span>
            Showing {Math.min(page * 20 + 1, filtered.length)}–
            {Math.min((page + 1) * 20, filtered.length)} of {filtered.length}
            {rows.length >= 250
              ? ' · First 250 returned. Use REST explorer for a server filter.'
              : ''}
          </span>
          <div>
            <button className="small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button
              className="small"
              disabled={(page + 1) * 20 >= filtered.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {selected && (
        <RecordDetail
          entity={entity}
          row={selected}
          canWrite={canWrite}
          onClose={() => setSelected(undefined)}
          onEdit={(initial) => {
            setEditing({ identity: String(selected[entity.key]), initial });
            setSelected(undefined);
          }}
          onChanged={saved}
        />
      )}

      {editing && (
        <Editor
          entity={entity}
          currentUser={info.username}
          {...editing}
          onClose={() => setEditing(undefined)}
          onSaved={saved}
        />
      )}
    </>
  );
}

function RecordDetail({
  entity,
  row,
  canWrite,
  onClose,
  onEdit,
  onChanged,
}: {
  entity: Entity;
  row: any;
  canWrite: boolean;
  onClose: () => void;
  onEdit: (data: any) => void;
  onChanged: () => void;
}) {
  const identity = String(row[entity.key]),
    resource = useData(
      entity.noDetail ? entity.list : entity.detail!,
      entity.noDetail ? { collection: identity.split('.')[0] } : { [entity.param!]: identity },
    );

  const taskInfo = useData(entity.id === 'tasks' ? '/v2/task/info' : '', { id: identity });

  const [secretEditor, setSecretEditor] = useState(false);

  const [action, setAction] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');

  async function execute() {
    setBusy(true);
    setError('');
    try {
      const path =
        action === 'delete'
          ? entity.detail!
          : (entity.id === 'tasks' ? '/v2/task/' : '/v2/process/') + action;

      await iris(
        path,
        { [entity.param!]: identity },
        action === 'delete' ? 'DELETE' : 'POST',
        action === 'run'
          ? { RunNow: true }
          : action === 'suspend' && entity.id === 'tasks'
            ? { LeaveInQueue: true }
            : undefined,
      );
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const data = entity.noDetail ? row : resource.data;

  const suspended = taskInfo.data?.Suspended;

  if (secretEditor)
    return (
      <Editor
        entity={{
          ...entity,
          id: 'credentialUpdate',
          singular: entity.id === 'users' ? 'account password' : 'OAuth credentials',
          detail: entity.detail + (entity.id === 'users' ? '/password' : '/secrets'),
          noDetail: true,
          fields:
            entity.id === 'users'
              ? ['NewPassword']
              : ['ClientSecret', 'ClientPassword', 'Metadata'],
          defaults: {},
        }}
        identity={identity}
        initial={{}}
        methodOverride="POST"
        onClose={() => setSecretEditor(false)}
        onSaved={onChanged}
      />
    );

  return (
    <Modal
      title={String(row.Name ?? row.Alias ?? identity)}
      subtitle={entity.singular + ' · ' + identity}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      {error && <ErrorBox error={error} />}
      <div className="modal-body">
        {action ? (
          <>
            <div className="notice warning">
              {action === 'delete'
                ? 'This permanently removes the selected record.'
                : action === 'run'
                  ? 'This requests an immediate run. Its task code may modify data.'
                  : action === 'terminate'
                    ? 'Terminating a process can interrupt active work.'
                    : 'This changes the scheduling or execution state in IRIS.'}
            </div>
            <h3>
              {action[0].toUpperCase() + action.slice(1)} {entity.singular}
            </h3>
            <p>
              Type <strong>{identity}</strong> to confirm the target.
            </p>
            <input
              aria-label="Confirm target"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </>
        ) : (
          <>
            {resource.error && <ErrorBox error={resource.error} retry={resource.refresh} />}
            {taskInfo.error && <ErrorBox error={taskInfo.error} retry={taskInfo.refresh} />}
            {!data ? (
              resource.loading && <Loading />
            ) : (
              <>
                <Details data={data} />
                {entity.id === 'tasks' && taskInfo.data && <Details data={taskInfo.data} />}
              </>
            )}
          </>
        )}
      </div>

      <footer>
        {action ? (
          <>
            <button
              disabled={busy}
              onClick={() => {
                setAction('');
                setConfirmation('');
              }}
            >
              <ArrowLeft size={16} /> Back
            </button>
            <button
              className="danger"
              disabled={confirmation !== identity || busy}
              onClick={execute}
            >
              {busy ? 'Applying…' : 'Confirm ' + action}
            </button>
          </>
        ) : (
          <>
            <button onClick={onClose}>Close</button>
            <div className="inline-actions">
              {entity.id === 'tasks' && canWrite && (
                <>
                  <button onClick={() => setAction('run')}>
                    <Play size={15} /> Run now
                  </button>
                  <button
                    disabled={suspended === undefined}
                    onClick={() => setAction(suspended ? 'resume' : 'suspend')}
                  >
                    <Pause size={15} />
                    {suspended ? 'Resume' : 'Suspend'}
                  </button>
                </>
              )}

              {entity.id === 'processes' && canWrite && (
                <>
                  <button disabled={!row.CanBeSuspended} onClick={() => setAction('suspend')}>
                    <Pause size={15} /> Suspend
                  </button>
                  <button onClick={() => setAction('resume')}>
                    <Play size={15} /> Resume
                  </button>
                  <button
                    className="danger"
                    disabled={!row.CanBeTerminated}
                    onClick={() => setAction('terminate')}
                  >
                    <Square size={15} /> Terminate
                  </button>
                </>
              )}

              {['users', 'oauthClients'].includes(entity.id) && canWrite && (
                <button onClick={() => setSecretEditor(true)}>
                  <KeyRound size={15} />{' '}
                  {entity.id === 'users' ? 'Reset password' : 'Client credentials'}
                </button>
              )}

              {!entity.readonly && canWrite && (
                <>
                  <button className="danger subtle" onClick={() => setAction('delete')}>
                    <Trash2 size={15} /> Delete
                  </button>
                  <button
                    className="primary"
                    disabled={!data && !entity.noDetail}
                    onClick={() => onEdit(entity.noDetail ? undefined : data)}
                  >
                    <Pencil size={15} /> {entity.noDetail ? 'Rotate' : 'Edit'}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </footer>
    </Modal>
  );
}
