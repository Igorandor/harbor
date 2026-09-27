import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { entities } from '../shared/catalog';

test('collection renders the remaining rows and range immediately when a later page shrinks', async () => {
  const compiled = await build({
    entryPoints: ['src/pages/Collection.tsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    plugins: [
      {
        name: 'collection-pagination-fixture',
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^(react(?:\/jsx-runtime)?|lucide-react|\.\.\/(?:hooks|api|components\/(?:ui|Editor)))$/,
            },
            (args) => ({ path: args.path, namespace: 'fixture' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'js',
            contents:
              args.path === 'react'
                ? 'export const useState=(...a)=>fixture.useState(...a);export const useEffect=(...a)=>fixture.useEffect(...a);'
                : args.path === 'react/jsx-runtime'
                  ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="Fragment";'
                  : args.path === '../hooks'
                    ? 'export const useData=()=>fixture.resource;'
                    : args.path === '../api'
                      ? 'export const iris=()=>{throw Error("Unexpected native request")};export const download=()=>{};'
                      : 'export const ' +
                        (args.path === 'lucide-react'
                          ? [
                              'Download',
                              'Pause',
                              'Play',
                              'Plus',
                              'Search',
                              'Trash2',
                              'Pencil',
                              'ArrowLeft',
                              'Square',
                              'KeyRound',
                            ]
                          : [
                              'Details',
                              'Empty',
                              'ErrorBox',
                              'Loading',
                              'Modal',
                              'PageHeader',
                              'Refresh',
                              'Table',
                              'Editor',
                            ]
                        )
                          .map((name) => `${name}="${name}"`)
                          .join(',') +
                        ';',
          }));
        },
      },
    ],
  });
  const states: any[] = [],
    effects: Array<() => void> = [];
  const dependencies = new Map<number, unknown[]>();
  let cursor = 0;
  const fixture = {
    resource: {
      data: Array.from({ length: 45 }, (_, i) => ({ Name: `Role ${i + 1}` })),
      loading: false,
      error: '',
      refresh() {},
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        (value: any) => {
          states[index] = typeof value === 'function' ? value(states[index]) : value;
        },
      ];
    },
    useEffect(callback: () => void, next: unknown[]) {
      const index = cursor++,
        previous = dependencies.get(index);
      if (!previous || next.some((value, i) => value !== previous[i])) {
        dependencies.set(index, next);
        effects.push(callback);
      }
    },
  };
  const module = { exports: {} as { Collection: (props: any) => any } };
  runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, fixture });
  function render() {
    cursor = 0;
    return module.exports.Collection({ entity: entities.roles, info: {}, notify() {} });
  }
  function nodes(tree: any): any[] {
    return Array.isArray(tree)
      ? tree.flatMap(nodes)
      : tree && typeof tree === 'object'
        ? [tree, ...nodes(tree.props?.children)]
        : [];
  }
  function text(tree: any): string {
    return Array.isArray(tree)
      ? tree.map(text).join('')
      : tree && typeof tree === 'object'
        ? text(tree.props?.children)
        : String(tree ?? '');
  }
  function button(tree: any, label: string) {
    return nodes(tree).find((node) => node.type === 'button' && text(node) === label);
  }
  function flushEffects() {
    while (effects.length) effects.shift()!();
  }
  let view = render();
  flushEffects();
  for (let i = 0; i < 2; i++) {
    button(view, 'Next').props.onClick();
    view = render();
    flushEffects();
  }
  assert.equal(nodes(view).find((node) => node.type === 'Table').props.rows.length, 5);
  assert.match(text(view), /Showing 41–45 of 45/);
  fixture.resource.data = fixture.resource.data.slice(0, 3);
  view = render(); // Deliberately inspect the committed output before passive effects run.
  assert.equal(effects.length, 1);
  assert.deepEqual(
    nodes(view).find((node) => node.type === 'Table').props.rows,
    fixture.resource.data,
  );
  assert.match(text(view), /Showing 1–3 of 3/);
  assert.equal(button(view, 'Previous').props.disabled, true);
  assert.equal(button(view, 'Next').props.disabled, true);
  flushEffects();
  assert.match(text(render()), /Showing 1–3 of 3/);
});
