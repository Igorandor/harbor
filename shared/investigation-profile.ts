import { z } from 'zod';
import { diagnosticSources } from './diagnostics.js';
// At most 46,320 definition UTF-16 units, each requiring at most six JSON bytes,
// plus the bounded source names, envelope and pretty-print structure (<22 KB).
export const profileFileByteLimit = 300_000;
// Matches the gateway's 256 KiB JSON limit; imports create a bare definition.
export const profileCreateByteLimit = 256 * 1024;
export const profileStepSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    instruction: z.string().trim().min(1).max(2000),
    required: z.boolean(),
  })
  .strict();
export const profileInputSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(1).max(3000),
    sources: z
      .array(
        z.enum([
          'identity',
          'health',
          'capacity',
          'processes',
          'tasks',
          'history',
          'journals',
          'messages',
        ]),
      )
      .min(1)
      .max(8)
      .refine((value) => new Set(value).size === value.length, 'Choose each source once.'),
    steps: z.array(profileStepSchema).min(1).max(20),
  })
  .strict();
export type ProfileDefinition = z.infer<typeof profileInputSchema>;
export type ProfileHistory = {
  at: string;
  revision: number;
  reason: string;
  definition: ProfileDefinition;
};
export type InvestigationProfile = ProfileDefinition & {
  version: 1;
  id: string;
  owner: string;
  instance: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'archived';
  history: ProfileHistory[];
};
export type ProfileSummary = Pick<
  InvestigationProfile,
  'id' | 'title' | 'description' | 'revision' | 'createdAt' | 'updatedAt' | 'status' | 'sources'
> & { stepCount: number; requiredCount: number };
export function profileSummary(profile: InvestigationProfile): ProfileSummary {
  return {
    id: profile.id,
    title: profile.title,
    description: profile.description,
    revision: profile.revision,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    status: profile.status,
    sources: profile.sources,
    stepCount: profile.steps.length,
    requiredCount: profile.steps.filter((step) => step.required).length,
  };
}
export function profileExport(profile: ProfileDefinition) {
  return {
    format: 'harbor-investigation-profile',
    version: 1,
    definition: profileInputSchema.parse({
      title: profile.title,
      description: profile.description,
      sources: profile.sources,
      steps: profile.steps,
    }),
  };
}
export function importProfile(value: unknown): ProfileDefinition {
  const definition = z
    .object({
      format: z.literal('harbor-investigation-profile'),
      version: z.literal(1),
      definition: profileInputSchema,
    })
    .strict()
    .parse(value).definition;
  if (new TextEncoder().encode(JSON.stringify(definition)).byteLength > profileCreateByteLimit)
    throw new Error(
      'This profile exceeds the 256 KiB request limit after JSON encoding. Shorten its text before importing.',
    );
  return definition;
}
export const starterProfiles: ProfileDefinition[] = [
  {
    title: 'Investigate a service interruption',
    description:
      'Record the scope of the interruption, collect current instance data, and document the checks used to confirm recovery.',
    sources: ['identity', 'health', 'capacity', 'processes', 'messages'],
    steps: [
      {
        title: 'Record affected services and start time',
        instruction:
          'Identify the affected route or workload and when the interruption was first observed. Record the source of the report.',
        required: true,
      },
      {
        title: 'Capture current runtime data',
        instruction:
          'Collect the selected sources before changing configuration. Record any unavailable source and its impact on the investigation.',
        required: true,
      },
      {
        title: 'Inspect the relevant application and process',
        instruction:
          'Use Application inspector and Runtime analysis to check route configuration, execution state and resource availability.',
        required: false,
      },
      {
        title: 'Record changes and recovery checks',
        instruction:
          'Link administrative change records. Describe a separate check of the affected service after the intervention.',
        required: true,
      },
      {
        title: 'Document follow-up work',
        instruction: 'Record remaining uncertainty and any work needed to prevent recurrence.',
        required: true,
      },
    ],
  },
  {
    title: 'Investigate a scheduled task',
    description:
      'Check native task configuration, scheduling state and execution history without assuming that an accepted run request succeeded.',
    sources: ['identity', 'tasks', 'history', 'messages'],
    steps: [
      {
        title: 'Identify the task and expected execution',
        instruction: 'Record the native task ID, task name, intended schedule and expected result.',
        required: true,
      },
      {
        title: 'Inspect authoritative scheduling state',
        instruction:
          'Use Task center to read the current task information. Do not rely on a cached list suspension flag.',
        required: true,
      },
      {
        title: 'Review recent execution records',
        instruction:
          'Record the relevant history rows, time basis, completion status and any error details.',
        required: true,
      },
      {
        title: 'Verify a later execution or explain the limit',
        instruction:
          'If scheduling or task configuration changed, inspect a subsequent execution. Record why a later execution could not be checked if it is unavailable.',
        required: true,
      },
    ],
  },
  {
    title: 'Review a capacity concern',
    description:
      'Compare resource samples and distinguish current host counters from stale monitor data or container quotas.',
    sources: ['identity', 'capacity', 'health', 'processes', 'journals'],
    steps: [
      {
        title: 'Record the capacity symptom',
        instruction:
          'Describe the observed delay, space warning or memory concern, including its time and affected workload.',
        required: true,
      },
      {
        title: 'Collect two runtime samples',
        instruction:
          'Use Runtime analysis to collect an interval. Select relevant processes and compare only matching native identities.',
        required: true,
      },
      {
        title: 'Check storage and journal context',
        instruction:
          'Inspect the manager filesystem, database storage and journal metadata. Host disk figures alone do not describe each IRIS storage allocation.',
        required: false,
      },
      {
        title: 'Record interpretation and next action',
        instruction:
          'Explain which observations support the conclusion and which counters or sources remain unavailable.',
        required: true,
      },
    ],
  },
];
export function sourceTitle(id: string) {
  return diagnosticSources.find((source) => source.id === id)?.title ?? id;
}
