import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { RequestError } from '../src/api';
import type { RuntimeSample } from '../shared/runtime-analysis';

function compile(entry: string) {
  return build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [
      {
        name: 'inspector-fixture',
        setup(builder) {
          builder.onLoad({ filter: /ApplicationCenter\.tsx$/ }, (args) => ({
            contents:
              readFileSync(args.path, 'utf8') + '\nexport { ApplicationDetail, ServiceDetail };',
            loader: 'tsx',
          }));
          builder.onResolve(
            {
              filter:
                /^(react(?:\/jsx-runtime)?|lucide-react|(?:\.\.\/){1,2}(?:api|hooks|components\/(?:ui|DataView)))$/,
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
                    ? 'export const request=(...a)=>fixture.request(...a);export const iris=(...a)=>fixture.request(...a);export const download=(...a)=>fixture.downloads.push(a);export const RequestError=fixture.RequestError;'
                    : args.path.endsWith('/hooks')
                      ? 'export const useData=()=>({data:[]});'
                      : 'export const ' +
                        (args.path === 'lucide-react'
                          ? [
                              'Activity',
                              'Download',
                              'Gauge',
                              'GitCompareArrows',
                              'HardDrive',
                              'Lock',
                              'RefreshCw',
                              'Server',
                              'ArrowLeft',
                            ]
                          : args.path.endsWith('/DataView')
                            ? ['DataValue']
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
}
const appBuild = compile('src/features/applications/ApplicationCenter.tsx');
const runtimeBuild = compile('src/pages/RuntimeWorkbench.tsx');
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
async function harness(component: 'ApplicationDetail' | 'ServiceDetail' | 'RuntimeWorkbench') {
  let cursor = 0,
    uuid = 0;
  const states: any[] = [],
    effects = new Map<number, any>(),
    pending: Array<() => void> = [];
  const calls: Array<{
      args: any[];
      resolve: (value: any) => void;
      reject: (error: Error) => void;
    }> = [],
    downloads: any[] = [];
  const fixture = {
    RequestError,
    downloads,
    useState(initial: any) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        (value: any) => {
          states[index] = typeof value === 'function' ? value(states[index]) : value;
        },
      ];
    },
    useRef(initial: any) {
      const index = cursor++;
      return (states[index] ??= { current: initial });
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
    request(...args: any[]) {
      return new Promise((resolve, reject) => calls.push({ args, resolve, reject }));
    },
  };
  const module = { exports: {} as Record<string, (props: any) => any> };
  const output = await (component === 'RuntimeWorkbench' ? runtimeBuild : appBuild);
  runInNewContext(output.outputFiles[0].text, {
    module,
    exports: module.exports,
    fixture,
    crypto: { randomUUID: () => String(++uuid) },
    document: { hidden: false },
    setInterval() {
      return 1;
    },
    clearInterval() {},
  });
  function render() {
    cursor = 0;
    const tree = module.exports[component]({
      name: '/fixture',
      back() {},
      select() {},
      onManage() {},
    });
    pending.splice(0).forEach((effect) => effect());
    return tree;
  }
  function refresh() {
    button(render(), 'Refresh').props.onClick();
    render();
    return calls.at(-1)!;
  }
  return { render, refresh, calls, downloads };
}
const at = '2026-09-27T15:00:00Z';
const source = (data: any) => ({ status: 'available', httpStatus: 200, observedAt: at, data });
function application() {
  return {
    name: '/fixture',
    startedAt: at,
    finishedAt: at,
    application: source({
      Name: '/fixture',
      Description: 'Protected application',
      Enabled: true,
      AutheEnabled: 32,
    }),
    namespace: source({ Globals: 'Protected database' }),
    resource: { status: 'not applicable', observedAt: at },
    routes: source([]),
    databases: [],
  };
}

for (const component of ['ApplicationDetail', 'ServiceDetail'] as const)
  for (const status of [403, 500]) {
    test(`${component} ${status} clears denied detail or preserves a transient-error observation`, async () => {
      const f = await harness(component);
      f.render();
      const initial =
        component === 'ApplicationDetail'
          ? application()
          : {
              data: {
                Name: 'FixtureService',
                Description: 'Protected service',
                Enabled: true,
                AutheEnabled: 32,
              },
            };
      f.calls[0].resolve(initial);
      await settle();
      button(f.render(), 'Export').props.onClick();
      const firstExport = f.downloads[0][1];
      f.refresh().reject(new RequestError('Controlled endpoint failure', status));
      await settle();
      const tree = f.render();
      assert.equal(
        nodes(tree).find((node) => node.type === 'ErrorBox').props.error,
        'Controlled endpoint failure',
      );
      assert.equal(button(tree, 'Export').props.disabled, status === 403);
      if (status === 500) {
        button(tree, 'Export').props.onClick();
        assert.deepEqual(f.downloads[1][1], firstExport);
        assert.ok(text(tree).includes('previous'));
      } else {
        assert.equal(
          nodes(tree).some((node) => node.type === 'Details'),
          false,
        );
        assert.equal(text(tree).includes('previous'), false);
        if (component === 'ServiceDetail') assert.equal(text(tree).includes(firstExport.at), false);
      }
    });
  }

test('application partial source 403 preserves allowed application evidence in the current export', async () => {
  const f = await harness('ApplicationDetail');
  f.render();
  f.calls[0].resolve(application());
  await settle();
  const partial = application();
  partial.namespace = {
    status: 'unavailable',
    observedAt: at,
    httpStatus: 403,
    notice: 'Namespace denied',
  } as any;
  f.refresh().resolve(partial);
  await settle();
  button(f.render(), 'Export').props.onClick();
  assert.equal(f.downloads[0][1].application.data.Description, 'Protected application');
  assert.equal(f.downloads[0][1].namespace.data, undefined);
});

function sample(index: number, hostAvailable = true): RuntimeSample {
  const timestamp = `2026-09-27T15:00:0${index}Z`;
  return {
    version: 1,
    instance: 'Fixture',
    startedAt: timestamp,
    finishedAt: timestamp,
    processDetails: [],
    sources: [
      {
        source: 'host',
        path: '/extension/telemetry',
        capturedAt: timestamp,
        elapsedMs: 1,
        status: hostAvailable ? 'available' : 'unavailable',
        ...(hostAvailable
          ? {
              data: {
                memory: { total: 100, available: 50 },
                disk: { total: 100, free: 50 },
                cpu: { totalTicks: index * 100, idleTicks: index * 40, loadAverage: [0] },
              },
            }
          : { notice: 'Current account cannot read this source.' }),
      },
    ],
  };
}
async function capture(f: Awaited<ReturnType<typeof harness>>, value: RuntimeSample) {
  button(f.render(), 'Capture runtime').props.onClick();
  f.calls.at(-1)!.resolve(value);
  await settle();
}

test('selecting the runtime baseline as current resets the selector and uses the previous distinct sample', async () => {
  const f = await harness('RuntimeWorkbench');
  await capture(f, sample(1));
  await capture(f, sample(2));
  const selectors = () => nodes(f.render()).filter((node) => node.type === 'select');
  const cpu = () =>
    nodes(f.render()).find(
      (node) => node.type?.name === 'CapacityMetric' && node.props.title === 'Host CPU busy',
    ).props.value;
  assert.equal(cpu(), 60);
  selectors()[0].props.onChange({ target: { value: '1' } });
  selectors()[1].props.onChange({ target: { value: '2' } });
  selectors()[0].props.onChange({ target: { value: '2' } });
  assert.equal(selectors()[1].props.value, '');
  assert.equal(cpu(), 60);
  selectors()[0].props.onChange({ target: { value: '1' } });
  assert.equal(selectors()[1].props.value, '');
  assert.equal(cpu(), undefined);
});

test('runtime history remains timestamped evidence while unavailable current metrics stay unknown', async () => {
  const f = await harness('RuntimeWorkbench');
  const old = sample(1);
  await capture(f, old);
  await capture(f, sample(2, false));
  let tree = f.render();
  for (const metric of nodes(tree).filter((node) => node.type?.name === 'CapacityMetric'))
    assert.equal(metric.props.value, undefined);
  button(tree, 'Export sample').props.onClick();
  assert.equal(f.downloads[0][1].finishedAt, sample(2).finishedAt);
  assert.equal(f.downloads[0][1].sources[0].data, undefined);
  nodes(tree)
    .find((node) => node.type === 'select')
    .props.onChange({ target: { value: '1' } });
  tree = f.render();
  button(tree, 'Export sample').props.onClick();
  assert.equal(f.downloads[1][1], old);
  assert.equal(f.downloads[1][1].sources[0].capturedAt, old.finishedAt);
  button(tree, 'Source records').props.onClick();
  tree = f.render();
  assert.ok(text(tree).includes(old.finishedAt));
  assert.ok(text(tree).includes('/extension/telemetry'));
});
