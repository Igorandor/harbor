export type LogFile = {
  id: string;
  source: 'messages' | 'alerts';
  bytes: number;
  modifiedAt: number;
  active: boolean;
};
export type LogCatalog = { files: LogFile[]; limited: boolean; notice: string };
export type LogLine = { offset: number; text: string; clipped: boolean };
export type LogWindow = {
  file: string;
  identity: string;
  snapshotBytes: number;
  currentBytes: number;
  start: number;
  end: number;
  scannedBytes: number;
  lines: LogLine[];
  olderOffset: number | null;
  notice: string;
  olderCursor?: string;
  observedAt: string;
};
export type LogLevel = 'error' | 'warning' | 'information';
export function logLevel(text: string): LogLevel {
  if (/\b(error|fatal|severe|failed|failure|panic)\b/i.test(text)) return 'error';
  if (/\b(warning|warn|retry|timeout)\b/i.test(text)) return 'warning';
  return 'information';
}
export function filterLogLines(lines: LogLine[], query: string, level: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10);
  return lines.filter(
    (line) =>
      (level === 'all' || logLevel(line.text) === level) &&
      terms.every((term) => line.text.toLowerCase().includes(term)),
  );
}
