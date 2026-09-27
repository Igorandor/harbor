import type express from 'express';
import { z } from 'zod';
import { ApiError, IrisClient } from './upstream.js';
import { parameters } from '../shared/schema.js';
import type {
  RuntimePart,
  RuntimeSample,
  RuntimeSource,
  ProcessObservation,
} from '../shared/runtime-analysis.js';
const sources: Record<RuntimeSource, string> = {
  identity: '/info',
  host: '/extension/telemetry',
  health: '/v2/monitor/dashboard/main',
  processes: '/v2/processes',
  locks: '/v2/locks',
  usage: '/v2/monitor/system-usage',
  license: '/v2/monitor/license-usage',
};
const inputSchema = z
  .object({
    sources: z
      .array(z.enum(['identity', 'host', 'health', 'processes', 'locks', 'usage', 'license']))
      .min(1)
      .max(7),
    pids: z.array(z.number().int().positive()).max(12).default([]),
  })
  .strict();
export async function captureRuntime(
  client: IrisClient,
  auth: string,
  instance: string,
  input: unknown,
): Promise<RuntimeSample> {
  const parsed = inputSchema.parse(input);
  if (
    new Set(parsed.sources).size !== parsed.sources.length ||
    new Set(parsed.pids).size !== parsed.pids.length
  )
    throw new ApiError(400, 'Select each source and process only once.');
  const sample: RuntimeSample = {
    version: 1,
    instance,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    sources: [],
    processDetails: [],
  };
  for (let offset = 0; offset < parsed.sources.length; offset += 3) {
    const group = await Promise.all(
      parsed.sources.slice(offset, offset + 3).map(async (source) => {
        const started = Date.now(),
          path = sources[source];
        const part: RuntimePart = {
          source,
          path,
          status: 'available',
          capturedAt: '',
          elapsedMs: 0,
        };
        try {
          const query: Record<string, string> = parameters(path, 'get').some(
            (parameter) => parameter.name === 'maxRows',
          )
            ? { maxRows: '201' }
            : {};
          const response = await client.request(auth, { path, method: 'GET', query });
          const serialized = JSON.stringify(response.data);
          if (Buffer.byteLength(serialized, 'utf8') > 250000) {
            part.status = 'limited';
            part.notice = 'This source exceeded the 250 KB sample limit.';
          } else if (Array.isArray(response.data) && response.data.length > 200) {
            part.status = 'limited';
            part.notice = 'Only the first 200 returned records are included.';
            part.data = response.data.slice(0, 200);
          } else part.data = response.data;
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) throw error;
          part.status = 'unavailable';
          part.notice =
            error instanceof ApiError && error.status === 403
              ? 'Current account cannot read this source.'
              : 'The native source could not be collected.';
        }
        part.elapsedMs = Date.now() - started;
        part.capturedAt = new Date().toISOString();
        return part;
      }),
    );
    sample.sources.push(...group);
  }
  for (let offset = 0; offset < parsed.pids.length; offset += 3) {
    const group = await Promise.all(
      parsed.pids.slice(offset, offset + 3).map(async (pid) => {
        const part: ProcessObservation = {
          pid,
          status: 'available',
          capturedAt: new Date().toISOString(),
        };
        try {
          const response = await client.request(auth, {
            path: '/v2/process',
            method: 'GET',
            query: { id: String(pid) },
          });
          if (
            response.data?.Pid !== pid ||
            !response.data ||
            typeof response.data !== 'object' ||
            Array.isArray(response.data)
          )
            throw new ApiError(502, 'Invalid native process identity.');
          if (Buffer.byteLength(JSON.stringify(response.data), 'utf8') > 100000)
            throw new ApiError(413, 'Process detail exceeds the 100 KB sample limit.');
          const { Variables, CSPSessionID, ...safe } = response.data;
          part.data = safe;
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) throw error;
          part.status = 'unavailable';
          part.notice =
            error instanceof ApiError && error.status === 404
              ? 'Process was not found at capture time.'
              : 'Process details could not be collected.';
        }
        part.capturedAt = new Date().toISOString();
        return part;
      }),
    );
    sample.processDetails.push(...group);
  }
  sample.finishedAt = new Date().toISOString();
  return sample;
}
export function runtimeObservationRoutes(
  app: express.Express,
  client: IrisClient,
  instance: string,
) {
  const active = new Set<string>();
  app.post('/api/runtime-samples', async (req, res) => {
    const session = res.locals.session,
      key = String(session.info.username);
    if (active.has(key))
      throw new ApiError(409, 'A runtime capture is already in progress for this account.');
    active.add(key);
    try {
      res.json(await captureRuntime(client, session.auth, instance, req.body));
    } finally {
      active.delete(key);
    }
  });
}
