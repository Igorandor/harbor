import { ApiError, IrisClient, validateOperation, type Operation } from './upstream.js';
import { WorkspaceStore, type WorkspaceIdentity } from './workspace-store.js';
import { redact, credentialValues } from '../shared/redaction.js';
import { stableValue, type ChangeRecord, type ChangeField } from '../shared/change-record.js';
import { parameters, spec } from '../shared/schema.js';
import { assessChangeImpact } from './change-impact.js';
import { parseProcessState } from '../shared/runtime-analysis.js';

type Actor = WorkspaceIdentity & { auth: string };
type Prepared = {
  operation: Operation;
  baseline?: any;
  expires: number;
  owner: string;
  instance: string;
};
type Reader = { path: string; query: Record<string, string> };
const booleanPolicies = new Set(['ChangePassword', 'PasswordNeverExpires', 'HOTPKeyDisplay']);
const writeOnly = (name: string, value: unknown) =>
  !(typeof value === 'boolean' && booleanPolicies.has(name)) &&
  /password|secret|privatekey|token|walletsecretconfig|hotpkey/i.test(
    name.replace(/[^a-z0-9]/gi, ''),
  );
const redactField = (name: string, value: unknown) => redact({ [name]: value })[name];
const clone = <T>(value: T): T => structuredClone(value);

export class ChangeService {
  private pending = new Map<string, Prepared>();
  private targets = new Set<string>();
  constructor(
    readonly store: WorkspaceStore,
    private client: IrisClient,
  ) {}

