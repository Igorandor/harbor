import type express from 'express';
import { z } from 'zod';
import { ApiError, IrisClient } from './upstream.js';
import {
  configurationText,
  type ApplicationObservation,
  type ApplicationSource,
  type ConfigurationRecord,
} from '../shared/application-analysis.js';

function object(value: unknown): value is ConfigurationRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function omitted<T>(notice: string): ApplicationSource<T> {
  return { status: 'not applicable', observedAt: new Date().toISOString(), notice };
}
export async function observeApplication(
  client: IrisClient,
  auth: string,
  name: string,
): Promise<ApplicationObservation> {
  if (!name.startsWith('/') || name.length > 256 || /[\x00-\x1f]/.test(name))
    throw new ApiError(400, 'Choose a valid application name.');
  const startedAt = new Date().toISOString();
  async function read<T>(
    path: string,
    query: Record<string, string>,
    shape: (data: unknown) => data is T,
  ): Promise<ApplicationSource<T>> {
    try {
      const result = await client.request(auth, { path, query, method: 'GET' });
      if (result.asyncId)
        throw new ApiError(
          502,
          'This source is still processing; no completed observation is available.',
        );
      if (!shape(result.data))
        throw new ApiError(502, 'The related source returned an unexpected data shape.');
      if (Buffer.byteLength(JSON.stringify(result.data), 'utf8') > 500000)
        throw new ApiError(502, 'This source exceeds the 500 KB inspection limit.');
      return {
        status: 'available',
        observedAt: new Date().toISOString(),
        data: result.data,
        httpStatus: result.status,
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      return {
        status: 'unavailable',
        observedAt: new Date().toISOString(),
        httpStatus: error instanceof ApiError ? error.status : 500,
        notice: error instanceof ApiError ? error.message : 'The related source could not be read.',
      };
    }
  }
  const application = await read('/v2/web-app', { name }, object);
  let namespace = omitted<ConfigurationRecord>('No namespace was returned for the application.');
  let resource = omitted<ConfigurationRecord>('No entry resource is configured.');
  let routes = omitted<ConfigurationRecord[]>(
    'Application configuration must be available before reading related routes.',
  );
  const databases: ApplicationObservation['databases'] = [];
  if (application.data) {
    const namespaceName = configurationText(application.data.NameSpace);
    const resourceName = configurationText(application.data.Resource);
    [namespace, resource] = await Promise.all([
      namespaceName
        ? read('/v2/namespace', { name: namespaceName }, object)
        : Promise.resolve(namespace),
      resourceName
        ? read('/v2/security/resource', { name: resourceName }, object)
        : Promise.resolve(resource),
    ]);
    routes = await read(
      '/v2/web-apps',
      {},
      (data): data is ConfigurationRecord[] =>
        Array.isArray(data) && data.length <= 2000 && data.every(object),
    );
    const databaseNames = new Map<string, string[]>();
    for (const field of ['Globals', 'Routines']) {
      const database = configurationText(namespace.data?.[field]);
      if (database && database.length <= 128)
        databaseNames.set(database, [...(databaseNames.get(database) ?? []), field]);
    }
    for (const [database, uses] of databaseNames)
      databases.push({
        name: database,
        uses,
        source: await read('/v2/database', { name: database }, object),
      });
  }
  return {
    name,
    startedAt,
    finishedAt: new Date().toISOString(),
    application,
    namespace,
    resource,
    routes,
    databases,
  };
}
export function applicationObservationRoutes(app: express.Express, client: IrisClient) {
  const busy = new Set<string>();
  app.get('/api/application-center', async (req, res) => {
    const input = z
      .object({ name: z.string().min(1).max(256) })
      .strict()
      .parse(req.query);
    const auth = String(res.locals.session.auth);
    if (busy.has(auth) || busy.size >= 4)
      throw new ApiError(
        429,
        'An application inspection is already running. Wait for it to finish.',
      );
    busy.add(auth);
    try {
      res.json(await observeApplication(client, auth, input.name));
    } finally {
      busy.delete(auth);
    }
  });
}
