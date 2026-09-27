import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { RequestError } from '../src/api';
import type { TaskObservation } from '../shared/task-analysis';

const compiled = build({
  entryPoints: ['src/features/tasks/TaskCenter.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'task-detail-fixture',
      setup(builder) {
        builder.onLoad({ filter: /TaskCenter\.tsx$/ }, (args) => ({
          contents: readFileSync(args.path, 'utf8') + '\nexport { TaskDetail };',
          loader: 'tsx',
        }));
        builder.onResolve(
          {
            filter:
              /^(react(?:\/jsx-runtime)?|lucide-react|\.\.\/\.\.\/api|\.\.\/\.\.\/hooks|\.\.\/\.\.\/components\/ui)$/,
          },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'react'
              ? 'export const useState=(...a)=>fixture.useState(...a);export const useEffect=(...a)=>fixture.useEffect(...a);export const useRef=(...a)=>fixture.useRef(...a);export const useMemo=f=>f();'
              : args.path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="Fragment";'
                : args.path.endsWith('/api')
                  ? 'export const request=(...a)=>fixture.request(...a);export const download=(...a)=>fixture.downloads.push(a);export const RequestError=fixture.RequestError;'
                  : args.path.endsWith('/hooks')
                    ? 'export const useData=()=>({data:[]});'
                    : 'export const ' +
                      (args.path === 'lucide-react'
                        ? ['ArrowLeft', 'Download', 'RefreshCw', 'Search']
                        : [
                            'Badge',
                            'Details',
                            'Empty',
                            'ErrorBox',
                            'Loading',
                            'PageHeader',
                            'Value',
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
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function nodes(tree: any): any[] {
  return Array.isArray(tree)
    ? tree.flatMap(nodes)
    : tree && typeof tree === 'object'
      ? [tree, ...nodes(tree.props?.children)]
      : [];
}
function text(tree: any): string {
  return Array.isArray(tree)
    ? tree.map(text).join(' ')
    : tree && typeof tree === 'object'
      ? text(tree.props?.children)
      : String(tree ?? '');
}
const button = (tree: any, label: string) =>
  nodes(tree).find((node) => node.type === 'button' && text(node).trim() === label);
const comparison = (tree: any) =>
  nodes(tree).find((node) => node.type?.name === 'ConfigurationComparison');
const at = '2026-09-27T15:00:00Z';
function observation(name: string): TaskObservation {
  const source = <T>(data: T) => ({
    status: 'available' as const,
    httpStatus: 200,
    observedAt: at,
    data,
  });
  return {
    taskId: '1',
    startedAt: at,
    finishedAt: at,
    configuration: source({ Name: name, TaskClass: 'Protected.Class' }),
    state: source({ Suspended: false }),
    history: source([{ TaskId: 1, Name: 'Protected execution' }]),
    historyLimit: 100,
    historyMayBeLimited: false,
  };
}
async function harness() {
  let cursor = 0;
  const state: any[] = [],
    effects = new Map<number, any>(),
    pending: Array<() => void> = [];
  const calls: Array<{
      path: string;
      resolve: (value: TaskObservation) => void;
      reject: (error: Error) => void;
    }> = [],
    downloads: any[] = [];
  const fixture = {
    RequestError,
    downloads,
    useState(initial: any) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [
        state[index],
        (value: any) => {
          state[index] = typeof value === 'function' ? value(state[index]) : value;
        },
      ];
    },
    useRef(initial: any) {
      const index = cursor++;
      return (state[index] ??= { current: initial });
    },
    useEffect(callback: () => any, dependencies: any[]) {
      const index = cursor++,
        previous = effects.get(index);
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
        const effect: any = { dependencies };
        effects.set(index, effect);
        pending.push(() => {
          previous?.cleanup?.();
          effect.cleanup = callback();
        });
      }
    },
    request(path: string) {
      return new Promise((resolve, reject) => calls.push({ path, resolve, reject }));
    },
  };
  const module = { exports: {} as { TaskDetail: (props: any) => any } };
  runInNewContext((await compiled).outputFiles[0].text, {
    module,
    exports: module.exports,
    fixture,
  });
  function render() {
    cursor = 0;
    const tree = module.exports.TaskDetail({
      task: { Id: 1, Name: 'Fixture' },
      back() {},
      onManage() {},
    });
    pending.splice(0).forEach((effect) => effect());
    return tree;
  }
  function refresh() {
    button(render(), 'Refresh task').props.onClick();
    render();
    return calls.at(-1)!;
  }
  return { render, calls, downloads, refresh };
}
async function prepared() {
  const f = await harness();
  f.render();
  f.calls[0].resolve(observation('A'));
  await settle();
  button(f.render(), 'Compare configuration').props.onClick();
  comparison(f.render()).props.onPin();
  f.refresh().resolve(observation('B'));
  await settle();
  return f;
}

test('whole task endpoint 403 removes observation and comparison exports and forgets the baseline', async () => {
  const f = await prepared();
  f.refresh().reject(new RequestError('Whole endpoint denied', 403));
  await settle();
  let tree = f.render();
  assert.equal(button(tree, 'Export observation').props.disabled, true);
  assert.equal(comparison(tree), undefined);
  assert.equal(
    nodes(tree).find((node) => node.type === 'ErrorBox').props.error,
    'Whole endpoint denied',
  );
  f.refresh().resolve(observation('C'));
  await settle();
  tree = f.render();
  const restored = comparison(tree);
  assert.equal(restored.props.baseline, undefined);
  assert.equal(button(restored.type(restored.props), 'Export comparison'), undefined);
});

test('whole task endpoint 500 preserves the prior observation, baseline and both exports', async () => {
  const f = await prepared();
  f.refresh().reject(new RequestError('Temporary failure', 500));
  await settle();
  const tree = f.render(),
    retained = comparison(tree);
  assert.ok(text(tree).includes('previous successful collection'));
  assert.equal(retained.props.baseline.configuration.data.Name, 'A');
  button(tree, 'Export observation').props.onClick();
  button(retained.type(retained.props), 'Export comparison').props.onClick();
  assert.equal(f.downloads[0][1].configuration.data.Name, 'B');
  assert.equal(f.downloads[0][1].historyLimit, 100);
  assert.equal(f.downloads[1][1].changes.find((item: any) => item.field === 'Name').before, 'A');
});

for (const denied of ['configuration', 'state', 'history'] as const) {
  test(`partial 200 with ${denied} 403 retains available sources without exporting denied data`, async () => {
    const f = await prepared(),
      partial = observation('C');
    partial[denied] = {
      status: 'unavailable',
      httpStatus: 403,
      observedAt: at,
      message: 'Source denied',
    };
    f.refresh().resolve(partial);
    await settle();
    const tree = f.render(),
      retained = comparison(tree);
    assert.equal(button(tree, 'Export observation').props.disabled, false);
    button(tree, 'Export observation').props.onClick();
    assert.equal(f.downloads[0][1][denied].data, undefined);
    for (const source of ['configuration', 'state', 'history'])
      if (source !== denied) assert.ok(f.downloads[0][1][source].data);
    assert.equal(retained.props.baseline.configuration.data.Name, 'A');
    assert.equal(
      !!button(retained.type(retained.props), 'Export comparison'),
      denied !== 'configuration',
    );
  });
}
