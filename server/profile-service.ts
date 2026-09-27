import { ApiError } from './upstream.js';
import { WorkspaceStore, type WorkspaceIdentity } from './workspace-store.js';
import {
  profileInputSchema,
  profileSummary,
  type InvestigationProfile,
  type ProfileDefinition,
} from '../shared/investigation-profile.js';
export class ProfileService {
  constructor(private store: WorkspaceStore) {}
  async list(actor: WorkspaceIdentity) {
    return this.store.scan(actor, 'investigation-profiles', (record: InvestigationProfile) =>
      profileSummary(record),
    );
  }
  async create(actor: WorkspaceIdentity, input: unknown) {
    const definition = profileInputSchema.parse(input);
    return this.store.create(actor, 'investigation-profiles', {
      ...definition,
      version: 1 as const,
      owner: actor.owner,
      instance: actor.instance,
      status: 'active' as const,
      history: [],
    });
  }
  async get(actor: WorkspaceIdentity, id: string) {
    const profile = await this.store.read<InvestigationProfile>(
      actor,
      'investigation-profiles',
      id,
    );
    profileInputSchema.parse({
      title: profile.title,
      description: profile.description,
      sources: profile.sources,
      steps: profile.steps,
    });
    if (!Array.isArray(profile.history) || !['active', 'archived'].includes(profile.status))
      throw new ApiError(500, 'The stored profile is invalid. Preserve it for inspection.');
    return profile;
  }
  async update(
    actor: WorkspaceIdentity,
    id: string,
    revision: number,
    input: unknown,
    reason: string,
  ) {
    const definition = profileInputSchema.parse(input);
    if (!reason.trim() || reason.length > 2000)
      throw new ApiError(400, 'Describe why this profile is changing.');
    return this.store.exclusive(actor, 'investigation-profiles', id, async () => {
      const profile = await this.get(actor, id);
      if (profile.revision !== revision)
        throw new ApiError(409, 'The profile changed. Refresh before editing.');
      if (profile.status !== 'active')
        throw new ApiError(409, 'Restore this profile before editing it.');
      const previous: ProfileDefinition = {
        title: profile.title,
        description: profile.description,
        sources: profile.sources,
        steps: profile.steps,
      };
      const now = new Date().toISOString();
      const updated: InvestigationProfile = {
        ...profile,
        ...definition,
        revision: revision + 1,
        updatedAt: now,
        history: [
          ...profile.history,
          { at: now, revision, reason: reason.trim(), definition: previous },
        ].slice(-5),
      };
      return this.store.write(updated, 'investigation-profiles', revision);
    });
  }
  async archive(actor: WorkspaceIdentity, id: string, revision: number, archived: boolean) {
    return this.store.exclusive(actor, 'investigation-profiles', id, async () => {
      const profile = await this.get(actor, id);
      if (profile.revision !== revision)
        throw new ApiError(409, 'The profile changed. Refresh before changing its status.');
      const status = archived ? 'archived' : 'active';
      if (profile.status === status)
        throw new ApiError(409, 'The profile already has this status.');
      profile.status = status;
      profile.revision++;
      profile.updatedAt = new Date().toISOString();
      return this.store.write(profile, 'investigation-profiles', revision);
    });
  }
}
