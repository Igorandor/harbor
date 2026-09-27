import type express from 'express';
import { z } from 'zod';
import { IrisClient } from './upstream.js';
import { LogService } from './log-service.js';
export function logRoutes(app: express.Express, client: IrisClient) {
  const logs = new LogService(client);
  app.get('/api/log-files', async (_req, res) =>
    res.json(await logs.catalog(res.locals.session.auth)),
  );
  app.post('/api/log-page', async (req, res) => {
    const input = z
      .object({
        file: z.string().max(80).optional(),
        cursor: z.string().max(2048).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await logs.page(res.locals.session.auth, String(res.locals.session.info.username), input),
    );
  });
}
