const MAX_BYTES = 16 * 1024;
const MAX_LINES = 100;
const NOTICE = '[Console preview truncated; inspect the original response for full output.]';
const bytes = (value: string) => Buffer.byteLength(JSON.stringify(value), 'utf8');
// Detach the retained text: a JS substring can otherwise keep a large source string alive.
const copy = (value: string) => Buffer.from(value, 'utf8').toString('utf8');

/** Bound retained session data independently of the much larger native response limit. */
export function consolePreview(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const preview: string[] = [];
  // Reserve JSON brackets, a comma, and the truncation notice before copying any output.
  let remaining = MAX_BYTES - 3 - bytes(NOTICE);
  let truncated = value.length > MAX_LINES;
  for (const item of value.slice(0, MAX_LINES)) {
    const text = typeof item === 'string' ? item : (JSON.stringify(item) ?? '');
    const allowance = remaining - (preview.length ? 1 : 0);
    const size = text.length > allowance ? allowance + 1 : bytes(text);
    if (size <= allowance) {
      remaining = allowance - size;
      preview.push(copy(text));
      continue;
    }
    // Search only a small prefix; escaping and multibyte text must also fit the byte budget.
    let low = 0,
      high = Math.min(text.length, Math.max(0, allowance));
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (bytes(text.slice(0, middle)) <= allowance) low = middle;
      else high = middle - 1;
    }
    if (low && /[\uD800-\uDBFF]/.test(text[low - 1])) low--;
    if (low) preview.push(copy(text.slice(0, low)));
    truncated = true;
    break;
  }
  if (truncated) preview.push(NOTICE);
  return preview;
}
