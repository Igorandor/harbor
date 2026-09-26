import { readFileSync, writeFileSync } from 'node:fs';
// Keep the authoritative spec untouched; ship only request contracts to the browser.
const source = JSON.parse(
  readFileSync(new URL('../shared/iris-openapi.json', import.meta.url), 'utf8'),
);
const paths: any = {},
  schemas: any = {},
  needed = new Set<string>();
function scan(value: any) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key === '$ref' && String(item).startsWith('#/components/schemas/'))
      needed.add(String(item).split('/').pop()!);
    else scan(item);
  }
}
for (const [path, definition] of Object.entries(source.paths) as [string, any][]) {
  paths[path] = {};
  for (const [method, operation] of Object.entries(definition) as [string, any][]) {
    if (method === 'parameters') paths[path][method] = operation;
    else if (['get', 'put', 'post', 'delete', 'patch'].includes(method)) {
      paths[path][method] = {
        summary: operation.summary,
        parameters: operation.parameters,
        requestBody: operation.requestBody,
      };
      scan(operation.requestBody);
    }
  }
}
for (const name of needed) {
  schemas[name] = source.components.schemas[name];
  scan(schemas[name]);
}
writeFileSync(
  new URL('../shared/iris-contract.json', import.meta.url),
  JSON.stringify(
    { paths, components: { schemas, parameters: source.components.parameters } },
    null,
    2,
  ) + '\n',
);
console.log(
  `Generated request contract: ${Object.keys(paths).length} paths, ${Object.keys(schemas).length} schemas.`,
);
