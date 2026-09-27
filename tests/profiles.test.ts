import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { profileExport, importProfile, starterProfiles } from '../shared/investigation-profile.js';
import { WorkspaceStore } from '../server/workspace-store.js';
import { ProfileService } from '../server/profile-service.js';
import { InvestigationService } from '../server/investigation-service.js';
import { IrisClient } from '../server/upstream.js';
const actor = { owner: 'alice', instance: 'one', auth: 'private-auth' };
test('profile import accepts configuration data only and refuses executable or arbitrary source fields', () => {
  const exported = profileExport(starterProfiles[0]);
  assert.deepEqual(importProfile(exported), starterProfiles[0]);
  assert.throws(() => importProfile({ ...exported, command: 'rm anything' }));
  assert.throws(() =>
    importProfile({
      ...exported,
      definition: { ...exported.definition, sources: ['/etc/passwd'] },
    }),
  );
  assert.throws(() =>
    importProfile({
      ...exported,
      definition: { ...exported.definition, sources: ['identity', 'identity'] },
    }),
  );
});
test('profile revisions preserve prior definition and cannot rewrite an existing investigation checklist', async () => {
  const store = new WorkspaceStore(await mkdtemp(join(tmpdir(), 'harbor-profile-'))),
    profiles = new ProfileService(store);
  const profile = await profiles.create(actor, starterProfiles[0]);
  const cases = new InvestigationService(store, {} as IrisClient);
  const investigation = await cases.create(
    actor,
    {
      title: 'Incident review',
      description: 'Scope of current issue',
      severity: 'major',
      tags: [],
    },
    profile,
  );
  const updated = await profiles.update(
    actor,
    profile.id,
    profile.revision,
    {
      ...starterProfiles[0],
      title: 'Changed profile',
      steps: [{ title: 'Different step', instruction: 'New instruction', required: true }],
    },
    'Simplified workflow',
  );
  assert.equal(updated.history[0].definition.title, profile.title);
  const existing = await cases.get(actor, investigation.id);
  assert.equal(existing.profile?.revision, 1);
  assert.equal(existing.checklist?.length, starterProfiles[0].steps.length);
  await assert.rejects(
    () => profiles.update(actor, profile.id, profile.revision, starterProfiles[0], 'stale'),
    /changed/,
  );
});
test('required checklist blocks resolution until each item has a recorded disposition', async () => {
  const store = new WorkspaceStore(await mkdtemp(join(tmpdir(), 'harbor-checklist-'))),
    profiles = new ProfileService(store),
    cases = new InvestigationService(store, {} as IrisClient);
  const profile = await profiles.create(actor, {
    title: 'One required check',
    description: 'A repeatable review',
    sources: ['identity'],
    steps: [{ title: 'Confirm target', instruction: 'Read native identity', required: true }],
  });
  const investigation = await cases.create(
    actor,
    { title: 'Review instance', description: 'Check the target', severity: 'minor', tags: [] },
    profile,
  );
  await assert.rejects(
    () => cases.status(actor, investigation.id, investigation.revision, 'resolved', 'done'),
    /required checklist/,
  );
  const checked = await cases.checklist(
    actor,
    investigation.id,
    investigation.revision,
    investigation.checklist![0].id,
    'not applicable',
    'No target change was performed.',
  );
  const resolved = await cases.status(
    actor,
    checked.id,
    checked.revision,
    'resolved',
    'Reviewed scope',
  );
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.checklist![0].updatedBy, 'alice');
  await assert.rejects(
    () =>
      cases.checklist(
        actor,
        resolved.id,
        resolved.revision,
        resolved.checklist![0].id,
        'open',
        'Revisit',
      ),
    /Reopen/,
  );
});
test('projected scans retain summaries instead of capture payloads', async () => {
  const store = new WorkspaceStore(await mkdtemp(join(tmpdir(), 'harbor-projection-')));
  for (const title of ['First', 'Second'])
    await store.create(actor, 'projection-tests', {
      version: 1 as const,
      owner: actor.owner,
      instance: actor.instance,
      title,
      payload: ['bounded fixture data'],
    });
  const listing = await store.scan(actor, 'projection-tests', (record: any) => ({
    id: record.id,
    updatedAt: record.updatedAt,
    title: record.title,
  }));
  assert.equal(listing.records.length, 2);
  assert.ok(!JSON.stringify(listing).includes('bounded fixture data'));
});
