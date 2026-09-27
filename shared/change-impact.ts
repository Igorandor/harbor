export type ImpactLevel = 'low' | 'moderate' | 'high';
export type ImpactItem = {
  kind: 'user' | 'role' | 'application' | 'task' | 'process' | 'resource';
  name: string;
  relationship: string;
};
export type ImpactSource = {
  path: string;
  status: 'read' | 'unavailable' | 'limited';
  count: number;
  notice?: string;
};
export type ChangeImpact = {
  level: ImpactLevel;
  summary: string;
  consequences: string[];
  related: ImpactItem[];
  sources: ImpactSource[];
  incomplete: boolean;
  assessedAt: string;
};
export function impactTitle(level: ImpactLevel) {
  return level === 'high'
    ? 'High-impact change'
    : level === 'moderate'
      ? 'Configuration change'
      : 'Metadata change';
}
export function roleNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
export function resourceNames(value: unknown): string[] {
  if (typeof value === 'string')
    return value
      .split(',')
      .map((item) => item.trim().split(':')[0])
      .filter(Boolean);
  if (Array.isArray(value))
    return value.flatMap((item) =>
      typeof item === 'string'
        ? [item.split(':')[0]]
        : item && typeof item.Name === 'string'
          ? [item.Name]
          : [],
    );
  return [];
}
export function summarizeRelated(items: ImpactItem[]) {
  const groups: Record<string, number> = {};
  for (const item of items) groups[item.kind] = (groups[item.kind] ?? 0) + 1;
  return Object.entries(groups)
    .map(([kind, count]) => `${count} ${kind}${count === 1 ? '' : 's'}`)
    .join(', ');
}
