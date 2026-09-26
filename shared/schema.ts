import specification from './iris-contract.json';
export type RecordData = Record<string, any>;
export type Schema = {
  type?: string;
  description?: string;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  items?: Schema;
  $ref?: string;
  allOf?: Schema[];
  readOnly?: boolean;
  writeOnly?: boolean;
  example?: unknown;
  required?: string[];
};
export const spec = specification as unknown as {
  paths: Record<string, RecordData>;
  components: { schemas: Record<string, Schema>; parameters: Record<string, RecordData> };
};
export function resolveSchema(schema: Schema = {}): Schema {
  if (schema.$ref) return resolveSchema(spec.components.schemas[schema.$ref.split('/').pop()!]);
  if (schema.allOf)
    return {
      ...schema,
      properties: Object.assign(
        {},
        ...schema.allOf.map((part) => resolveSchema(part).properties ?? {}),
      ),
    };
  return schema;
}
export function bodySchema(path: string, method: string): Schema {
  return resolveSchema(
    spec.paths[path]?.[method.toLowerCase()]?.requestBody?.content?.['application/json']?.schema,
  );
}
export function parameters(path: string, method = 'get'): RecordData[] {
  return [
    ...(spec.paths[path]?.parameters ?? []),
    ...(spec.paths[path]?.[method]?.parameters ?? []),
  ].map((p) => (p.$ref ? spec.components.parameters[p.$ref.split('/').pop()!] : p));
}
export const readablePaths = Object.entries(spec.paths)
  .filter(
    ([path, value]) =>
      value.get &&
      !/(\/secrets$|\/secret$|\/password$|initial-access-token|search-password)/.test(path),
  )
  .map(([path, value]) => ({ path, summary: value.get.summary as string }));
export function plainDescription(text = '') {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
