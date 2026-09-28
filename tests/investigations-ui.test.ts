import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { summarizeCase, type Investigation } from '../shared/investigation.js';
import { RequestError, creationFailure } from '../src/api.js';

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
                  ? 'export const request=(...args)=>globalThis.fixture.request(...args); export const download=(...args)=>globalThis.fixture.download(...args); export const RequestError=globalThis.fixture.RequestError; export const creationFailure=globalThis.fixture.creationFailure;'
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
async function harness(
  options: {
    created?: Investigation;
    onCreatedConsumed?: () => void;
    initialListError?: Error;
  } = {},
) {
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
  const downloads: Array<{ name: string; value: unknown }> = [];
  const focusCalls: Array<{ method: string; options: unknown }> = [];
  const fixture = {
    RequestError,
    creationFailure,
    download(name: string, value: unknown) {
      downloads.push({ name, value });
    },
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
    const tree = expand({ type: module.exports.Investigations, props: options }, 'root');
    for (const node of nodes(tree))
      if (node.props.tabIndex === -1 && node.props.ref) {
        node.props.ref.current = {
          focus: (options: unknown) => focusCalls.push({ method: 'focus', options }),
          scrollIntoView: (options: unknown) => focusCalls.push({ method: 'scroll', options }),
        };
      }
    effects.splice(0).forEach((effect) => effect());
    return tree as Element;
  };
  const a = record('A'),
    b = record('B');
  render();
  if (options.initialListError) calls[0].reject(options.initialListError);
  else
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
  function refreshDetail() {
    const refresh = nodes(render())
      .filter((n) => n.type === 'button' && text(n).trim() === 'Refresh')
      .at(-1);
    assert.ok(refresh);
    refresh.props.onClick();
  }
  return { render, calls, downloads, focusCalls, a, b, choice, openA, submit, refreshDetail };
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

test('a denied refresh removes the selected investigation and its cached export', async () => {
  const f = await harness();
  f.a.notes.push({
    id: 'evidence',
    at: f.a.updatedAt,
    author: 'alice',
    kind: 'note',
    text: 'Protected evidence',
  });
  await f.openA();
  assert.ok(text(f.render()).includes('Protected evidence'));
  button(f.render(), 'Export investigation').props.onClick();
  assert.equal(f.downloads.length, 1);
  f.refreshDetail();
  f.calls.at(-1)!.reject(new RequestError('Source privilege revoked', 403));
  await settle();
  const denied = f.render();
  assert.ok(
    !text(denied).includes('Protected evidence'),
    'Denied evidence must leave the visible workbench',
  );
  assert.ok(
    !nodes(denied).some((n) => n.type === 'button' && text(n).trim() === 'Export investigation'),
    'A known authorization denial must remove the cached export action',
  );
  assert.ok(
    nodes(denied).some(
      (n) => n.type === 'ErrorBox' && n.props.error === 'Source privilege revoked',
    ),
  );
  assert.equal(
    f.choice(denied, 'A'),
    undefined,
    'The denied summary must also leave the cached list',
  );
});

test('a failed refresh with status 500 retains the investigation and unsaved note', async () => {
  const f = await harness();
  await f.openA();
  note(f.render()).props.onChange({ target: { value: 'Keep my draft' } });
  f.refreshDetail();
  f.calls.at(-1)!.reject(new RequestError('Storage temporarily unavailable', 500));
  await settle();
  assert.equal(note(f.render()).props.value, 'Keep my draft');
  assert.ok(button(f.render(), 'Export investigation'));
});

test('denial of another investigation does not discard the current authorized draft', async () => {
  const f = await harness();
  await f.openA();
  note(f.render()).props.onChange({ target: { value: 'Draft for A' } });
  f.choice(f.render(), 'B').props.onClick();
  f.calls.at(-1)!.reject(new RequestError('Source privilege revoked for B', 403));
  await settle();
  assert.equal(note(f.render()).props.value, 'Draft for A');
  assert.equal(f.choice(f.render(), 'B'), undefined);
  assert.ok(button(f.render(), 'Export investigation'));
});

for (const response of ['forbidden', 'filtered'] as const)
  test('a ' + response + ' investigation listing cannot leave a denied case open', async () => {
    const f = await harness();
    await f.openA();
    button(f.render(), 'Refresh').props.onClick(); // First Refresh belongs to the page header.
    if (response === 'forbidden')
      f.calls.at(-1)!.reject(new RequestError('Operating access revoked', 403));
    else f.calls.at(-1)!.resolve({ records: [summarizeCase(f.b)], unreadable: [], total: 2 });
    await settle();
    const after = f.render();
    assert.ok(
      !nodes(after).some((n) => n.type === 'button' && text(n).trim() === 'Export investigation'),
    );
    assert.equal(f.choice(after, 'A'), undefined);
  });

test('a temporary unreadable listing entry preserves the current unsaved draft', async () => {
  const f = await harness();
  await f.openA();
  note(f.render()).props.onChange({ target: { value: 'Keep draft during storage recovery' } });
  button(f.render(), 'Refresh').props.onClick();
  f.calls.at(-1)!.resolve({ records: [summarizeCase(f.b)], unreadable: ['A'], total: 2 });
  await settle();
  assert.equal(note(f.render()).props.value, 'Keep draft during storage recovery');
});

for (const error of [
  new TypeError('Failed to fetch'),
  new RequestError('Unreadable gateway response', 201),
  new RequestError('Gateway unavailable', 503),
  new RequestError('Title rejected', 400),
])
  test(
    'new investigation preserves its draft and distinguishes uncertain creation from ' +
      error.message,
    async () => {
      const f = await harness();
      button(f.render(), 'New investigation').props.onClick();
      nodes(f.render())
        .find((node) => node.type === 'input' && node.props.maxLength === 160)!
        .props.onChange({ target: { value: 'Review retained draft' } });
      nodes(f.render())
        .find((node) => node.type === 'textarea' && node.props.maxLength === 4000)!
        .props.onChange({ target: { value: 'Investigate the bounded fixture.' } });
      nodes(f.render())
        .find((node) => node.type === 'form')!
        .props.onSubmit({ preventDefault() {} });
      f.calls.at(-1)!.reject(error);
      await settle();
      const tree = f.render(),
        message = nodes(tree).find((node) => node.type === 'ErrorBox')!.props.error;
      if (error instanceof RequestError && error.status === 400)
        assert.equal(message, error.message);
      else assert.match(message, /Check saved investigations before creating again/);
      assert.equal(
        nodes(tree).find((node) => node.type === 'input' && node.props.maxLength === 160)!.props
          .value,
        'Review retained draft',
      );
      assert.equal(button(tree, 'Create investigation').props.disabled, false);
      assert.equal(f.calls.filter((call) => call.body).length, 1, 'No automatic retransmission');
    },
  );

test('a successful new investigation remains selected when its list refresh fails', async () => {
  const f = await harness();
  button(f.render(), 'New investigation').props.onClick();
  nodes(f.render())
    .find((node) => node.type === 'form')!
    .props.onSubmit({ preventDefault() {} });
  const created = record('NewCase');
  f.calls.at(-1)!.resolve(created);
  await settle();
  f.calls.at(-1)!.reject(new RequestError('List unavailable', 500));
  await settle();
  const tree = f.render();
  assert.ok(
    !nodes(tree).some((node) => node.type === 'Modal' && node.props.title === 'New investigation'),
  );
  button(tree, 'Export investigation').props.onClick();
  assert.equal((f.downloads.at(-1)!.value as Investigation).id, created.id);
  assert.equal(f.calls.filter((call) => call.body).length, 1);
});

for (const status of [500, 403])
  test('a one-time created investigation handoff respects list status ' + status, async () => {
    let consumed = 0;
    const created = record('FromProfile');
    const f = await harness({
      created,
      onCreatedConsumed: () => consumed++,
      initialListError: new RequestError('List response', status),
    });
    const tree = f.render();
    assert.equal(consumed, 1);
    if (status === 500) {
      button(tree, 'Export investigation').props.onClick();
      assert.equal((f.downloads.at(-1)!.value as Investigation).id, created.id);
    } else {
      assert.ok(
        !nodes(tree).some(
          (node) => node.type === 'button' && text(node).includes('Export investigation'),
        ),
      );
      assert.ok(
        !text(f.render()).includes(created.title),
        'The old prop cannot re-inject denied data',
      );
    }
  });

test('new-case errors receive focus and scroll once per failed submission, including repeated messages', async () => {
  const f = await harness();
  button(f.render(), 'New investigation').props.onClick();
  nodes(f.render())
    .find((node) => node.type === 'input' && node.props.maxLength === 160)!
    .props.onChange({ target: { value: 'Retained title' } });
  nodes(f.render())
    .find((node) => node.type === 'textarea' && node.props.maxLength === 4000)!
    .props.onChange({ target: { value: 'Retained problem description' } });
  assert.equal(f.focusCalls.length, 0);
  for (let attempt = 1; attempt <= 2; attempt++) {
    nodes(f.render())
      .find((node) => node.type === 'form')!
      .props.onSubmit({ preventDefault() {} });
    f.calls.at(-1)!.reject(new TypeError('Failed to fetch'));
    await settle();
    const tree = f.render();
    assert.equal(f.focusCalls.length, attempt * 2);
    assert.deepEqual(
      f.focusCalls.map((call) => call.method),
      Array.from({ length: attempt }, () => ['focus', 'scroll']).flat(),
    );
    assert.equal((f.focusCalls.at(-2)!.options as any).preventScroll, true);
    assert.equal((f.focusCalls.at(-1)!.options as any).block, 'center');
    const title = nodes(tree).find(
      (node) => node.type === 'input' && node.props.maxLength === 160,
    )!;
    assert.ok(title.props.value.startsWith('Retained title'));
    title.props.onChange({ target: { value: 'Retained title edited' } });
    f.render();
    f.render();
    assert.equal(f.focusCalls.length, attempt * 2, 'Typing and rerender must not steal focus');
  }
});
function visibleNodes(tree: any): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(visibleNodes);
  if (!tree || typeof tree !== 'object' || tree.props?.hidden) return [];
  return [tree, ...visibleNodes(tree.props?.children)];
}
function visibleExport(tree: Element) {
  return visibleNodes(tree).find(
    (node) => node.type === 'button' && text(node).trim() === 'Export investigation',
  );
}

