import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import * as profileModel from '../shared/investigation-profile';
import * as diagnostics from '../shared/diagnostics';
import * as investigations from '../shared/investigation';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const profile = (id: string, title: string, revision: number) => ({
  ...structuredClone(profileModel.starterProfiles[0]),
  id,
  title,
  revision,
  owner: 'Fixture',
  instance: 'synthetic',
  status: 'active',
  history: [],
  createdAt: '2026-09-27T12:00:00Z',
  updatedAt: '2026-09-27T12:00:00Z',
});
const alpha = profile('11111111-1111-4111-8111-111111111111', 'Profile Alpha', 3);
const bravo = profile('22222222-2222-4222-8222-222222222222', 'Profile Bravo', 7);
const route = (id: string) => 'investigation-profiles/' + id;
type HookState = { slots: any[]; cursor: number; effects: (() => unknown)[] };

// Run the actual parent and editor with separate persistent hook state. Network
// responses are controlled, while selection, draft and save callbacks are real.
async function harness(transport: (path: string, body?: any) => Promise<any>) {
  const calls: Array<{ path: string; body?: any }> = [];
  const parent: HookState = { slots: [], cursor: 0, effects: [] };
  const editor: HookState = { slots: [], cursor: 0, effects: [] };
  let active = parent;
  const hooks = {
    useState(initial: any) {
      const target = active,
        i = target.cursor++;
      if (!(i in target.slots))
        target.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [
        target.slots[i],
        (next: any) => {
          target.slots[i] = typeof next === 'function' ? next(target.slots[i]) : next;
        },
      ];
    },
    useRef(initial: any) {
      const i = active.cursor++;
      return (active.slots[i] ??= { current: initial });
    },
    useEffect(callback: () => unknown, deps: any[]) {
      const i = active.cursor++;
      if (!active.slots[i] || deps.some((value, at) => value !== active.slots[i][at])) {
        active.slots[i] = deps;
        active.effects.push(callback);
      }
    },
  };
  const module = { exports: {} as any };
  const jsx = (type: any, props: any) => ({ type, props });
  const ErrorBox = () => null;
  const dependencies: Record<string, unknown> = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    '../api': {
      request: async (path: string, body?: unknown) => {
        calls.push({ path, body });
        if (path === 'investigation-profiles' && body === undefined)
          return {
            records: [alpha, bravo].map((value) => ({
              ...value,
              stepCount: value.steps.length,
              requiredCount: 1,
            })),
            unreadable: [],
          };
        return transport(path, body);
      },
    },
    '../components/ui': { Modal: () => null, ErrorBox, PageHeader: () => null },
    '../../shared/investigation-profile': profileModel,
    '../../shared/diagnostics': diagnostics,
    '../../shared/investigation': investigations,
  };
  runInNewContext(
    transformSync(
      readFileSync(new URL('../src/pages/InvestigationProfiles.tsx', import.meta.url), 'utf8'),
      {
        loader: 'tsx',
        jsx: 'automatic',
        format: 'cjs',
      },
    ).code,
    { module, structuredClone, require: (id: string) => dependencies[id] || {} },
  );
  function render(component: any, props: any, target: HookState) {
    active = target;
    target.cursor = 0;
    return component(props);
  }
  function walk(node: any): any[] {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(walk);
    return [node, ...walk(node.props?.children)];
  }
  function text(node: any): string {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node !== 'object') return String(node);
    if (Array.isArray(node)) return node.map(text).join('');
    return text(node.props?.children);
  }
  const page = () => walk(render(module.exports.InvestigationProfiles, { onStarted() {} }, parent));
  const button = (label: string, exact = true) =>
    page().find(
      (node) =>
        node.type === 'button' &&
        (exact ? text(node).trim() === label : text(node).includes(label)),
    );
  const edit = () => {
    const node = page().find(
      (node) => typeof node.type === 'function' && node.type.name === 'ProfileEditor',
    );
    assert.ok(node, 'Editor remains mounted');
    return walk(render(node.type, node.props, editor));
  };
  page();
  while (parent.effects.length) parent.effects.shift()!();
  await tick();
  return {
    calls,
    page,
    button,
    edit,
    selectedTitle: () => page().find((node) => node.type === 'h2')?.props.children,
    error: () => page().find((node) => node.type === ErrorBox)?.props.error,
    select: (name: string) => button(name, false).props.onClick(),
    async save() {
      edit()
        .find(
          (node) =>
            node.type === 'textarea' && node.props.maxLength === 2000 && node.props.value === '',
        )
        .props.onChange({ target: { value: 'Review Bravo instructions' } });
      edit()
        .find((node) => node.type === 'form')
        .props.onSubmit({ preventDefault() {} });
      await tick();
    },
  };
}

