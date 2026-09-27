/** Credential names may use IRIS casing, OAuth snake_case, or hyphens. */
function sensitiveField(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /password|token|privatekey|secrets?$|walletsecretconfig|hotpkey/.test(normalized);
}

const booleanPolicyFields = new Set(['ChangePassword', 'PasswordNeverExpires', 'HOTPKeyDisplay']);

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
  const literals = [...new Set(secrets.filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = literals.length ? new RegExp(literals.join('|'), 'g') : undefined;
  // One pass over each original string. Never mask the replacement marker again:
  // attacker-chosen short secrets could otherwise amplify it on every iteration.
  function visit(item: any): any {
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item).map(([key, child]) => [
          key,
          sensitiveField(key) && !(typeof child === 'boolean' && booleanPolicyFields.has(key))
            ? '[redacted]'
            : visit(child),
        ]),
      );
    return typeof item === 'string' && pattern ? item.replace(pattern, () => '[redacted]') : item;
  }
  return visit(value);
}
