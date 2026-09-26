export const diagnosticSources = [
  { id: 'identity', title: 'Instance identity', path: '/info' },
  { id: 'health', title: 'System health', path: '/v2/monitor/dashboard/main' },
  { id: 'capacity', title: 'Host capacity', path: '/extension/telemetry' },
  { id: 'processes', title: 'Running processes', path: '/v2/processes' },
  { id: 'tasks', title: 'Task definitions', path: '/v2/tasks' },
  { id: 'history', title: 'Recent task history', path: '/v2/task/history' },
  { id: 'journals', title: 'Journal files', path: '/v2/journal/files' },
  { id: 'messages', title: 'Recent system messages', path: '/extension/logs' },
] as const;
export type DiagnosticId = (typeof diagnosticSources)[number]['id'];
export type DiagnosticSection = {
  id: DiagnosticId;
  title: string;
  path: string;
  observedAt: string;
  elapsedMs: number;
  status: 'collected' | 'unavailable' | 'too large' | 'pending';
  httpStatus: number;
  data?: unknown;
  notice?: string;
};
export type DiagnosticBundle = {
  version: 1;
  instance: string;
  startedAt: string;
  finishedAt: string;
  sections: DiagnosticSection[];
  limits: string[];
};
