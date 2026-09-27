import type { ChangeImpact } from './change-impact.js';
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
