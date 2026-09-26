/** Credential names may use IRIS casing, OAuth snake_case, or hyphens. */
function sensitiveField(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /password|token|privatekey|secrets?$|walletsecretconfig|hotpkey/.test(normalized);
}

/** Collect submitted secrets so an upstream diagnostic cannot echo them as free text. */
export function credentialValues(value: unknown, sensitive = false): string[] {
  if (typeof value === 'string') return sensitive && value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => credentialValues(item, sensitive));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, item]) =>
      credentialValues(item, sensitive || sensitiveField(key)),
    );
  return [];
}

/** Mask credential-bearing fields before any response, review, or export. */
export function redact(value: any, secrets: readonly string[] = []): any {
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveField(key) ? '[redacted]' : redact(item, secrets),
      ]),
    );
  if (typeof value === 'string')
    return secrets.reduce(
      (text, secret) => (secret ? text.split(secret).join('[redacted]') : text),
      value,
    );
  return value;
}
