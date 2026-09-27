import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import supertest from 'supertest';
import { WorkspaceStore } from '../server/workspace-store.js';
import { workspaceRoutes } from '../server/workspace-routes.js';
import { ApiError, type IrisClient, type Operation } from '../server/upstream.js';

const cases = [
  {
    name: 'OAuth resource server needs Secure, not OAuth client access',
    path: '/v2/security/oauth2/resource-server',
    probe: '/v2/security/users',
  },
  {
    name: 'OAuth client receipts retain the client-specific native guard',
    path: '/v2/security/oauth2/client/server-definition',
    probe: '/v2/security/oauth2/client/server-definitions',
  },
  {
    name: 'Wallet receipts require current native wallet access',
    path: '/v2/wallet/collection',
    probe: '/v2/wallet/collections',
  },
  {
    name: 'Device receipts require native management access',
    path: '/v2/device',
    probe: '/v2/devices',
  },
];

for (const scenario of cases)
  test(scenario.name, async () => {
    const root = await mkdtemp(join(tmpdir(), 'harbor-source-auth-'));
    const actor = { owner: 'alice', instance: 'one' };
    const record = await new WorkspaceStore(root).create(actor, 'changes', {
      version: 1 as const,
      ...actor,
      path: scenario.path,
      method: 'PUT',
      state: 'verified',
      title: 'Recorded native change',
      target: 'test-target',
      query: { name: 'test-target' },
      fields: [],
      events: [],
      explanation: 'Recorded result',
      verification: 'fields',
      expiresAt: '2026-09-27T00:00:00Z',
      observation: { Description: 'Stored operational evidence' },
    });
    let revoked = false;
    const probes: string[] = [];
    const client = {
      request: async (_auth: string, operation: Operation) => {
        assert.equal(operation.method, 'GET', 'Authorization must never issue a mutation');
        if (operation.path === '/info')
          return { data: { username: actor.owner, privileges: { Operate: { use: true } } } };
        probes.push(operation.path);
        if (revoked && operation.path === scenario.probe)
          throw new ApiError(403, 'Source privilege revoked');
        // Other families stay accessible. A wrong probe must not hide the regression.
        return { data: [] };
      },
    } as unknown as IrisClient;
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      res.locals.session = { info: { username: actor.owner }, auth: 'fixture-auth' };
      next();
    });
    workspaceRoutes(app, client, root, actor.instance);
    app.use((error: any, _req: any, res: any, _next: any) =>
      res.status(error instanceof ApiError ? error.status : 500).json({ error: error.message }),
    );
    const api = supertest(app);
    await api.get('/api/changes/' + record.id).expect(200);
    assert.deepEqual(probes, [scenario.probe]);
    revoked = true;
    await api.get('/api/changes/' + record.id).expect(403);
    await api
      .post('/api/changes/' + record.id + '/reconcile')
      .send({ revision: record.revision })
      .expect(403);
    const listing = await api.get('/api/changes').expect(200);
    assert.equal(
      listing.body.records.length,
      0,
      'Revoked source must not appear in receipt summaries',
    );
  });
