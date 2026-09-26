import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ApiError, IrisClient, type Operation } from './upstream.js';
import { parameters } from '../shared/schema.js';
type Session = {
  auth: string;
  csrf: string;
  created: number;
  seen: number;
  info: any;
  activity: any[];
};
export type AppOptions = {
  irisUrl: string;
  origin?: string;
  secure?: boolean;
  client?: IrisClient;
  now?: () => number;
};
export function createApp(options: AppOptions) {
  const app = express(),
    sessions = new Map<string, Session>(),
    attempts = new Map<string, { count: number; since: number }>();
  const client = options.client ?? new IrisClient(options.irisUrl),
    now = options.now ?? Date.now;
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"] },
      },
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.headers.origin;
      const allowed = options.origin ?? `http://${req.headers.host}`;
      if ((origin && origin !== allowed) || req.headers['sec-fetch-site'] === 'cross-site')
        return next(new ApiError(403, 'Request origin is not allowed.'));
      if (!req.is('application/json'))
        return next(new ApiError(415, 'JSON requests are required.'));
    }
    next();
  });
  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, app: 'Harbor', target: new URL(options.irisUrl).host }),
  );
  app.post('/api/login', async (req, res) => {
    const parsed = z
      .object({
        username: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[^:\r\n]+$/),
        password: z.string().min(1).max(1024),
      })
      .parse(req.body);
    const key = req.ip ?? 'local',
      time = now();
    for (const [k, a] of attempts) if (time - a.since > 60000) attempts.delete(k);
    const attempt = attempts.get(key) ?? { count: 0, since: time };
    if (attempt.count >= 10) throw new ApiError(429, 'Too many sign-in attempts. Wait one minute.');
    attempt.count++;
    attempts.set(key, attempt);
    const auth = 'Basic ' + Buffer.from(`${parsed.username}:${parsed.password}`).toString('base64');
    const result = await client.request(auth, { path: '/info', method: 'GET' });
    if (Number(result.data.apiVersion) < 2)
      throw new ApiError(
        409,
        'This portal requires the SysAdmin v2 API. Use IRIS Community 2026.2 or newer with v2 enabled.',
      );
    for (const [k, s] of sessions)
      if (time - s.seen > 30 * 60000 || time - s.created > 8 * 3600000) sessions.delete(k);
    if (sessions.size >= 100) throw new ApiError(503, 'Session capacity reached. Try again later.');
    if (req.cookies.harbor_session) sessions.delete(req.cookies.harbor_session);
    const id = randomBytes(32).toString('hex'),
      csrf = randomBytes(32).toString('hex');
    sessions.set(id, { auth, csrf, created: time, seen: time, info: result.data, activity: [] });
    attempts.delete(key);
    res.cookie('harbor_session', id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: options.secure ?? false,
      path: '/',
      maxAge: 8 * 3600000,
    });
    res.json({ info: result.data, csrf });
  });
  app.use('/api', (req, res, next) => {
    const session = sessions.get(req.cookies.harbor_session);
    if (!session || now() - session.seen > 30 * 60000 || now() - session.created > 8 * 3600000) {
      sessions.delete(req.cookies.harbor_session);
      return next(new ApiError(401, 'Your session has ended. Sign in to continue.'));
    }
    if (req.method !== 'GET') {
      const token = String(req.headers['x-csrf-token'] ?? '');
      const tokenBytes = Buffer.from(token);
      const expectedBytes = Buffer.from(session.csrf);
      if (tokenBytes.length !== expectedBytes.length || !timingSafeEqual(tokenBytes, expectedBytes))
        return next(new ApiError(403, 'Invalid request token. Refresh the page.'));
    }
    session.seen = now();
    res.locals.session = session;
    next();
  });
  app.get('/api/session', (_req, res) =>
    res.json({ info: res.locals.session.info, csrf: res.locals.session.csrf }),
  );
  app.post('/api/logout', (req, res) => {
    sessions.delete(req.cookies.harbor_session);
    res.clearCookie('harbor_session', { path: '/' });
    res.json({ ok: true });
  });
  app.get('/api/activity', (_req, res) => res.json(res.locals.session.activity));
  app.post('/api/iris', async (req, res) => {
    const op = z
      .object({
        path: z.string().max(160),
        method: z.enum(['GET', 'PUT', 'POST', 'DELETE']),
        query: z.record(z.string().max(80), z.string().max(2000)).optional(),
        body: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .parse(req.body) as Operation;
    if (
      (op.method === 'GET' || op.path === '/v2/security/audit/records') &&
      parameters(op.path, op.method.toLowerCase()).some((p) => p.name === 'maxRows') &&
      !op.query?.maxRows
    )
      op.query = { ...op.query, maxRows: '250' };
    const session: Session = res.locals.session,
      start = now();
    try {
      const result = await client.request(session.auth, op);
      if (op.method !== 'GET' || result.console?.length) {
        session.activity.unshift({
          at: new Date(now()).toISOString(),
          method: op.method,
          path: op.path,
          target: op.query?.name ?? op.query?.id ?? op.query?.alias ?? '',
          status: result.status,
          elapsed: now() - start,
          console: result.console,
        });
        session.activity.splice(100);
      }
      res.json(result);
    } catch (error) {
      session.activity.unshift({
        at: new Date(now()).toISOString(),
        method: op.method,
        path: op.path,
        status: error instanceof ApiError ? error.status : 500,
        elapsed: now() - start,
      });
      session.activity.splice(100);
      throw error;
    }
  });
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'Unknown portal endpoint.')));
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: 'Invalid request.',
        details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    res
      .status(err instanceof ApiError ? err.status : err.type === 'entity.too.large' ? 413 : 500)
      .json({
        error: err instanceof ApiError ? err.message : 'The request could not be processed.',
      });
  });
  return app;
}