  private reader(op: Operation): Reader | undefined {
    let path = op.path;
    if (path.startsWith('/v2/process/')) path = '/v2/process';
    if (/^\/v2\/task\/(suspend|resume)$/.test(path)) path = '/v2/task/info';
    if (
      path === '/v2/task/run' ||
      /\/(password|secrets)$/.test(path) ||
      path === '/v2/wallet/secret'
    )
      return undefined;
    const available = parameters(path, 'get');
    if (!spec.paths[path]?.get) return undefined;
    const query = Object.fromEntries(
      available
        .filter((p) => op.query?.[p.name] !== undefined)
        .map((p) => [p.name, op.query![p.name]]),
    );
    if (available.some((p) => p.required && !query[p.name])) return undefined;
    return { path, query };
  }
  private async read(actor: Actor, reader: Reader) {
    return (await this.client.request(actor.auth, { ...reader, method: 'GET' })).data;
  }
  private target(op: Operation) {
    return (
      op.query?.name ??
      op.query?.id ??
      op.query?.alias ??
      op.query?.applicationName ??
      op.query?.serverId ??
      String(op.body?.Name ?? op.body?.Alias ?? 'New record')
    );
  }
  private event(record: ChangeRecord, action: string, message: string) {
    record.updatedAt = new Date().toISOString();
    record.events.push({ at: record.updatedAt, action, message });
    record.events = record.events.slice(-80);
  }
  private async save(record: ChangeRecord) {
    const previous = record.revision;
    record.revision++;
    return this.store.write(record, 'changes', previous);
  }
  private requireProcessIdentity(value: any) {
    if (
      !value ||
      !Number.isSafeInteger(value.Pid) ||
      typeof value.StartTimeUTC !== 'string' ||
      !value.StartTimeUTC.trim()
    )
      throw new ApiError(
        409,
        'IRIS did not supply a process ID and start time. Refresh the process before preparing this action.',
      );
  }
  private editableFields(op: Operation): Record<string, unknown> {
    if (
      op.path === '/v2/security/user' &&
      op.method === 'POST' &&
      op.body?.User &&
      typeof op.body.User === 'object'
    )
      return { ...op.body.User, Password: op.body.Password };
    return op.body ?? {};
  }
  private protectAccess(actor: Actor, op: Operation) {
    const name = String(op.query?.name ?? '').toLowerCase();
    if (op.path === '/v2/security/user' && name === actor.owner.toLowerCase()) {
      if (
        op.method === 'DELETE' ||
        op.body?.Enabled === false ||
        Object.hasOwn(op.body ?? {}, 'Roles') ||
        Object.hasOwn(op.body ?? {}, 'EscalationRoles')
      )
        throw new ApiError(
          409,
          'Harbor does not remove or change the active account’s access. Use a second authorized administrator account after checking recovery access.',
        );
    }
    if (op.path === '/v2/web-app') {
      const canonical = name.replace(/\/+$/, '') || '/';
      if (canonical === '/api' || /^\/(api\/(admin|harbor)|csp\/sys)(\/|$)/.test(canonical))
        throw new ApiError(
          409,
          'Harbor protects its own API and native administration routes. Manage these routes using an independent recovery connection.',
        );
    }
    if (
      op.method === 'DELETE' &&
      op.path === '/v2/security/role' &&
      ['%all', '%manager', '%operator'].includes(name)
    )
      throw new ApiError(409, 'Built-in administration roles cannot be deleted through Harbor.');
  }
  private processMatches(before: any, current: any) {
    return (
      before?.Pid === current?.Pid &&
      before?.StartTimeUTC === current?.StartTimeUTC &&
      before?.JobNumber === current?.JobNumber
    );
  }
  async prepare(
    actor: Actor,
    operation: Operation,
    expected?: Record<string, unknown>,
  ): Promise<ChangeRecord> {
    validateOperation(operation);
    this.protectAccess(actor, operation);
    if (operation.method === 'GET' || operation.path === '/v2/security/audit/records')
      throw new ApiError(400, 'This endpoint prepares configuration changes only.');
    for (const [id, value] of this.pending) if (value.expires < Date.now()) this.pending.delete(id);
    if (this.pending.size >= 200)
      throw new ApiError(
        429,
        'Too many changes are awaiting review. Cancel or finish an existing review.',
      );
    const op = clone(operation),
      reader = this.reader(op);
    let baseline: any;
    if (reader) {
      try {
        baseline = await this.read(actor, reader);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404 && op.method !== 'DELETE'))
          throw error;
      }
    }
    if (op.path.startsWith('/v2/process/')) this.requireProcessIdentity(baseline);
    if (
      expected &&
      Object.entries(expected).some(
        ([key, value]) => stableValue(value) !== stableValue(baseline?.[key]),
      )
    )
      throw new ApiError(
        409,
        'The selected fields changed after you inspected them. Reload the record before preparing a change.',
      );
    const fields: ChangeField[] = Object.entries(this.editableFields(op)).map(([name, value]) => ({
      name,
      before: redactField(name, baseline?.[name]),
      requested: writeOnly(name, value) ? '[redacted]' : redactField(name, value),
      readable: !writeOnly(name, value) && !!reader,
    }));
    const process = op.path.startsWith('/v2/process/');
    const taskState = /^\/v2\/task\/(suspend|resume)$/.test(op.path);
    const now = Date.now();
    const impact = await assessChangeImpact(this.client, actor.auth, op, baseline);
    const record = await this.store.create(actor, 'changes', {
      version: 1 as const,
      owner: actor.owner,
      instance: actor.instance,
      title:
        op.method === 'DELETE'
          ? 'Delete record'
          : process
            ? op.path.split('/').at(-1)! + ' process'
            : 'Change configuration',
      target: this.target(op),
      path: op.path,
      method: op.method as ChangeRecord['method'],
      query: op.query ?? {},
      expiresAt: new Date(now + 600_000).toISOString(),
      state: 'prepared' as const,
      fields,
      impact,
      baseline: redact(baseline),
      explanation:
        'Review the selected fields. The server checks them again immediately before sending the request.',
      verification: process
        ? ('process' as const)
        : taskState
          ? ('task-state' as const)
          : op.method === 'DELETE' && reader
            ? ('absence' as const)
            : reader && fields.some((f) => f.readable)
              ? ('fields' as const)
              : ('response' as const),
      events: [
        {
          at: new Date(now).toISOString(),
          action: 'prepared',
          message: 'Native state was read. No change has been sent.',
        },
      ],
    });
    this.pending.set(record.id, {
      operation: op,
      baseline,
      expires: now + 600_000,
      owner: actor.owner,
      instance: actor.instance,
    });
    return record;
  }
  async get(actor: Actor, id: string): Promise<ChangeRecord> {
    return this.store.exclusive(actor, 'changes', id, async () => {
      const record = await this.store.read<ChangeRecord>(actor, 'changes', id);
      if (record.state === 'sending') {
        record.state = 'uncertain';
        this.event(
          record,
          'interrupted',
          'The gateway did not retain the final result. Read the current state before attempting another change.',
        );
        return this.save(record);
      }
      if (
        record.state === 'prepared' &&
        (!this.pending.has(id) || new Date(record.expiresAt).getTime() < Date.now())
      ) {
        record.state = 'expired';
        this.pending.delete(id);
        this.event(
          record,
          'expired',
          'The review expired or the gateway restarted. Prepare a new review to send this change.',
        );
        return this.save(record);
      }
      return record;
    });
  }
  async cancel(actor: Actor, id: string, revision: number) {
    return this.store.exclusive(actor, 'changes', id, async () => {
      const record = await this.store.read<ChangeRecord>(actor, 'changes', id);
      if (record.revision !== revision || record.state !== 'prepared')
        throw new ApiError(409, 'Only the current prepared review can be canceled.');
      record.state = 'canceled';
      this.pending.delete(id);
      this.event(record, 'canceled', 'The review was canceled. No native request was sent.');
      return this.save(record);
    });
  }
  async execute(actor: Actor, id: string, revision: number, confirmation: string) {
    return this.store.exclusive(actor, 'changes', id, async () => {
      const record = await this.store.read<ChangeRecord>(actor, 'changes', id);
      if (record.revision !== revision || record.state !== 'prepared')
        throw new ApiError(409, 'This review is no longer ready. Refresh its recorded result.');
      const prepared = this.pending.get(id);
      if (
        !prepared ||
        prepared.owner !== actor.owner ||
        prepared.instance !== actor.instance ||
        prepared.expires < Date.now()
      )
        throw new ApiError(409, 'This review expired. Prepare the change again.');
      if (confirmation !== record.target)
        throw new ApiError(400, 'Type the exact target to confirm the change.');
      const op = prepared.operation;
      this.protectAccess(actor, op);
      const canonicalTarget = op.path.startsWith('/v2/web-app')
        ? record.target.toLowerCase().replace(/\/+$/, '') || '/'
        : /^\/v2\/(task|process)(\/|$)/.test(op.path) && /^\d+$/.test(record.target)
          ? String(Number(record.target))
          : record.target.toLowerCase();
      const key = JSON.stringify([
        actor.instance,
        /^\/v2\/(task|process)(\/|$)/.exec(op.path)?.[1] ?? this.reader(op)?.path ?? op.path,
        canonicalTarget,
      ]);
      if (this.targets.has(key))
        throw new ApiError(409, 'Another change to this target is in progress.');
      this.targets.add(key);
      try {
        const reader = this.reader(op);
        if (reader) {
          let current: any;
          try {
            current = await this.read(actor, reader);
          } catch (error) {
            if (!(
              error instanceof ApiError &&
              error.status === 404 &&
              prepared.baseline === undefined
            ))
              throw error;
          }
          const conflict =
            record.verification === 'process'
              ? !this.processMatches(prepared.baseline, current)
              : op.method === 'DELETE'
                ? stableValue(prepared.baseline) !== stableValue(current)
                : record.verification === 'task-state'
                  ? prepared.baseline?.Suspended !== current?.Suspended
                  : Object.entries(this.editableFields(op)).some(
                      ([name, value]) =>
                        !writeOnly(name, value) &&
                        stableValue(prepared.baseline?.[name]) !== stableValue(current?.[name]),
                    );
          if (conflict) {
            record.state = 'conflict';
            record.explanation = 'Native state changed after review. No request was sent.';
            this.event(record, 'conflict', record.explanation);
            this.pending.delete(id);
            return this.save(record);
          }
          if (
            op.path.endsWith('/suspend') &&
            record.verification === 'process' &&
            current.CanBeSuspended !== true
          )
            throw new ApiError(409, 'IRIS does not permit suspending this process.');
          if (op.path.endsWith('/terminate') && current?.CanBeTerminated !== true)
            throw new ApiError(409, 'IRIS does not permit terminating this process.');
        }
        record.state = 'sending';
        this.event(
          record,
          'dispatch',
          'The request is being sent once. An interrupted response will require reconciliation.',
        );
        await this.save(record);
        this.pending.delete(id);
        try {
          const response = await this.client.request(actor.auth, op);
          record.nativeStatus = response.status;
          record.result = redact(response.data, credentialValues(op.body));
          record.asyncId = response.asyncId;
          if (op.path === '/v2/task' && op.method === 'POST' && !op.query?.id) {
            const generated = response.data?.Id;
            if (
              (typeof generated === 'number' && Number.isSafeInteger(generated) && generated > 0) ||
              (typeof generated === 'string' && /^[1-9]\d*$/.test(generated))
            ) {
              record.readback = { path: '/v2/task', query: { id: String(generated) } };
              record.verification = 'fields';
              record.fields = record.fields.map((field) => ({
                ...field,
                readable: !writeOnly(field.name, field.requested),
              }));
            }
          }
          if (response.asyncId) {
            record.state = 'uncertain';
            record.explanation =
              'IRIS accepted asynchronous work. Inspect the job before requesting another operation.';
          } else {
            try {
              await this.observe(actor, record, op);
            } catch {
              record.state = 'uncertain';
              record.explanation =
                'IRIS responded to the write, but current state could not be read. No write was retried.';
            }
          }
        } catch (error) {
          const status = error instanceof ApiError ? error.status : 500;
          record.state = status >= 400 && status < 500 && status !== 408 ? 'rejected' : 'uncertain';
          record.nativeStatus = status;
          record.explanation =
            record.state === 'rejected'
              ? 'IRIS rejected the request. No successful result is claimed.'
              : 'The result could not be confirmed. Read the current state before requesting another change.';
        }
        this.event(record, record.state, record.explanation);
        return await this.save(record);
      } finally {
        this.targets.delete(key);
      }
    });
  }
  private async observe(actor: Actor, record: ChangeRecord, op: Operation) {
    const reader = record.readback ?? this.reader(op);
    if (!reader || record.verification === 'response') {
      record.state = 'acknowledged';
      record.explanation =
        'IRIS acknowledged the request. This operation has no readable value comparison; inspect its metadata or execution history separately.';
      return;
    }
    let observed: any;
    try {
      observed = await this.read(actor, reader);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 404 &&
        (record.verification === 'absence' || record.path.endsWith('/terminate'))
      ) {
        record.state = 'verified';
        record.explanation = 'The selected target was not found during readback.';
        return;
      }
      throw error;
    }
    record.observation = redact(observed);
    if (record.verification === 'absence') {
      record.state = 'uncertain';
      record.explanation = 'The target still exists. The deletion is not verified.';
      return;
    }
    if (record.verification === 'process') {
      const same = this.processMatches(record.baseline, observed);
      const state = typeof observed.State === 'string' ? observed.State : '';
      const parsedState = parseProcessState(state);
      if (parsedState.suspended === undefined) {
        record.state = 'uncertain';
        record.explanation =
          'IRIS did not return a process execution state. The action is not verified.';
        return;
      }
      const matched = record.path.endsWith('/terminate')
        ? !same
        : same &&
          (record.path.endsWith('/suspend') ? parsedState.suspended : !parsedState.suspended);
      record.state = matched ? 'verified' : 'uncertain';
      record.explanation = matched
        ? 'The selected process generation has the requested observed state.'
        : 'The process identity or observed state does not confirm this action.';
      return;
    }
    if (record.verification === 'task-state') {
      const desired = record.path.endsWith('/suspend');
      record.state = observed.Suspended === desired ? 'verified' : 'uncertain';
      record.explanation =
        record.state === 'verified'
          ? 'The authoritative task state matches the request.'
          : 'The authoritative task state does not match the request.';
      return;
    }
    record.fields = record.fields.map((field) => ({
      ...field,
      observed: field.readable ? redactField(field.name, observed[field.name]) : undefined,
      matches: field.readable
        ? stableValue(field.requested) ===
          stableValue(redactField(field.name, observed[field.name]))
        : undefined,
    }));
    const readable = record.fields.filter((field) => field.readable);
    record.state =
      readable.length && readable.every((field) => field.matches) ? 'verified' : 'uncertain';
    record.explanation =
      record.state === 'verified'
        ? 'Submitted readable fields match the fresh native record. Write-only values are not compared.'
        : 'Readback differs from the requested fields. Inspect the observed values before making another change.';
  }
  async reconcile(actor: Actor, id: string, revision: number) {
    return this.store.exclusive(actor, 'changes', id, async () => {
      const record = await this.store.read<ChangeRecord>(actor, 'changes', id);
      if (record.revision !== revision || !['uncertain', 'sending'].includes(record.state))
        throw new ApiError(409, 'Only an unresolved current change can be reconciled.');
      if (record.asyncId) {
        const job = await this.client.request(actor.auth, {
          path: '/v2/async-result',
          method: 'GET',
          query: { id: record.asyncId },
        });
        record.result = redact(job.data);
        if (job.data.State !== 'Finished') {
          record.explanation =
            'Background job status: ' + String(job.data.State) + '. No write was retried.';
          this.event(record, 'job-inspected', record.explanation);
          return this.save(record);
        }
      }
      const op: Operation = { path: record.path, method: record.method, query: record.query };
      try {
        await this.observe(actor, record, op);
      } catch {
        record.state = 'uncertain';
        record.explanation = 'Current state could not be read. No write was retried.';
      }
      this.event(
        record,
        'reconciled',
        record.explanation + ' Current state does not prove which actor changed it.',
      );
      return this.save(record);
    });
  }
}
