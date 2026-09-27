import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function dataComponents() {
  const output = await build({
    entryPoints: ['src/components/DataView.tsx'],
    bundle: true,
    write: false,
    platform: 'node',
    packages: 'external',
    format: 'cjs',
    loader: { '.css': 'empty' },
  });
  const module = { exports: {} as typeof import('../src/components/DataView') };
  runInNewContext(output.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
  });
  return module.exports;
}

test('the real data table renders own special-name fields but never inherited missing values', async () => {
  const { DataTable } = await dataComponents();
  const rows = JSON.parse(
    '[{"Name":"Present","constructor":"Own constructor","toString":"Own text","__proto__":"Own prototype value"},{"Name":"Missing"},{"Name":"Typed","constructor":false,"toString":0,"__proto__":null}]',
  );
  const html = renderToStaticMarkup(createElement(DataTable, { rows }));
  const tableRows = html.split('<tbody>')[1].split('</tbody>')[0].split('</tr>');
  assert.match(tableRows[0], /Own constructor/);
  assert.match(tableRows[0], /Own text/);
  assert.match(tableRows[0], /Own prototype value/);
  assert.equal((tableRows[1].match(/>Not set</g) ?? []).length, 3);
  assert.doesNotMatch(html, /native code|function Object|function toString|No fields/);
  assert.match(tableRows[2], />No</);
  assert.match(tableRows[2], />0</);
  assert.equal((tableRows[2].match(/>Not set</g) ?? []).length, 1);
  assert.equal(Object.hasOwn(rows[0], '__proto__'), true);
  assert.equal(Object.hasOwn(rows[1], '__proto__'), false);
});

test('the real field diff retains added and removed own __proto__ objects', async () => {
  const { DataDiff } = await dataComponents();
  const populated = JSON.parse('{"__proto__":{}}');
  for (const [before, after] of [
    [{}, populated],
    [populated, {}],
  ]) {
    const html = renderToStaticMarkup(createElement(DataDiff, { before, after }));
    assert.match(html, /<th scope="row">__proto__<\/th>/);
    assert.equal((html.match(/>Not set</g) ?? []).length, 1);
    assert.equal((html.match(/>No fields</g) ?? []).length, 1);
  }
});