for (const status of [403, 404]) {
  test(`a refused mutation revalidates the same case, then removes evidence and exports on GET ${status}`, async () => {
    const f = await harness();
    await f.openA();
    const staleChoice = f.choice(f.render(), 'B');
    const { result } = await f.submit('Note before refusal');
    f.calls.at(-1)!.reject(new RequestError('Write refused', 403));
    await settle();
    assert.equal(f.calls.at(-1)!.path, 'investigations/A');
    assert.equal(f.calls.at(-1)!.body, undefined, 'The recheck must be a read');
    assert.equal(
      visibleExport(f.render()),
      undefined,
      'Exports must be hidden during revalidation',
    );
    assert.equal(f.choice(f.render(), 'B').props.disabled, true);
    staleChoice.props.onClick();
    assert.equal(f.calls.length, 4, 'Pending revalidation must exclude queued selection');
    f.calls.at(-1)!.reject(new RequestError('Investigation no longer readable', status));
    await result;
    assert.equal(visibleExport(f.render()), undefined);
    assert.ok(!nodes(f.render()).some((node) => node.type === 'h2' && text(node) === 'Case A'));
    assert.equal(f.choice(f.render(), 'A'), undefined);
    assert.ok(f.choice(f.render(), 'B'), 'Unrelated cases remain available');
  });
}

