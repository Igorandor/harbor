/** Mask credential-bearing fields before any response, review, or export. */
export function redact(value: any): any {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /password|token|privatekey|^secret$|walletsecretconfig|hotpkey/i.test(key)
          ? '[redacted]'
          : redact(item),
      ]),
    );
  return value;
}
