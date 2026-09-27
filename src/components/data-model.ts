export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { Value: value };
}
export function ownField(value: unknown, key: string): unknown {
  const row = record(value);
  return Object.hasOwn(row, key) ? row[key] : undefined;
}
export function scalar(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not reported';
  return typeof value === 'object'
    ? Array.isArray(value)
      ? `${value.length} entries`
      : `${Object.keys(value).length} fields`
    : String(value);
}
export function capacity(total: unknown, available: unknown) {
  if (
    typeof total !== 'number' ||
    typeof available !== 'number' ||
    !Number.isFinite(total) ||
    !Number.isFinite(available) ||
    total <= 0 ||
    available < 0 ||
    available > total
  )
    return undefined;
  return {
    total,
    available,
    used: total - available,
    percent: (100 * (total - available)) / total,
  };
}
export function formatBytes(value: number, unit = 'GiB') {
  return `${(value / 1024 ** (unit === 'MiB' ? 2 : 3)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
}
export function columnsFor(rows: unknown[]) {
  return [...new Set(rows.slice(0, 100).flatMap((row) => Object.keys(record(row))))].slice(0, 6);
}
export function filterRows(rows: unknown[], query: string, sort: string, descending: boolean) {
  const needle = query.toLowerCase();
  const list = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !needle || JSON.stringify(row)?.toLowerCase().includes(needle));
  if (sort)
    list.sort((a, b) => {
      const x = ownField(a.row, sort),
        y = ownField(b.row, sort);
      return (
        (typeof x === 'number' && typeof y === 'number'
          ? x - y
          : scalar(x).localeCompare(scalar(y), undefined, { numeric: true })) *
        (descending ? -1 : 1)
      );
    });
  return list;
}
