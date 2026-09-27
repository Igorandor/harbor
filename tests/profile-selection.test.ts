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

function importFile(
  ui: Awaited<ReturnType<typeof harness>>,
  file: { size: number; text: () => Promise<string> },
) {
  ui.page()
    .find((node) => node.type === 'input' && node.props.type === 'file')
    .props.onChange({ target: { files: [file], value: 'chosen.json' } });
}
function editorTitle(ui: Awaited<ReturnType<typeof harness>>) {
  return ui.edit().find((node) => node.type === 'input' && node.props.maxLength === 120);
}
function profileFile(definition: profileModel.ProfileDefinition) {
  const text = JSON.stringify(profileModel.profileExport(definition), null, 2);
  return { size: Buffer.byteLength(text), text: async () => text };
}

test('an older file import cannot turn a subsequently opened edit into creation', async () => {
  const read = deferred<string>();
  const ui = await harness(async (_path, body) =>
    body ? { ...bravo, ...body.definition, revision: 8 } : bravo,
  );
  ui.select(bravo.title);
  await tick();
  importFile(ui, { size: 200, text: () => read.promise });
  assert.equal(ui.button('Edit profile').props.disabled, false);
  ui.button('Edit profile').props.onClick();
  editorTitle(ui).props.onChange({ target: { value: 'Retained operator draft' } });
  read.resolve(JSON.stringify(profileModel.profileExport(profileModel.starterProfiles[0])));
  await tick();
  assert.equal(ui.edit()[0].props.title, 'Edit investigation profile');
  assert.equal(editorTitle(ui).props.value, 'Retained operator draft');
  await ui.save();
  const writes = ui.calls.filter((call) => call.body !== undefined);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, route(bravo.id) + '/revise');
  assert.equal(writes[0].body.revision, bravo.revision);
  assert.equal(writes[0].body.definition.title, 'Retained operator draft');
});

test('new, duplicate and template workflows discard obsolete file failures and completion after close', async () => {
  for (const action of ['New profile', 'Duplicate', profileModel.starterProfiles[0].title]) {
    for (const failure of [false, true]) {
      const read = deferred<string>(),
        ui = await harness(async () => bravo);
      ui.select(bravo.title);
      await tick();
      importFile(ui, { size: 200, text: () => read.promise });
      ui.button(action, action !== profileModel.starterProfiles[0].title).props.onClick();
      editorTitle(ui).props.onChange({ target: { value: 'Newer draft' } });
      const editor = ui.edit();
      // Closing this real modal is available before a save starts.
      editor[0].props.onClose();
      if (failure) read.reject(new Error('Obsolete file failure'));
      else
        read.resolve(JSON.stringify(profileModel.profileExport(profileModel.starterProfiles[1])));
      await tick();
      assert.ok(!ui.page().some((node) => node.type?.name === 'ProfileEditor'));
      assert.equal(ui.error(), undefined);
      assert.equal(ui.calls.filter((call) => call.body !== undefined).length, 0);
    }
  }
});

test('the latest chosen import owns the definition and an older file cannot replace it', async () => {
  const earlier = deferred<string>(),
    ui = await harness(async () => bravo);
  importFile(ui, { size: 200, text: () => earlier.promise });
  const newer = { ...profileModel.starterProfiles[1], title: 'Latest chosen file' };
  importFile(ui, profileFile(newer));
  await tick();
  assert.equal(editorTitle(ui).props.value, newer.title);
  earlier.resolve(JSON.stringify(profileModel.profileExport(profileModel.starterProfiles[0])));
  await tick();
  const editor = ui.page().find((node) => node.type?.name === 'ProfileEditor');
  assert.equal(editor.props.initial.title, newer.title);
  assert.equal(editorTitle(ui).props.value, newer.title);
});

