import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

type Element = { type: string | Function; props: Record<string, any> };
const icons = [
  'Activity',
  'ArrowRight',
  'BookOpen',
  'Check',
  'ChevronDown',
  'Command',
  'ExternalLink',
  'FileText',
  'Globe',
  'LayoutDashboard',
  'LogOut',
  'Menu',
  'Moon',
  'Search',
  'Server',
  'Shield',
  'Sun',
  'Users',
  'Workflow',
  'X',
];
const compiled = build({
  entryPoints: ['src/App.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  plugins: [
    {
      name: 'startup-fixtures',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(react(?:\/jsx-runtime)?|lucide-react|\.\/api|\.\/hooks|\.\.\/shared\/catalog|\.\/components\/ui|\.\/pages\/.*|\.\/features\/.*)$/,
          },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          loader: 'js',
          contents:
            args.path === 'react'
              ? 'export const useState=(...a)=>globalThis.fixture.useState(...a);export const useEffect=(...a)=>globalThis.fixture.useEffect(...a);export const useRef=(current)=>({current});'
              : args.path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="Fragment";'
                : args.path === './api'
                  ? 'export const request=(...a)=>globalThis.fixture.request(...a);'
                  : args.path === './hooks'
                    ? 'export const useData=()=>({data:[]});'
                    : args.path.endsWith('/catalog')
                      ? 'export const entities={};'
                      : 'export const ' +
                        (args.path === 'lucide-react'
                          ? icons
                          : args.path.endsWith('/ui')
                            ? ['ErrorBox', 'IconButton', 'Loading', 'Modal']
                            : [args.path.split('/').at(-1)!]
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
function nodes(tree: any): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree: any): string {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  return tree && typeof tree === 'object' ? text(tree.props?.children) : String(tree ?? '');
}
async function harness() {
  const state: any[] = [];
  const effects = new Map<
    number,
    { callback: () => any; dependencies: unknown[]; cleanup?: () => void }
  >();
  const pendingEffects: Array<() => void> = [];
  const calls: Array<{ path: string; resolve: (value: unknown) => void }> = [];
  let cursor = 0;
  const window = new EventTarget();
  const fixture = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [
        state[index],
        (value: any) => {
          state[index] = typeof value === 'function' ? value(state[index]) : value;
        },
      ];
    },
    useEffect(callback: () => any, dependencies: unknown[]) {
      const index = cursor++,
        previous = effects.get(index);
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
        const effect = { callback, dependencies, cleanup: undefined as (() => void) | undefined };
        effects.set(index, effect);
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effect.cleanup = callback();
        });
      }
    },
    request(path: string) {
      return new Promise((resolve) => calls.push({ path, resolve }));
    },
  };
  const module = { exports: {} as { default: () => Element } };
  runInNewContext((await compiled).outputFiles[0].text, {
    module,
    exports: module.exports,
    fixture,
    window,
    Event,
    location: { hash: '#diagnostics' },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    document: { documentElement: { dataset: {} } },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  });
  function render() {
    cursor = 0;
    const tree = module.exports.default();
    pendingEffects.splice(0).forEach((effect) => effect());
    return tree;
  }
  function replayEffects() {
    // StrictMode replays mount effects with state retained: cleanup, then setup.
    for (const effect of effects.values()) effect.cleanup?.();
    for (const effect of effects.values()) effect.cleanup = effect.callback();
  }
  return { calls, window, render, replayEffects };
}
const session = (username: string) => ({
  info: { username, systemMode: 'Fixture', privileges: {} },
  csrf: 'fixture',
});

for (const first of ['disposed', 'live'] as const)
  test(
    'StrictMode startup keeps the live session when the ' + first + ' response arrives first',
    async () => {
      const f = await harness();
      assert.equal(f.render().type, 'Loading');
      f.replayEffects();
      assert.equal(f.calls.length, 2);
      assert.ok(f.calls.every((call) => call.path === 'session'));
      if (first === 'disposed') {
        f.calls[0].resolve(session('Disposed response'));
        await settle();
        assert.equal(
          f.render().type,
          'Loading',
          'A cleaned-up effect must not finish current startup',
        );
        f.calls[1].resolve(session('Alice'));
        await settle();
      } else {
        f.calls[1].resolve(session('Alice'));
        await settle();
        assert.ok(text(f.render()).includes('Alice'));
        f.calls[0].resolve(session('Disposed response'));
        await settle();
      }
      assert.ok(text(f.render()).includes('Alice'));
      assert.ok(!text(f.render()).includes('Disposed response'));
    },
  );

test('session invalidation removes the protected tree and a pending bootstrap cannot resurrect it', async () => {
  const f = await harness();
  f.render();
  f.window.dispatchEvent(new Event('session-ended'));
  assert.equal((f.render().type as Function).name, 'Login');
  f.calls[0].resolve(session('Alice'));
  await settle();
  assert.equal((f.render().type as Function).name, 'Login');
  assert.ok(!nodes(f.render()).some((node) => node.type === 'Diagnostics'));
});

test('session-ended removes an already mounted diagnostic subtree instead of silently changing identity', async () => {
  const f = await harness();
  f.render();
  f.calls[0].resolve(session('Alice'));
  await settle();
  assert.ok(nodes(f.render()).some((node) => node.type === 'Diagnostics'));
  f.window.dispatchEvent(new Event('session-ended'));
  assert.equal((f.render().type as Function).name, 'Login');
  assert.ok(!text(f.render()).includes('Alice'));
  assert.ok(!nodes(f.render()).some((node) => node.type === 'Diagnostics'));
  assert.equal(f.calls.length, 1, 'Invalidation must not silently request a new session');
});
