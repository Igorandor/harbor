import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { summarizeCase, type Investigation } from '../shared/investigation.js';

type Element = { type: string | Function; props: Record<string, any>; key?: string };
const compiled = build({
  entryPoints: ['src/pages/Investigations.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  plugins: [
    {
      name: 'investigation-fixtures',
      setup(builder) {
        builder.onResolve(
          { filter: /^(react(?:\/jsx-runtime)?|lucide-react|\.\.\/api|\.\.\/components\/.*)$/ },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          loader: 'js',
          contents:
            args.path === 'react'
              ? 'export const useState=(...args)=>globalThis.fixture.useState(...args); export const useRef=(...args)=>globalThis.fixture.useRef(...args); export const useEffect=(...args)=>globalThis.fixture.useEffect(...args);'
              : args.path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props,key)=>({type,props,key}); export const jsxs=jsx; export const Fragment="Fragment";'
                : args.path === '../api'
                  ? 'export const request=(...args)=>globalThis.fixture.request(...args); export const download=()=>{};'
                  : 'export const ' +
                    (args.path === 'lucide-react'
                      ? ['Download', 'FilePlus2', 'Search', 'RefreshCw', 'Camera', 'X']
                      : args.path.endsWith('/ui')
                        ? ['ErrorBox', 'Loading', 'Modal', 'PageHeader']
                        : [
                            args.path.split('/').at(-1) === 'DataView'
                              ? 'DataValue'
                              : args.path.split('/').at(-1)!,
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
function nodes(tree: any): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree: any): string {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  return tree && typeof tree === 'object' ? text(tree.props?.children) : String(tree ?? '');
}
function button(tree: Element, label: string) {
  const found = nodes(tree).find(
    (n) => n.type === 'button' && (n.props['aria-label'] === label || text(n).trim() === label),
  );
  assert.ok(found, 'Button must exist: ' + label);
  return found;
}
function note(tree: Element) {
  const found = nodes(tree).find((n) => n.type === 'textarea');
  assert.ok(found);
  return found;
}
function record(id: string): Investigation {
  return {
    version: 1,
    id,
    title: 'Case ' + id,
    description: 'Controlled UI fixture',
    severity: 'minor',
    tags: [],
    owner: 'alice',
    instance: 'test',
    revision: 1,
    createdAt: '2026-09-27T10:00:00Z',
    updatedAt: '2026-09-27T10:00:00Z',
    status: 'open',
    notes: [],
    captures: [],
    linkedChanges: [],
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
async function harness() {
  const states = new Map<string, any[]>();
  const effects: Array<() => void> = [];
  let active: any[] = [],
    cursor = 0;
  const calls: Array<{
    path: string;
    body: any;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = [];
  const fixture = {
    useState(initial: any) {
      const state = active,
        index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [
        state[index],
        (value: any) => {
          state[index] = typeof value === 'function' ? value(state[index]) : value;
        },
      ];
    },
    useRef(initial: any) {
      const index = cursor++;
      return (active[index] ??= { current: initial });
    },
    useEffect(effect: () => void, deps: unknown[]) {
      const index = cursor++,
        previous = active[index];
      if (!previous || deps.some((dep, i) => dep !== previous[i])) effects.push(effect);
      active[index] = deps;
    },
    request(path: string, body: any) {
      return new Promise((resolve, reject) => calls.push({ path, body, resolve, reject }));
    },
  };
  const module = { exports: {} as { Investigations: () => Element } };
  runInNewContext((await compiled).outputFiles[0].text, {
    module,
    exports: module.exports,
    fixture,
    console,
  });
  function expand(tree: any, path: string): any {
    if (Array.isArray(tree)) return tree.map((child, i) => expand(child, path + '/' + i));
    if (!tree || typeof tree !== 'object') return tree;
    if (typeof tree.type === 'function') {
      const key = path + ':' + tree.type.name + ':' + (tree.key ?? '');
      if (!states.has(key)) states.set(key, []);
      active = states.get(key)!;
      cursor = 0;
      return expand(tree.type(tree.props), key);
    }
    return {
      ...tree,
      props: { ...tree.props, children: expand(tree.props.children, path + '/children') },
    };
  }
  const render = () => {
    const tree = expand({ type: module.exports.Investigations, props: {} }, 'root');
    effects.splice(0).forEach((effect) => effect());
    return tree as Element;
  };
  const a = record('A'),
    b = record('B');
  render();
  calls[0].resolve({ records: [summarizeCase(a), summarizeCase(b)], unreadable: [], total: 2 });
  await settle();
  function choice(tree: Element, id: string) {
    return nodes(tree).find((n) => n.type === 'button' && text(n).startsWith('Case ' + id))!;
  }
  async function openA() {
    choice(render(), 'A').props.onClick();
    calls.at(-1)!.resolve(a);
    await settle();
    render();
  }
  async function submit(value: string) {
    note(render()).props.onChange({ target: { value } });
    const form = nodes(render()).find((n) => n.type === 'form')!;
    const result = form.props.onSubmit({ preventDefault() {} });
    return { result };
  }
  return { render, calls, a, b, choice, openA, submit };
}

test('pending investigation reads and writes prevent another selection or close from losing the active draft', async () => {
  const f = await harness();
  const before = f.render();
  f.choice(before, 'A').props.onClick();
  const delayed = f.calls.at(-1)!;
  assert.equal(f.choice(f.render(), 'B').props.disabled, true);
  f.choice(before, 'B').props.onClick(); // Already queued click before React rerender.
  assert.equal(f.calls.length, 2, 'A second selection must not start while loading A');
  delayed.resolve(f.a);
  await settle();
  await f.submit('A saved note');
  const saving = f.render();
  assert.equal(button(saving, 'Close investigation').props.disabled, true);
  f.choice(before, 'B').props.onClick();
  button(saving, 'Close investigation').props.onClick();
  assert.equal(f.calls.length, 3, 'Selection must not interrupt the mutation');
  assert.ok(text(f.render()).includes('Case A'));
  f.calls.at(-1)!.reject(new Error('Save unavailable'));
  await settle();
  assert.equal(note(f.render()).props.value, 'A saved note');
  f.choice(f.render(), 'B').props.onClick();
  f.calls.at(-1)!.resolve(f.b);
  await settle();
  assert.ok(nodes(f.render()).some((n) => n.type === 'h2' && text(n) === 'Case B'));
});

test('successful note save followed by list failure clears only the saved draft and retains the committed revision', async () => {
  const f = await harness();
  await f.openA();
  const { result } = await f.submit('Saved once');
  const changed = {
    ...f.a,
    revision: 2,
    notes: [{ id: 'n1', at: f.a.updatedAt, author: 'alice', kind: 'note', text: 'Saved once' }],
  };
  f.calls.at(-1)!.resolve(changed);
  await settle();
  assert.equal(f.calls.at(-1)!.path, 'investigations');
  f.calls.at(-1)!.reject(new Error('List unavailable'));
  await result;
  const after = f.render();
  assert.equal(
    note(after).props.value,
    '',
    'A saved note must not remain ready for accidental duplication',
  );
  assert.ok(text(after).includes('Saved once'));
  assert.ok(
    nodes(after).some((n) => n.type === 'ErrorBox' && /saved.*refresh/i.test(n.props.error)),
  );
  await f.submit('Next note');
  assert.equal(f.calls.at(-1)!.body.revision, 2);
  f.calls.at(-1)!.reject(new Error('Cancelled fixture'));
  await settle();
});

test('a failed note save preserves the draft and makes the form editable again', async () => {
  const f = await harness();
  await f.openA();
  const { result } = await f.submit('Do not lose this');
  assert.equal(note(f.render()).props.disabled, true);
  f.calls.at(-1)!.reject(new Error('Revision conflict'));
  await result;
  const after = f.render();
  assert.equal(note(after).props.value, 'Do not lose this');
  assert.equal(note(after).props.disabled, false);
  assert.ok(
    nodes(after).some((n) => n.type === 'ErrorBox' && n.props.error === 'Revision conflict'),
  );
});

test('a queued edit during note submission is not erased by the older successful response', async () => {
  const f = await harness();
  await f.openA();
  const { result } = await f.submit('Sent A');
  note(f.render()).props.onChange({ target: { value: 'Unsent B' } });
  f.calls.at(-1)!.resolve({ ...f.a, revision: 2 });
  await settle();
  f.calls.at(-1)!.resolve({ records: [summarizeCase(f.a)], unreadable: [], total: 1 });
  await result;
  assert.equal(note(f.render()).props.value, 'Unsent B');
});