test('late Alpha inspection cannot redirect an open Bravo edit to Alpha', async () => {
  const pending = deferred<any>();
  const ui = await harness(async (path, body) => {
    if (body) return { ...bravo, ...body.definition, revision: 8 };
    return path === route(alpha.id) ? pending.promise : bravo;
  });
  ui.select(alpha.title);
  assert.ok(!ui.button(bravo.title, false).props.disabled);
  ui.select(bravo.title);
  await tick();
  assert.equal(ui.button('Edit profile').props.disabled, false);
  ui.button('Edit profile').props.onClick();
  ui.edit();
  pending.resolve(alpha);
  await tick();
  assert.equal(ui.selectedTitle(), bravo.title);
  await ui.save();
  const writes = ui.calls.filter((value) => value.body !== undefined);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, route(bravo.id) + '/revise');
  assert.equal(writes[0].body.revision, 7);
  assert.equal(writes[0].body.definition.title, bravo.title);
});

test('stale inspection errors and completion do not replace the latest error or release its busy state', async () => {
  const a = deferred<any>(),
    b = deferred<any>();
  const ui = await harness(async (path) => (path === route(alpha.id) ? a.promise : b.promise));
  ui.select(alpha.title);
  ui.select(bravo.title);
  a.reject(new Error('Stale Alpha failure'));
  await tick();
  assert.equal(ui.error(), undefined);
  assert.equal(ui.button('Refresh').props.disabled, true);
  b.reject(new Error('Current Bravo failure'));
  await tick();
  assert.equal(ui.error(), 'Current Bravo failure');
  assert.equal(ui.button('Refresh').props.disabled, false);
});

test('an editor saves its opening identity and revision even if a later selection replaces the workbench', async () => {
  const ui = await harness(async (path, body) =>
    body ? bravo : path === route(alpha.id) ? alpha : bravo,
  );
  ui.select(bravo.title);
  await tick();
  ui.button('Edit profile').props.onClick();
  ui.edit();
  // Retained/background callbacks cannot rebind the mounted editor's target.
  ui.select(alpha.title);
  await tick();
  assert.equal(ui.selectedTitle(), alpha.title);
  await ui.save();
  const writes = ui.calls.filter((value) => value.body !== undefined);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, route(bravo.id) + '/revise');
  assert.equal(writes[0].body.revision, 7);
  assert.equal(writes[0].body.definition.title, bravo.title);
});

test('late status and save responses cannot replace a newer selection or clear its pending state', async () => {
  for (const action of ['status', 'save']) {
    const mutation = deferred<any>(),
      next = deferred<any>();
    const ui = await harness(async (path, body) =>
      body ? mutation.promise : path === route(alpha.id) ? next.promise : bravo,
    );
    ui.select(bravo.title);
    await tick();
    if (action === 'status') ui.button('Archive').props.onClick();
    else {
      ui.button('Edit profile').props.onClick();
      await ui.save();
    }
    ui.select(alpha.title);
    mutation.resolve({ ...bravo, revision: 8 });
    await tick();
    assert.equal(ui.button('Refresh').props.disabled, true);
    next.resolve(alpha);
    await tick();
    assert.equal(ui.selectedTitle(), alpha.title);
    assert.equal(ui.button('Refresh').props.disabled, false);
    assert.equal(ui.calls.filter((value) => value.body !== undefined).length, 1);
  }
});