test('a denied linked change can retain an authorized case and draft after its own GET succeeds', async () => {
  const f = await harness();
  await f.openA();
  button(f.render(), 'Related changes').props.onClick();
  const view = f.render();
  nodes(view)
    .find((node) => node.type === 'input' && node.props.maxLength === 36)!
    .props.onChange({ target: { value: '00000000-0000-4000-8000-000000000001' } });
  note(f.render()).props.onChange({ target: { value: 'Link context' } });
  const result = nodes(f.render())
    .find((node) => node.type === 'form')!
    .props.onSubmit({ preventDefault() {} });
  assert.equal(f.calls.at(-1)!.path, 'investigations/A/changes');
  f.calls.at(-1)!.reject(new RequestError('New linked change is forbidden', 403));
  await settle();
  assert.equal(f.calls.at(-1)!.path, 'investigations/A');
  f.calls.at(-1)!.resolve({ ...f.a, revision: 7 });
  await result;
  assert.equal(note(f.render()).props.value, 'Link context');
  assert.ok(visibleExport(f.render()));
  assert.ok(
    nodes(f.render()).some(
      (node) => node.type === 'ErrorBox' && node.props.error === 'New linked change is forbidden',
    ),
  );
  button(f.render(), 'Timeline').props.onClick();
  const pending = await f.submit('New note uses refreshed revision');
  assert.equal(f.calls.at(-1)!.body.revision, 7);
  f.calls.at(-1)!.reject(new RequestError('Fixture stopped', 409));
  await pending.result;
});

test('transient revalidation failure keeps the draft hidden until a successful case read', async () => {
  const f = await harness();
  await f.openA();
  const { result } = await f.submit('Preserved during read outage');
  f.calls.at(-1)!.reject(new RequestError('Mutation refused', 403));
  await settle();
  f.calls.at(-1)!.reject(new RequestError('Temporary read failure', 500));
  await result;
  assert.equal(visibleExport(f.render()), undefined);
  assert.equal(
    note(f.render()).props.value,
    'Preserved during read outage',
    'The hidden editor retains its draft',
  );
  assert.ok(visibleNodes(f.render()).some((node) => node.props?.role === 'status'));
  button(f.render(), 'Check access again').props.onClick();
  assert.equal(f.calls.at(-1)!.path, 'investigations/A');
  f.calls.at(-1)!.resolve(f.a);
  await settle();
  assert.ok(visibleExport(f.render()));
  assert.equal(note(f.render()).props.value, 'Preserved during read outage');
});

test('a quarantined case does not hide a different independently authorized investigation', async () => {
  const f = await harness();
  await f.openA();
  const { result } = await f.submit('A note');
  f.calls.at(-1)!.reject(new RequestError('Mutation refused', 403));
  await settle();
  f.calls.at(-1)!.reject(new RequestError('Read unavailable', 500));
  await result;
  f.choice(f.render(), 'B').props.onClick();
  f.calls.at(-1)!.resolve(f.b);
  await settle();
  assert.ok(visibleExport(f.render()));
  visibleExport(f.render())!.props.onClick();
  assert.equal((f.downloads.at(-1)!.value as Investigation).id, 'B');
});
