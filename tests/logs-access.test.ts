import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { RequestError } from '../src/api';

const compiled = build({
  entryPoints: ['src/pages/Logs.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  plugins: [
    {
      name: 'log-fixture',
      setup(builder) {
        builder.onResolve(
          { filter: /^(react(?:\/jsx-runtime)?|lucide-react|\.\.\/api|\.\.\/components\/ui)$/ },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          loader: 'js',
          contents:
            args.path === 'react'
              ? 'export const useState=(...a)=>fixture.useState(...a);export const useEffect=(...a)=>fixture.useEffect(...a);'
              : args.path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="Fragment";'
                : args.path === '../api'
                  ? 'export const iris=(...a)=>fixture.request(...a);export const request=(...a)=>fixture.request(...a);export const download=(...a)=>fixture.downloads.push(a);export const RequestError=fixture.RequestError;'
                  : 'export const ' +
                    (args.path === 'lucide-react'
                      ? ['Download', 'Search']
                      : ['Empty', 'ErrorBox', 'Loading', 'PageHeader', 'Refresh', 'Table']
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
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
}
function text(tree: any): string {
  return Array.isArray(tree)
    ? tree.map(text).join(' ')
    : tree && typeof tree === 'object'
      ? text(tree.props?.children)
      : String(tree ?? '');
}
function button(tree: any, name: string) {
  return nodes(tree).find((node) => node.type === 'button' && text(node).trim() === name);
}
async function harness() {
  const state: any[] = [],
    effects = new Map<number, any>(),
    pending: Array<() => void> = [];
  const calls: Array<{
    args: any[];
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = [];
  const timers = new Map<number, () => void>(),
    downloads: any[] = [];
  let cursor = 0,
    timerId = 0;
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
  const module = { exports: {} as { Logs: () => any } };
  runInNewContext((await compiled).outputFiles[0].text, {
    module,
    exports: module.exports,
    fixture,
    document: { hidden: false },
    setInterval(callback: () => void) {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearInterval(id: number) {
      timers.delete(id);
    },
  });
  function render() {
    cursor = 0;
    const tree = module.exports.Logs();
    pending.splice(0).forEach((effect) => effect());
    return tree;
  }
  return {
    render,
    calls,
    downloads,
    poll() {
      assert.equal(timers.size, 1);
      [...timers.values()][0]();
    },
  };
}

for (const mode of ['follow', 'manual'] as const) {
  for (const status of [403, 500]) {
    test(`log ${mode} ${status} ${status === 403 ? 'removes denied evidence and timestamp' : 'preserves the last successful evidence and timestamp'}`, async () => {
      const f = await harness();
      let tree = f.render();
      if (mode === 'follow') {
        nodes(tree)
          .find((node) => node.type === 'input' && node.props.type === 'checkbox')
          .props.onChange({ target: { checked: true } });
        f.render();
      }
      f.calls.at(-1)!.resolve({ data: { lines: ['PROTECTED LOG LINE'] } });
      await settle();
      tree = f.render();
      const observedAt = nodes(tree).find((node) => node.type === 'Refresh').props.at;
      assert.ok(observedAt);
      nodes(tree)
        .find((node) => node.props?.['aria-label'] === 'Filter log entries')
        .props.onChange({ target: { value: 'PROTECTED' } });
      if (mode === 'follow') f.poll();
      else {
        nodes(tree)
          .find((node) => node.type === 'Refresh')
          .props.onClick();
        f.render();
      }
      f.calls.at(-1)!.reject(new RequestError('Controlled read failure', status));
      await settle();
      tree = f.render();
      assert.equal(
        nodes(tree).find((node) => node.type === 'ErrorBox').props.error,
        'Controlled read failure',
      );
      assert.equal(
        nodes(tree).find((node) => node.props?.['aria-label'] === 'Filter log entries').props.value,
        'PROTECTED',
      );
      assert.equal(text(tree).includes('PROTECTED LOG LINE'), status === 500);
      assert.equal(button(tree, 'Export view').props.disabled, status === 403);
      assert.equal(
        nodes(tree).find((node) => node.type === 'Refresh').props.at,
        status === 403 ? undefined : observedAt,
      );
      if (status === 500) {
        button(tree, 'Export view').props.onClick();
        assert.equal(f.downloads[0][1].lines[0], 'PROTECTED LOG LINE');
      }
    });
  }
}

test('changing log source clears the prior result and ignores a late old-source response', async () => {
  const f = await harness();
  f.render();
  f.calls[0].resolve({ data: { lines: ['OLD MESSAGE'] } });
  await settle();
  let tree = f.render();
  nodes(tree)
    .find((node) => node.type === 'Refresh')
    .props.onClick();
  f.render();
  const oldRequest = f.calls.at(-1)!;
  tree = f.render();
  button(tree, 'System alerts').props.onClick();
  f.render();
  tree = f.render();
  assert.equal(button(tree, 'Export view').props.disabled, true);
  assert.equal(nodes(tree).find((node) => node.type === 'Refresh').props.at, undefined);
  f.calls.at(-1)!.resolve({ data: { lines: ['NEW ALERT'] } });
  await settle();
  oldRequest.resolve({ data: { lines: ['LATE OLD MESSAGE'] } });
  await settle();
  tree = f.render();
  assert.ok(text(tree).includes('NEW ALERT'));
  assert.ok(!text(tree).includes('OLD MESSAGE'));
});

test('changing audit time clears the prior result and does not relabel it after failure', async () => {
  const f = await harness();
  let tree = f.render();
  button(tree, 'Security audit').props.onClick();
  f.render();
  f.calls.at(-1)!.resolve({ data: [{ Name: 'Old audit evidence' }] });
  await settle();
  tree = f.render();
  nodes(tree)
    .find((node) => node.props?.type === 'datetime-local')
    .props.onChange({ target: { value: '2026-09-27T14:00' } });
  f.render();
  assert.equal(f.calls.at(-1)!.args[1].beginDateTime, '2026-09-27 14:00:00');
  f.calls.at(-1)!.reject(new RequestError('Controlled new-window failure', 500));
  await settle();
  tree = f.render();
  assert.equal(button(tree, 'Export view').props.disabled, true);
  assert.equal(nodes(tree).find((node) => node.type === 'Refresh').props.at, undefined);
  assert.equal(
    nodes(tree).some((node) => node.type === 'Table'),
    false,
  );
});