test('a valid Unicode export larger than the old file cap imports and submits the same definition', async () => {
  const definition: profileModel.ProfileDefinition = {
    title: 'Unicode checklist',
    description: 'Internationalized instructions',
    sources: ['identity'],
    steps: Array.from({ length: 20 }, (_, i) => ({
      title: 'Check ' + (i + 1),
      instruction: 'ż'.repeat(2000),
      required: true,
    })),
  };
  const ui = await harness(async (_path, body) => ({ ...bravo, ...body })),
    file = profileFile(definition);
  assert.ok(file.size > 64000 && file.size < profileModel.profileFileByteLimit);
  importFile(ui, file);
  await tick();
  assert.equal(editorTitle(ui).props.value, definition.title);
  ui.edit()
    .find((node) => node.type === 'form')
    .props.onSubmit({ preventDefault() {} });
  await tick();
  const writes = ui.calls.filter((call) => call.body !== undefined);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'investigation-profiles');
  assert.deepEqual(writes[0].body, definition);
  assert.ok(
    Buffer.byteLength(JSON.stringify(writes[0].body)) <= profileModel.profileCreateByteLimit,
  );
});

function escapedDefinition(): profileModel.ProfileDefinition {
  return {
    title: '\u0001'.repeat(120),
    description: '\u0001'.repeat(3000),
    sources: [
      'identity',
      'health',
      'capacity',
      'processes',
      'tasks',
      'history',
      'journals',
      'messages',
    ],
    steps: Array.from({ length: 20 }, () => ({
      title: '\u0001'.repeat(160),
      instruction: '\u0001'.repeat(2000),
      required: false,
    })),
  };
}
function atWireSize(target: number) {
  const definition = escapedDefinition();
  let reduce = Buffer.byteLength(JSON.stringify(definition)) - target;
  // Replacing an escaped control unit (6 bytes) with A/é/中 removes 5/4/3 bytes.
  const reductions: string[] = [];
  while (reduce > 7) {
    reductions.push('A');
    reduce -= 5;
  }
  const final: Record<number, string> = { 0: '', 3: '中', 4: 'é', 5: 'A', 6: '中中', 7: '中é' };
  assert.ok(Object.hasOwn(final, reduce));
  reductions.push(final[reduce]);
  let replacements = reductions.join('');
  for (const step of definition.steps) {
    const prefix = replacements.slice(0, step.instruction.length);
    step.instruction = prefix + step.instruction.slice(prefix.length);
    replacements = replacements.slice(prefix.length);
  }
  assert.equal(replacements, '');
  assert.equal(Buffer.byteLength(JSON.stringify(definition)), target);
  return definition;
}

test('escaped exports fit the derived file bound and exact compact create boundary is enforced', async () => {
  const maximum = escapedDefinition(),
    worstFile = profileFile(maximum);
  assert.ok(
    worstFile.size <= profileModel.profileFileByteLimit,
    'Maximum schema strings plus JSON escaping and indentation must fit',
  );
  assert.ok(Buffer.byteLength(JSON.stringify(maximum)) > profileModel.profileCreateByteLimit);
  for (const excess of [0, 1]) {
    const definition = atWireSize(profileModel.profileCreateByteLimit + excess);
    const ui = await harness(async () => bravo);
    importFile(ui, profileFile(definition));
    await tick();
    if (excess) {
      assert.match(ui.error()!, /256 KiB request limit after JSON encoding/);
      assert.ok(!ui.page().some((node) => node.type?.name === 'ProfileEditor'));
    } else {
      assert.equal(ui.error(), undefined);
      assert.deepEqual(
        ui.page().find((node) => node.type?.name === 'ProfileEditor').props.initial,
        definition,
      );
    }
    assert.equal(
      ui.calls.filter((call) => call.body !== undefined).length,
      0,
      'Import never saves automatically',
    );
  }
});

test('oversized files are rejected before reading and malformed import envelopes cannot open an editor', async () => {
  const ui = await harness(async () => bravo);
  let reads = 0;
  importFile(ui, {
    size: profileModel.profileFileByteLimit + 1,
    text: async () => {
      reads++;
      return '{}';
    },
  });
  await tick();
  assert.equal(reads, 0);
  assert.match(ui.error()!, /limited to 300 KB/);
  for (const contents of [
    '{',
    JSON.stringify({ ...profileModel.profileExport(profileModel.starterProfiles[0]), version: 2 }),
  ]) {
    importFile(ui, { size: Buffer.byteLength(contents), text: async () => contents });
    await tick();
    assert.match(ui.error()!, /Could not import/);
    assert.ok(!ui.page().some((node) => node.type?.name === 'ProfileEditor'));
  }
});
