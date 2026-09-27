import type express from 'express';
import { z } from 'zod';
import { ApiError, IrisClient } from './upstream.js';
import type { TaskObservation, TaskRead, TaskRecord } from '../shared/task-analysis.js';

const isRecord = (value: unknown): value is TaskRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export async function observeTask(
  client: IrisClient,
  auth: string,
  taskId: string,
  limit: number,
): Promise<TaskObservation> {
  if (!/^[1-9]\d{0,9}$/.test(taskId) || !Number.isSafeInteger(Number(taskId)))
    throw new ApiError(400, 'Choose a valid task identifier.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new ApiError(400, 'History limit must be between 1 and 500.');
  const startedAt = new Date().toISOString();
  async function read<T>(
    path: string,
    query: Record<string, string>,
    check: (value: unknown) => value is T,
  ): Promise<TaskRead<T>> {
    try {
      const result = await client.request(auth, { path, query, method: 'GET' });
      const observedAt = new Date().toISOString();
      if (result.asyncId)
        return {
          status: 'pending',
          observedAt,
          httpStatus: result.status,
          message:
            'IRIS has not finished this read. Refresh later; no completed result is available.',
        };
      if (!check(result.data))
        throw new ApiError(502, 'The task source returned an unexpected result shape.');
      if (Buffer.byteLength(JSON.stringify(result.data), 'utf8') > 500000)
        throw new ApiError(502, 'The task source exceeded the 500 KB report limit.');
      return { status: 'available', observedAt, httpStatus: result.status, data: result.data };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      return {
        status: 'unavailable',
        observedAt: new Date().toISOString(),
        httpStatus: error instanceof ApiError ? error.status : 500,
        message: error instanceof ApiError ? error.message : 'This task source could not be read.',
      };
    }
  }
  const [configuration, state] = await Promise.all([
    read('/v2/task', { id: taskId }, isRecord),
    read('/v2/task/info', { id: taskId }, isRecord),
  ]);
  const history = await read(
    '/v2/task/history',
    { taskId, maxRows: String(limit) },
    (value): value is TaskRecord[] =>
      Array.isArray(value) && value.length <= limit && value.every(isRecord),
  );
  if (history.data?.some((row) => String(row.TaskId) !== taskId)) {
    history.data = undefined;
    history.status = 'unavailable';
    history.httpStatus = 502;
    history.message = 'IRIS returned history for a different task; the sample was discarded.';
  }
  return {
    taskId,
    startedAt,
    finishedAt: new Date().toISOString(),
    configuration,
    state,
    history,
    historyLimit: limit,
    historyMayBeLimited: history.data?.length === limit,
  };
}
export function taskObservationRoutes(app: express.Express, client: IrisClient) {
  const busy = new Set<string>();
  app.get('/api/task-center/:id', async (req, res) => {
    const session = res.locals.session;
    const taskId = z
      .string()
      .regex(/^[1-9]\d{0,9}$/)
      .parse(req.params.id);
    const query = z
      .object({
        limit: z
          .string()
          .regex(/^\d{1,3}$/)
          .optional(),
      })
      .strict()
      .parse(req.query);
    const limit = Number(query.limit ?? 100);
    if (busy.size >= 4 || busy.has(session.auth))
      throw new ApiError(429, 'A task observation is already running. Wait for it to finish.');
    busy.add(session.auth);
    try {
      res.json(await observeTask(client, session.auth, taskId, limit));
    } finally {
      busy.delete(session.auth);
    }
  });
}
