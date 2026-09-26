import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entities, label } from '../shared/catalog';
import { bodySchema, parameters, resolveSchema, spec } from '../shared/schema';
import upstreamSpec from '../shared/iris-openapi.json';

test('untrusted field names cannot resolve inherited label values', () => {
  for (const key of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.equal(typeof label(key), 'string');
    assert.equal(label(key), key.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
  }
  assert.equal(label('NameSpace'), 'Namespace');
});

function responseSchema(schema: any): any {
  if (schema?.$ref)
    return responseSchema((upstreamSpec.components.schemas as any)[schema.$ref.split('/').pop()]);
  if (schema?.allOf)
    return {
      properties: Object.assign(
        {},
        ...schema.allOf.map((part: any) => responseSchema(part)?.properties ?? {}),
      ),
    };
  return schema;
}

for (const entity of Object.values(entities))
  test(`${entity.id}: displayed columns exist in the official list response`, () => {
    const operation = (upstreamSpec.paths as any)[entity.list].get;
    const envelope = responseSchema(operation.responses['200'].content['application/json'].schema);
    const items = responseSchema(responseSchema(envelope.properties.result).items);
    for (const key of [entity.key, ...entity.columns])
      assert.ok(
        items.properties[key],
        `Missing response field: ${key}; available: ${Object.keys(items.properties).join(', ')}`,
      );
  });
for (const entity of Object.values(entities))
  test(`${entity.id}: list, identity and editor match the pinned IRIS contract`, () => {
    assert.ok(spec.paths[entity.list]?.get, 'list endpoint exists');
    if (entity.detail && !entity.readonly) {
      const edit = bodySchema(entity.detail, 'PUT');
      for (const f of entity.fields ?? []) assert.ok(edit.properties?.[f], `unknown field ${f}`);
    }
    if (entity.detail && !entity.noDetail)
      assert.ok(
        parameters(entity.detail, 'get').some((p) => p.name === entity.param),
        `invalid identifier ${entity.param}`,
      );
  });
test('composed SSL schemas expose both configuration and private-key password fields', () => {
  const schema = bodySchema('/v2/security/ssl-configuration', 'PUT');
  assert.ok(schema.properties?.VerifyPeer);
  assert.ok(schema.properties?.PrivateKeyPassword);
});
