import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { entities } from '../shared/catalog.js';
import type { ChangeRecord } from '../shared/change-record.js';

type Element = { type: string | Function; props: Record<string, any> };
// Exercise the actual editor with deterministic React state and delayed transport.
// No browser, live server or native mutation participates in these regression tests.
const compiled = build({
  entryPoints: ['src/components/Editor.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  plugins: [
    {
      name: 'editor-fixtures',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(react(?:\/jsx-runtime)?|lucide-react|\.\/ui|\.\/DataView|\.\/StructuredField|\.\/ChangeImpact|\.\.\/api)$/,
          },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'react'
              ? 'export const useState = (...args) => globalThis.fixture.useState(...args);'
              : args.path === 'react/jsx-runtime'
                ? 'export const jsx = (type, props) => ({type, props}); export const jsxs = jsx; export const Fragment = "Fragment";'
                : args.path === '../api'
                  ? 'export const prepareChange=(...args)=>globalThis.fixture.prepare(...args); export const executeChange=(...args)=>globalThis.fixture.execute(...args); export const request=async()=>({});'
                  : `export const ${
                      args.path === 'lucide-react'
                        ? ['ArrowLeft', 'ArrowRight', 'Check', 'Plus', 'Trash2']
                            .map((name) => `${name}="${name}"`)
                            .join(',')
                        : args.path === './ui'
                          ? 'Modal="Modal",ErrorBox="ErrorBox"'
                          : args.path === './DataView'
                            ? 'DataValue="DataValue"'
                            : args.path === './StructuredField'
                              ? 'StructuredField="StructuredField"'
                              : 'ChangeImpact="ChangeImpact"'
                    };`,
          loader: 'js',
        }));
      },
    },
  ],
});

function nodes(tree: any): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function field(tree: Element, name: string) {
  const found = nodes(tree).find(
    (node) => node.props?.name === name && typeof node.props.onChange === 'function',
  );
  assert.ok(found, 'Field must be present: ' + name);
  return found;
}
async function harness() {
  const state: any[] = [];
  let cursor = 0;
  let resolve!: (record: ChangeRecord) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<ChangeRecord>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  let submitted: any;
  let executed: ChangeRecord | undefined;
  let executionError: Error | undefined;
  const fixture = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in state))
        state[index] = typeof initial === 'function' ? (initial as Function)() : initial;
      return [
        state[index],
        (value: any) => {
          state[index] = typeof value === 'function' ? value(state[index]) : value;
        },
      ];
    },
    prepare(operation: unknown) {
      submitted = structuredClone(operation);
      return pending;
    },
    async execute(record: ChangeRecord) {
      executed = record;
      if (executionError) throw executionError;
      return record;
    },
  };
  const module = { exports: {} as { Editor: (props: any) => Element } };
  runInNewContext((await compiled).outputFiles[0].text, {
    module,
    exports: module.exports,
    fixture,
    console,
  });
  const render = () => {
    cursor = 0;
    return module.exports.Editor({
      entity: entities.roles,
      identity: 'ReviewRole',
      initial: { Description: 'Original' },
      onClose() {},
      onSaved() {},
    });
  };
  const review = () =>
    ({
      version: 1,
      id: 'prepared-ticket',
      revision: 1,
      owner: 'alice',
      instance: 'one',
      title: 'Change role',
      target: 'ReviewRole',
      path: '/v2/security/role',
      method: 'PUT',
      query: { name: 'ReviewRole' },
      state: 'prepared',
      fields: [{ name: 'Description', before: 'Original', requested: 'A', readable: true }],
      events: [],
      createdAt: '',
      updatedAt: '',
      expiresAt: '',
      explanation: '',
      verification: 'fields',
    }) as ChangeRecord;
  return {
    render,
    resolve,
    reject,
    review,
    submitted: () => submitted,
    executed: () => executed,
    failExecution(error: Error) {
      executionError = error;
    },
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('editor locks preparation and renders the exact prepared fields even if the draft changes', async () => {
  const f = await harness();
  field(f.render(), 'Description').props.onChange('A');
  nodes(f.render())
    .find((node) => node.type === 'form')!
    .props.onSubmit({ preventDefault() {} });
  const preparing = f.render();
  assert.equal(f.submitted().body.Description, 'A');
  const fieldsLocked = nodes(preparing).some(
    (node) => node.type === 'fieldset' && node.props.disabled === true,
  );
  // A queued event/state update must not alter what the immutable ticket review displays.
  field(preparing, 'Description').props.onChange('B');
  f.resolve(f.review());
  await settle();
  const reviewed = f.render();
  const displayed = nodes(reviewed)
    .filter((node) => node.type === 'DataValue')
    .map((node) => node.props.value);
  assert.ok(displayed.includes('A'), 'Review must show the prepared value');
  assert.ok(
    !displayed.includes('B'),
    'An unsent draft value must not masquerade as the prepared change',
  );
  assert.ok(fieldsLocked, 'Fields must be disabled until preparation finishes');
  const apply = nodes(reviewed).find(
    (node) => node.type === 'button' && nodes(node).some((child) => child.type === 'Check'),
  );
  assert.ok(apply);
  await apply.props.onClick();
  assert.equal(f.executed()?.id, 'prepared-ticket');
  assert.equal(f.executed()?.fields[0].requested, 'A');
});

test('a failed preparation keeps the draft and exposes the server error in the editor', async () => {
  const f = await harness();
  field(f.render(), 'Description').props.onChange('A');
  nodes(f.render())
    .find((node) => node.type === 'form')!
    .props.onSubmit({ preventDefault() {} });
  f.reject(new Error('The target changed. Refresh before saving.'));
  await settle();
  const after = f.render();
  assert.equal(field(after, 'Description').props.value, 'A');
  assert.ok(
    nodes(after).some(
      (node) => node.type === 'ErrorBox' && node.props.error.includes('target changed'),
    ),
  );
  assert.ok(!nodes(after).some((node) => node.type === 'fieldset' && node.props.disabled === true));
});

test('an ambiguous execution keeps the reviewed evidence, disables replay and preserves the draft for Back', async () => {
  const f = await harness();
  field(f.render(), 'Description').props.onChange('A');
  nodes(f.render())
    .find((node) => node.type === 'form')!
    .props.onSubmit({ preventDefault() {} });
  f.resolve(f.review());
  await settle();
  f.failExecution(new Error('Result unresolved. Inspect Change history before another write.'));
  const apply = (tree: Element) =>
    nodes(tree).find(
      (node) => node.type === 'button' && nodes(node).some((child) => child.type === 'Check'),
    )!;
  await apply(f.render()).props.onClick();
  const failed = f.render();
  assert.equal(apply(failed).props.disabled, true);
  assert.ok(nodes(failed).some((node) => node.type === 'DataValue' && node.props.value === 'A'));
  assert.ok(
    nodes(failed).some(
      (node) => node.type === 'ErrorBox' && node.props.error.includes('Result unresolved'),
    ),
  );
  const back = nodes(failed).find(
    (node) => node.type === 'button' && nodes(node).some((child) => child.type === 'ArrowLeft'),
  )!;
  back.props.onClick();
  await settle();
  assert.equal(field(f.render(), 'Description').props.value, 'A');
});
