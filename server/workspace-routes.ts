import type express from 'express';
import { z } from 'zod';
import { ApiError, IrisClient, type Operation } from './upstream.js';
import { WorkspaceStore } from './workspace-store.js';
import { ChangeService } from './change-service.js';
import { InvestigationService } from './investigation-service.js';
import { caseInput, caseStatus, summarizeCase } from '../shared/investigation.js';
import { diagnosticSources, type DiagnosticId } from '../shared/diagnostics.js';
import type { ChangeRecord } from '../shared/change-record.js';
import type { Investigation } from '../shared/investigation.js';
import { parameters } from '../shared/schema.js';
import { ProfileService } from './profile-service.js';
import { profileInputSchema } from '../shared/investigation-profile.js';
import {
  evidenceReviewInput,
  evidenceDecisionInput,
  evidenceConclusionInput,
  evidenceReopenInput,
} from '../shared/evidence-review.js';

const revision = z.number().int().positive();
const operation = z
  .object({
    path: z.string().max(160),
    method: z.enum(['PUT', 'POST', 'DELETE']),
    query: z.record(z.string().max(80), z.string().max(2000)).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export function workspaceRoutes(
  app: express.Express,
  client: IrisClient,
  root: string,
  instance: string,
) {
  const store = new WorkspaceStore(root),
    changes = new ChangeService(store, client),
    investigations = new InvestigationService(store, client);
  const profiles = new ProfileService(store);
  const actor = (res: express.Response) => ({
    owner: String(res.locals.session.info.username),
    auth: String(res.locals.session.auth),
    instance,
  });
  const familyProbe = (path: string): string => {
    if (path.startsWith('/v2/wallet/')) return '/v2/wallet/collections';
    if (path.startsWith('/v2/security/oauth2/client/'))
      return '/v2/security/oauth2/client/server-definitions';
    if (path.startsWith('/v2/security/')) return '/v2/security/users';
    if (path.startsWith('/v2/web-app')) return '/v2/web-apps';
    if (path.startsWith('/v2/task')) return '/v2/tasks';
    if (path.startsWith('/v2/process')) return '/v2/processes';
    if (path.startsWith('/v2/device')) return '/v2/devices';
    return '/info';
  };
  const probe = async (res: express.Response, path: string) => {
    const cache = res.locals.sourceChecks as Map<string, Promise<void>>;
    if (!cache.has(path))
      cache.set(
        path,
        (async () => {
          const query: Record<string, string> =
            path === '/extension/logs'
              ? { source: 'messages', limit: '1' }
              : path === '/info' || path === '/extension/telemetry' || path.includes('/dashboard/')
                ? {}
                : parameters(path, 'get').some((parameter) => parameter.name === 'maxRows')
                  ? { maxRows: '1' }
                  : {};
          await client.request(actor(res).auth, { path, method: 'GET', query });
        })(),
      );
    await cache.get(path);
  };
  const changeAccess = async (res: express.Response, record: ChangeRecord) => {
    await probe(res, familyProbe(record.path));
  };
  const linkedChangeAccess = async (res: express.Response, id: string) => {
    // Read through the scoped store before checking current native access. A
    // missing or unreadable source must not turn copied metadata into public data.
    const record = await store.read<ChangeRecord>(actor(res), 'changes', id);
    await changeAccess(res, record);
  };
  const caseAccess = async (res: express.Response, record: Investigation) => {
    for (const id of record.linkedChanges) await linkedChangeAccess(res, id);
    for (const capture of record.captures)
      for (const source of capture.bundle.sections)
        if (source.status === 'collected') {
          const known = diagnosticSources.find((item) => item.id === source.id);
          if (!known || known.path !== source.path)
            throw new ApiError(500, 'Stored source identity is invalid.');
          await probe(res, source.path);
        }
  };
  app.use(
    ['/api/changes', '/api/investigations', '/api/investigation-profiles'],
    async (_req, res, next) => {
      const who = actor(res),
        current = await client.request(who.auth, { path: '/info', method: 'GET' });
      if (current.data.username !== who.owner || current.data.privileges?.Operate?.use !== true)
        throw new ApiError(
          403,
          'Current IRIS operating privileges are required to access stored operational records.',
        );
      res.locals.sourceChecks = new Map<string, Promise<void>>();
      next();
    },
  );
  app.use('/api/changes/:id', async (req, res, next) => {
    await linkedChangeAccess(res, String(req.params.id));
    next();
  });
  app.use('/api/investigations/:id', async (req, res, next) => {
    const record = await investigations.get(actor(res), String(req.params.id));
    await caseAccess(res, record);
    next();
  });
  app.get('/api/changes', async (_req, res) => {
    const list = await store.scan(actor(res), 'changes', async (record: ChangeRecord) => {
      try {
        await changeAccess(res, record);
        const { baseline, result, observation, fields, events, impact, ...summary } = record;
        return { ...summary, fieldCount: fields.length };
      } catch (error) {
        if (!(error instanceof ApiError && [401, 403].includes(error.status))) throw error;
      }
    });
    res.json(list);
  });
  app.post('/api/changes', async (req, res) => {
    const input = z
      .object({ operation, expected: z.record(z.string(), z.unknown()).optional() })
      .strict()
      .parse(req.body);
    await probe(res, familyProbe(input.operation.path));
    res
      .status(201)
      .json(await changes.prepare(actor(res), input.operation as Operation, input.expected));
  });
  app.get('/api/changes/:id', async (req, res) =>
    res.json(await changes.get(actor(res), String(req.params.id))),
  );
  app.post('/api/changes/:id/execute', async (req, res) => {
    const input = z
      .object({ revision, confirmation: z.string().max(512) })
      .strict()
      .parse(req.body);
    res.json(
      await changes.execute(actor(res), String(req.params.id), input.revision, input.confirmation),
    );
  });
  app.post('/api/changes/:id/reconcile', async (req, res) => {
    const input = z.object({ revision }).strict().parse(req.body);
    res.json(await changes.reconcile(actor(res), String(req.params.id), input.revision));
  });
  app.post('/api/changes/:id/cancel', async (req, res) => {
    const input = z.object({ revision }).strict().parse(req.body);
    res.json(await changes.cancel(actor(res), String(req.params.id), input.revision));
  });
  app.get('/api/investigations', async (_req, res) => {
    const listing = await store.scan(
      actor(res),
      'investigations',
      async (record: Investigation) => {
        try {
          await caseAccess(res, record);
          return summarizeCase(record);
        } catch (error) {
          if (!(error instanceof ApiError && [401, 403].includes(error.status))) throw error;
        }
      },
    );
    res.json(listing);
  });
  app.post('/api/investigations', async (req, res) =>
    res.status(201).json(await investigations.create(actor(res), req.body)),
  );
  app.get('/api/investigations/:id', async (req, res) =>
    res.json(await investigations.get(actor(res), String(req.params.id))),
  );
  app.post('/api/investigations/:id/notes', async (req, res) => {
    const input = z
      .object({ revision, text: z.string().trim().min(1).max(4000) })
      .strict()
      .parse(req.body);
    res.json(
      await investigations.note(actor(res), String(req.params.id), input.revision, input.text),
    );
  });
  app.post('/api/investigations/:id/status', async (req, res) => {
    const input = z
      .object({ revision, status: z.enum(caseStatus), reason: z.string().trim().min(1).max(4000) })
      .strict()
      .parse(req.body);
    res.json(
      await investigations.status(
        actor(res),
        String(req.params.id),
        input.revision,
        input.status,
        input.reason,
      ),
    );
  });
  app.post('/api/investigations/:id/captures', async (req, res) => {
    const input = z
      .object({
        revision,
        title: z.string().trim().min(1).max(120),
        sources: z
          .array(z.string().refine((id) => diagnosticSources.some((s) => s.id === id)))
          .min(1)
          .max(8),
      })
      .strict()
      .parse(req.body);
    res.json(
      await investigations.capture(
        actor(res),
        String(req.params.id),
        input.revision,
        input.sources as DiagnosticId[],
        input.title,
      ),
    );
  });
  app.post('/api/investigations/:id/changes', async (req, res) => {
    const input = z
      .object({ revision, changeId: z.string().uuid(), note: z.string().max(4000).default('') })
      .strict()
      .parse(req.body);
    await linkedChangeAccess(res, input.changeId);
    res.json(
      await investigations.link(
        actor(res),
        String(req.params.id),
        input.revision,
        input.changeId,
        input.note,
      ),
    );
  });
  app.post('/api/investigations/:id/checklist', async (req, res) => {
    const input = z
      .object({
        revision,
        itemId: z.string().uuid(),
        state: z.enum(['open', 'completed', 'not applicable']),
        note: z.string().trim().min(1).max(2000),
      })
      .strict()
      .parse(req.body);
    res.json(
      await investigations.checklist(
        actor(res),
        String(req.params.id),
        input.revision,
        input.itemId,
        input.state,
        input.note,
      ),
    );
  });
  app.post('/api/investigations/:id/evidence-reviews', async (req, res) => {
    const input = evidenceReviewInput.parse(req.body);
    res.json(
      await investigations.startReview(
        actor(res),
        String(req.params.id),
        input.revision,
        input.title,
        input.beforeId,
        input.afterId,
      ),
    );
  });
  app.post('/api/investigations/:id/evidence-reviews/:reviewId/decisions', async (req, res) => {
    const input = evidenceDecisionInput.parse(req.body);
    res.json(
      await investigations.decideEvidence(
        actor(res),
        String(req.params.id),
        input.revision,
        String(req.params.reviewId),
        input.differenceId,
        input.disposition,
        input.note,
      ),
    );
  });
  app.post('/api/investigations/:id/evidence-reviews/:reviewId/conclusion', async (req, res) => {
    const input = evidenceConclusionInput.parse(req.body);
    res.json(
      await investigations.concludeReview(
        actor(res),
        String(req.params.id),
        input.revision,
        String(req.params.reviewId),
        input.text,
      ),
    );
  });
  app.post('/api/investigations/:id/evidence-reviews/:reviewId/reopen', async (req, res) => {
    const input = evidenceReopenInput.parse(req.body);
    res.json(
      await investigations.reopenReview(
        actor(res),
        String(req.params.id),
        input.revision,
        String(req.params.reviewId),
        input.reason,
      ),
    );
  });
  app.get('/api/investigation-profiles', async (_req, res) =>
    res.json(await profiles.list(actor(res))),
  );
  app.post('/api/investigation-profiles', async (req, res) =>
    res.status(201).json(await profiles.create(actor(res), req.body)),
  );
  app.get('/api/investigation-profiles/:id', async (req, res) =>
    res.json(await profiles.get(actor(res), String(req.params.id))),
  );
  app.post('/api/investigation-profiles/:id/revise', async (req, res) => {
    const input = z
      .object({
        revision,
        definition: profileInputSchema,
        reason: z.string().trim().min(1).max(2000),
      })
      .strict()
      .parse(req.body);
    res.json(
      await profiles.update(
        actor(res),
        String(req.params.id),
        input.revision,
        input.definition,
        input.reason,
      ),
    );
  });
  app.post('/api/investigation-profiles/:id/status', async (req, res) => {
    const input = z.object({ revision, archived: z.boolean() }).strict().parse(req.body);
    res.json(
      await profiles.archive(actor(res), String(req.params.id), input.revision, input.archived),
    );
  });
  app.post('/api/investigation-profiles/:id/start', async (req, res) => {
    const input = z.object({ revision, investigation: caseInput }).strict().parse(req.body);
    const profile = await profiles.get(actor(res), String(req.params.id));
    if (profile.revision !== input.revision)
      throw new ApiError(409, 'The profile changed. Refresh and review the current instructions.');
    if (profile.status !== 'active')
      throw new ApiError(409, 'Restore the profile before starting an investigation.');
    res.status(201).json(await investigations.create(actor(res), input.investigation, profile));
  });
  return { store, changes, investigations };
}
