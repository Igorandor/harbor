import type { ChangeImpact } from './change-impact.js';
import { z } from 'zod';

const storedTimestamp = z.iso.datetime();
const storedReader = z
  .object({ path: z.string().min(1), query: z.record(z.string(), z.string()) })
  .passthrough();
const storedChange = z
  .object({
    expiresAt: storedTimestamp,
    title: z.string(),
    target: z.string(),
    path: z.string().min(1),
    method: z.enum(['PUT', 'POST', 'DELETE']),
    query: z.record(z.string(), z.string()),
    state: z.enum([
      'prepared',
      'expired',
      'canceled',
      'sending',
      'verified',
      'acknowledged',
      'conflict',
      'rejected',
      'uncertain',
    ]),
    fields: z.array(
      z
        .object({
          name: z.string(),
          before: z.unknown().optional(),
          requested: z.unknown().optional(),
          observed: z.unknown().optional(),
          readable: z.boolean(),
          matches: z.boolean().optional(),
        })
        .passthrough(),
    ),
    evidenceOmissions: z
      .array(
        z
          .object({
            source: z.enum(['result', 'observation', 'field observations']),
            bytes: z.number().int().nonnegative(),
            at: storedTimestamp,
            previousRetained: z.boolean(),
          })
          .passthrough(),
      )
      .optional(),
    nativeStatus: z.number().int().optional(),
    asyncId: z.string().optional(),
    readback: storedReader.optional(),
    impact: z
      .object({
        level: z.enum(['low', 'moderate', 'high']),
        summary: z.string(),
        consequences: z.array(z.string()),
        related: z.array(
          z
            .object({
              kind: z.enum(['user', 'role', 'application', 'task', 'process', 'resource']),
              name: z.string(),
              relationship: z.string(),
            })
            .passthrough(),
        ),
        sources: z.array(
          z
            .object({
              path: z.string(),
              status: z.enum(['read', 'unavailable', 'limited']),
              count: z.number().int().nonnegative(),
              notice: z.string().optional(),
            })
            .passthrough(),
        ),
        incomplete: z.boolean(),
        assessedAt: storedTimestamp,
      })
      .passthrough()
      .optional(),
    explanation: z.string(),
    events: z.array(
      z.object({ at: storedTimestamp, action: z.string(), message: z.string() }).passthrough(),
    ),
    verification: z.enum(['fields', 'absence', 'process', 'task-state', 'metadata', 'response']),
  })
  .passthrough();

/** Read-boundary predicate only; preserve original evidence, metadata and historical lengths. */
export function validStoredChange(value: unknown): boolean {
  return storedChange.safeParse(value).success;
}

export type ChangeState =
  | 'prepared'
  | 'expired'
  | 'canceled'
  | 'sending'
  | 'verified'
  | 'acknowledged'
  | 'conflict'
  | 'rejected'
  | 'uncertain';
export type ChangeField = {
  name: string;
  before?: unknown;
  requested?: unknown;
  observed?: unknown;
  readable: boolean;
  matches?: boolean;
};
export type ChangeEvent = { at: string; action: string; message: string };
export type ChangeEvidenceSource = 'result' | 'observation' | 'field observations';
export type ChangeEvidenceOmission = {
  source: ChangeEvidenceSource;
  bytes: number;
  at: string;
  previousRetained: boolean;
};
export type ChangeRecord = {
  version: 1;
  id: string;
  owner: string;
  instance: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  title: string;
  target: string;
  path: string;
  method: 'PUT' | 'POST' | 'DELETE';
  query: Record<string, string>;
  state: ChangeState;
  fields: ChangeField[];
  baseline?: unknown;
  result?: unknown;
  observation?: unknown;
  evidenceOmissions?: ChangeEvidenceOmission[];
  nativeStatus?: number;
  asyncId?: string;
  readback?: { path: string; query: Record<string, string> };
  impact?: ChangeImpact;
  explanation: string;
  events: ChangeEvent[];
  verification: 'fields' | 'absence' | 'process' | 'task-state' | 'metadata' | 'response';
};
export const changeLabels: Record<ChangeState, string> = {
  prepared: 'Ready for review',
  expired: 'Review expired',
  canceled: 'Canceled',
  sending: 'Request sent',
  verified: 'Result verified',
  acknowledged: 'Request acknowledged',
  conflict: 'State changed',
  rejected: 'Request rejected',
  uncertain: 'Result unresolved',
};
export function changeNeedsAttention(record: ChangeRecord) {
  return record.state === 'uncertain' || record.state === 'sending' || record.state === 'conflict';
}
export function stableValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableValue).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + stableValue(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
