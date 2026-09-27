import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { entities } from '../shared/catalog';

// Actual components and API wrapper, with deterministic React state and HTTP responses.
const compiled = build({
  stdin: {
    contents:
      'export { Editor } from "./src/components/Editor"; export { Changes } from "./src/pages/Changes"; export { executeChange, RequestError } from "./src/api";',
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  plugins: [
    {
      name: 'execution-fixture',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(react(?:\/jsx-runtime)?|lucide-react|(?:\.\/|\.\.\/components\/)(?:ui|DataView|StructuredField|ChangeImpact))$/,
          },
          (args) => ({ path: args.path, namespace: 'fixture' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          loader: 'js',
          contents:
            args.path === 'react'
              ? 'export const useState=(...a)=>fixture.useState(...a); export const useRef=(...a)=>fixture.useRef(...a); export const useEffect=(...a)=>fixture.useEffect(...a);'
              : args.path === 'react/jsx-runtime'
                ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="Fragment";'
                : 'export const ' +
                  (args.path === 'lucide-react'
                    ? [
                        'ArrowLeft',
                        'ArrowRight',
                        'Check',
                        'Plus',
                        'Trash2',
                        'Download',
                        'RefreshCw',
                        'Search',
                        'X',
                        'CheckCircle2',
                        'AlertTriangle',
                        'Clock3',
                      ]
                    : [
                        'Modal',
                        'ErrorBox',
                        'Loading',
                        'PageHeader',
                        'DataValue',
                        'StructuredField',
                        'ChangeImpact',
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
function button(tree: any, label: string) {
  const node = nodes(tree).find((n) => n.type === 'button' && text(n).trim() === label);
  assert.ok(node, label);
  return node;
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function ticket(id = 'ticket-A', state = 'prepared') {
  return {
    version: 1,
    id,
    revision: 1,
    owner: 'Fixture',
    instance: 'Fixture',
    title: 'Change role',
    target: 'ReviewRole',
    path: '/v2/security/role',
    method: 'PUT',
    query: { name: 'ReviewRole' },
    state,
    fields: [{ name: 'Description', before: 'Original', requested: 'A', readable: true }],
    events: [],
    createdAt: '2026-09-27T10:00:00Z',
    updatedAt: '2026-09-27T10:00:00Z',
    expiresAt: '2026-09-27T11:00:00Z',
    explanation: state === 'verified' ? 'Readback matches.' : 'Prepared request.',
    verification: 'fields',
    ...(state === 'verified' ? { nativeStatus: 200 } : {}),
  };
}
async function harness(component: 'Editor' | 'Changes') {
  const states: any[] = [],
    effects = new Set<number>(),
    calls: { path: string; body: any }[] = [];
  const responses: Array<Response | Error | Promise<Response>> = [];
  let cursor = 0,
    saved = 0;
  const fixture = {
    useState(initial: any) {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [
        states[i],
        (value: any) => {
          states[i] = typeof value === 'function' ? value(states[i]) : value;
        },
      ];
    },
    useRef(initial: any) {
      const i = cursor++;
      return (states[i] ??= { current: initial });
    },
    useEffect(callback: () => void) {
      const i = cursor++;
      if (!effects.has(i)) {
        effects.add(i);
        callback();
      }
    },
  };
  const module = { exports: {} as any };
  runInNewContext((await compiled).outputFiles[0].text, {
    module,
    exports: module.exports,
    fixture,
    TypeError,
    Event,
    CustomEvent,
    window: new EventTarget(),
    fetch: async (path: string, init: RequestInit) => {
      calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const next = responses.shift();
      assert.ok(next, 'Unexpected request: ' + path);
      if (next instanceof Error) throw next;
      return next;
    },
  });
  const render = () => {
    cursor = 0;
    return module.exports[component]({
      entity: entities.roles,
      identity: 'ReviewRole',
      initial: { Description: 'Original' },
      onClose() {},
      onSaved() {
        saved++;
      },
    });
  };
  return { render, calls, responses, api: module.exports, saved: () => saved };
}
async function reviewedEditor() {
  const f = await harness('Editor');
  nodes(f.render())
    .find((n) => n.props?.name === 'Description')
    .props.onChange('A');
  f.responses.push(Response.json(ticket()));
  nodes(f.render())
    .find((n) => n.type === 'form')
    .props.onSubmit({ preventDefault() {} });
  await settle();
  return f;
}
async function selectedChange() {
  const f = await harness('Changes');
  f.responses.push(
    Response.json({ records: [ticket(), ticket('ticket-B')], unreadable: [], total: 2 }),
  );
  f.render();
  await settle();
  f.responses.push(Response.json(ticket()));
  nodes(f.render())
    .find((n) => n.props?.className?.startsWith('record-choice'))
    .props.onClick();
  await settle();
  nodes(f.render())
    .find((n) => n.type === 'input' && n.props.autoComplete === 'off')
    .props.onChange({ target: { value: 'ReviewRole' } });
  return f;
}
for (const [name, response] of [
  ['transport', () => new TypeError('Failed to fetch')],
  ['unreadable success', () => new Response('invalid', { status: 200 })],
  ['gateway failure', () => Response.json({ error: 'Gateway unavailable' }, { status: 503 })],
] as const) {
  test(`editor exposes journal recovery after ${name}, preserves draft, and never prepares or executes automatically`, async () => {
    const f = await reviewedEditor();
    f.responses.push(response());
    await button(f.render(), 'Apply changes').props.onClick();
    const failed = f.render();
    assert.match(
      nodes(failed).find((n) => n.type === 'ErrorBox').props.error,
      /may have reached IRIS.*ticket-A.*Change history/,
    );
    assert.equal(button(failed, 'Apply changes').props.disabled, true);
    assert.match(text(failed), /ticket-A/);
    f.responses.push(Response.json(ticket('ticket-A', 'verified')));
    button(failed, 'Read change record').props.onClick();
    await settle();
    assert.match(text(f.render()), /Stored state:.*verified.*Readback matches/);
    button(f.render(), 'Back').props.onClick();
    await settle();
    const back = f.render();
    assert.equal(nodes(back).find((n) => n.props?.name === 'Description').props.value, 'A');
    assert.equal(button(back, 'Review changes').props.disabled, true);
    nodes(back)
      .find((n) => n.type === 'form')
      .props.onSubmit({ preventDefault() {} });
    await settle();
    assert.deepEqual(
      f.calls.map((c) => c.path),
      ['/api/changes', '/api/changes/ticket-A/execute', '/api/changes/ticket-A'],
    );
    assert.equal(f.saved(), 0);
  });
  test(`Change history requires a fresh record read after ${name}`, async () => {
    const f = await selectedChange();
    f.responses.push(response());
    button(f.render(), 'Execute reviewed change').props.onClick();
    await settle();
    let view = f.render();
    assert.match(text(view), /awaiting confirmation/);
    assert.match(text(view), /Awaiting record refresh/);
    assert.ok(!text(view).includes('Not sent'));
    assert.ok(!text(view).includes('Execute reviewed change'));
    f.responses.push(Response.json({ error: 'Read unavailable' }, { status: 500 }));
    button(view, 'Refresh record').props.onClick();
    await settle();
    assert.match(text(f.render()), /awaiting confirmation/);
    f.responses.push(Response.json(ticket('ticket-A', 'verified')));
    button(f.render(), 'Refresh record').props.onClick();
    await settle();
    view = f.render();
    assert.ok(!text(view).includes('awaiting confirmation'));
    assert.match(text(view), /Readback matches/);
    assert.equal(f.calls.filter((c) => c.path.endsWith('/execute')).length, 1);
  });
}
test('specific execution 409 is retained and still requires a fresh record before another history action', async () => {
  const f = await selectedChange();
  f.responses.push(
    Response.json({ error: 'The target changed. Refresh before saving.' }, { status: 409 }),
  );
  button(f.render(), 'Execute reviewed change').props.onClick();
  await settle();
  assert.equal(
    nodes(f.render()).find((n) => n.type === 'ErrorBox').props.error,
    'The target changed. Refresh before saving.',
  );
  assert.ok(!text(f.render()).includes('Execute reviewed change'));
  f.responses.push(Response.json(ticket()));
  button(f.render(), 'Refresh record').props.onClick();
  await settle();
  assert.equal(
    button(f.render(), 'Execute reviewed change').props.disabled,
    true,
    'Fresh confirmation is required',
  );
});
test('a returned unresolved record keeps its concrete explanation and journal guidance', async () => {
  const f = await harness('Changes');
  f.responses.push(
    Response.json({ ...ticket('ticket-A', 'uncertain'), explanation: 'Readback unavailable.' }),
  );
  await assert.rejects(
    f.api.executeChange(ticket()),
    (error: any) =>
      error.status === 409 &&
      error.message ===
        'Readback unavailable. Open Change history to inspect or reconcile record ticket-A.',
  );
});
test('successful execution followed by list 500 remains a known result', async () => {
  const f = await selectedChange();
  f.responses.push(
    Response.json(ticket('ticket-A', 'verified')),
    Response.json({ error: 'List unavailable' }, { status: 500 }),
  );
  button(f.render(), 'Execute reviewed change').props.onClick();
  await settle();
  const view = f.render();
  assert.match(text(view), /Readback matches/);
  assert.ok(!text(view).includes('awaiting confirmation'));
  assert.match(
    nodes(view).find((n) => n.type === 'ErrorBox').props.error,
    /record was received.*list could not refresh/,
  );
  assert.equal(button(view, 'Export record').props.disabled, false);
});
test('pending execute blocks queued selection and close until recovery belongs to its original record', async () => {
  const f = await selectedChange();
  let reject!: (error: Error) => void;
  f.responses.push(
    new Promise((_resolve, decline) => {
      reject = decline;
    }),
  );
  const before = f.render(),
    choices = nodes(before).filter((n) => n.props?.className?.startsWith('record-choice'));
  button(before, 'Execute reviewed change').props.onClick();
  choices[1].props.onClick();
  nodes(before)
    .find((n) => n.props?.['aria-label'] === 'Close change details')
    .props.onClick();
  assert.equal(f.calls.filter((c) => c.path === '/api/changes/ticket-B').length, 0);
  reject(new TypeError('Failed to fetch'));
  await settle();
  assert.match(text(f.render()), /ticket-A/);
  assert.match(text(f.render()), /awaiting confirmation/);
});

test('editor preserves a specific authorization response and offers read-only journal recovery', async () => {
  const f = await reviewedEditor();
  f.responses.push(
    Response.json({ error: 'Current source privilege is required.' }, { status: 403 }),
  );
  await button(f.render(), 'Apply changes').props.onClick();
  const view = f.render();
  assert.equal(
    nodes(view).find((n) => n.type === 'ErrorBox').props.error,
    'Current source privilege is required.',
  );
  assert.ok(!text(view).includes('may have reached IRIS'));
  assert.ok(button(view, 'Read change record'));
  assert.equal(button(view, 'Apply changes').props.disabled, true);
});

test('execute wrapper retains current 401 and session-change 409 explanations', async () => {
  for (const status of [401, 409]) {
    const f = await harness('Changes');
    const message =
      status === 401 ? 'Sign in again.' : 'The session changed. Sign in again before continuing.';
    f.responses.push(Response.json({ error: message }, { status }));
    await assert.rejects(
      f.api.executeChange(ticket()),
      (error: any) => error.status === status && error.message === message,
    );
  }
});

test('change detail never presents an earlier retained field value as the current readback', async () => {
  const f = await selectedChange();
  const record = {
    ...ticket('ticket-A', 'uncertain'),
    nativeStatus: 200,
    fields: [
      {
        name: 'Description',
        before: 'Before',
        requested: 'After',
        readable: true,
        observed: 'Earlier readback',
        matches: false,
      },
    ],
    observation: { Description: 'Earlier readback' },
    evidenceOmissions: [
      { source: 'observation', bytes: 4050018, at: '2026-09-27T12:00:00Z', previousRetained: true },
      {
        source: 'field observations',
        bytes: 4050004,
        at: '2026-09-27T12:00:00Z',
        previousRetained: true,
      },
    ],
  };
  f.responses.push(Response.json(record));
  await button(f.render(), 'Refresh record').props.onClick();
  await settle();
  const rendered = f.render();
  assert.match(text(rendered), /Current value not retained/);
  assert.match(text(rendered), /Does not match/);
  const table = nodes(rendered).find((node) => node.type === 'table');
  assert.ok(
    !nodes(table).some(
      (node) => node.type === 'DataValue' && node.props.value === 'Earlier readback',
    ),
  );
  const raw = nodes(rendered).find(
    (node) => node.type === 'details' && text(node).includes('Native response and observation'),
  );
  assert.match(text(raw), /earlier saved evidence, not the current response or readback/);
  const payload = nodes(raw).find((node) => node.type === 'DataValue').props.value;
  assert.equal(payload.observed.Description, 'Earlier readback');
  assert.equal(payload.evidenceOmissions[0].previousRetained, true);
  assert.equal(button(rendered, 'Export record').props.disabled, false);
});
