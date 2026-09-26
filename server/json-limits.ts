/** Iterative budget check before recursive redaction or serialization. */
export function boundedJson(value: unknown, maxDepth: number, maxNodes: number): boolean {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++visited > maxNodes || item.depth > maxDepth) return false;
    if (item.value && typeof item.value === 'object') {
      const children = Object.values(item.value);
      if (visited + pending.length + children.length > maxNodes) return false;
      for (const value of children) pending.push({ value, depth: item.depth + 1 });
    }
  }
  return true;
}
