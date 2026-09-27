import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { RequestError } from '../src/api';

const compiled = build({
  entryPoints: ['src/hooks.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  plugins: [
    {
      name: 'hook-fixture',
      setup(builder) {
        builder.onResolve({ filter: /^(react|\.\/api)$/ }, (args) => ({
          path: args.path,
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'react'
              ? 'export const useState=(...a)=>fixture.useState(...a);export const useRef=(...a)=>fixture.useRef(...a);export const useEffect=(...a)=>fixture.useEffect(...a);export const useCallback=fn=>fn;'
              : 'export const iris=(...a)=>fixture.iris(...a);export const RequestError=fixture.RequestError;',
        }));
      },
    },
  ],
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
async function harness() {
  const state: any[] = [],
    effects = new Map<number, any>(),
    pending: Array<() => void> = [];
  const calls: Array<{
    args: any[];
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = [];
  const timers = new Map<number, () => void>();
  let cursor = 0,
    timerId = 0;
  const fixture = {
    RequestError,
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
    iris(...args: any[]) {
      return new Promise((resolve, reject) => calls.push({ args, resolve, reject }));
    },
  };
  const module = { exports: {} as typeof import('../src/hooks') };
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
  function render(path = '/source', query = {}, interval = 1000, commit = true) {
    cursor = 0;
    const value = module.exports.useData(path, query, interval);
    if (commit) flush();
    return value;
  }
  function flush() {
    pending.splice(0).forEach((effect) => effect());
  }
  return {
    render,
    flush,
    calls,
    timers,
    poll() {
      assert.equal(timers.size, 1);
      [...timers.values()][0]();
    },
  };
}

for (const mode of ['poll', 'refresh'] as const)
  for (const status of [403, 500]) {
    test(`useData ${mode} ${status} invalidates denied data but retains transient-error evidence`, async () => {
      const f = await harness();
      f.render();
      const payload = { evidence: 'Successful native observation' };
      f.calls[0].resolve({ data: payload });
      await settle();
      let view = f.render();
      const at = view.at;
      assert.ok(at);
      if (mode === 'poll') f.poll();
      else {
        view.refresh();
        f.render();
      }
      f.calls.at(-1)!.reject(new RequestError('Controlled read failure', status));
      await settle();
      view = f.render();
      assert.equal(view.error, 'Controlled read failure');
      assert.equal(view.loading, false);
      assert.equal(view.data, status === 403 ? undefined : payload);
      assert.equal(view.at, status === 403 ? undefined : at);
    });
  }

for (const change of ['path', 'query'] as const) {
  test(`useData ${change} change hides old data, timestamp and error before passive effects`, async () => {
    const f = await harness();
    f.render();
    f.calls[0].resolve({ data: { evidence: 'Old source' } });
    await settle();
    f.render();
    f.poll();
    f.calls.at(-1)!.reject(new RequestError('Old source error', 500));
    await settle();
    assert.ok(f.render().data);
    const path = change === 'path' ? '/different' : '/source',
      query = change === 'query' ? { name: 'different' } : {};
    const first = f.render(path, query, 1000, false);
    assert.equal(first.data, undefined);
    assert.equal(first.at, undefined);
    assert.equal(first.error, '');
    assert.equal(first.loading, true);
    f.flush();
    f.calls.at(-1)!.reject(new RequestError('New source unavailable', 500));
    await settle();
    const failed = f.render(path, query);
    assert.equal(failed.data, undefined);
    assert.equal(failed.at, undefined);
    assert.equal(failed.error, 'New source unavailable');
  });
}

test('disabled useData clears its public state immediately and ignores pending old responses', async () => {
  const f = await harness();
  f.render();
  f.calls[0].resolve({ data: { evidence: 'Old source' } });
  await settle();
  f.render();
  f.poll();
  const pending = f.calls.at(-1)!;
  const count = f.calls.length;
  const disabled = f.render('', {}, 1000, false);
  assert.equal(disabled.data, undefined);
  assert.equal(disabled.at, undefined);
  assert.equal(disabled.error, '');
  assert.equal(disabled.loading, false);
  f.flush();
  pending.resolve({ data: { evidence: 'Late old source' } });
  await settle();
  assert.equal(f.render('').data, undefined);
  assert.equal(f.calls.length, count);
  assert.equal(f.timers.size, 0);
});

test('late denied response from a previous source cannot clear a new successful read', async () => {
  const f = await harness();
  f.render();
  const old = f.calls[0];
  f.render('/new');
  const payload = { evidence: 'New source' };
  f.calls[1].resolve({ data: payload });
  await settle();
  const at = f.render('/new').at;
  old.reject(new RequestError('Old source denied', 403));
  await settle();
  const view = f.render('/new');
  assert.equal(view.data, payload);
  assert.equal(view.at, at);
  assert.equal(view.error, '');
});

test('a newer same-source poll owns the result over a delayed denied response', async () => {
  const f = await harness();
  f.render();
  const old = f.calls[0];
  f.poll();
  const payload = { evidence: 'Newest observation' };
  f.calls[1].resolve({ data: payload });
  await settle();
  f.render();
  old.reject(new RequestError('Superseded denial', 403));
  await settle();
  assert.equal(f.render().data, payload);
  assert.equal(f.render().error, '');
});
