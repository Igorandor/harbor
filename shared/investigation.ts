import { z } from 'zod';
import { diagnosticSources, type DiagnosticBundle, type DiagnosticId } from './diagnostics.js';
import { reviewDispositions, type EvidenceReview } from './evidence-comparison.js';
export const caseSeverity = ['information', 'minor', 'major', 'critical'] as const;
export const caseStatus = ['open', 'investigating', 'monitoring', 'resolved', 'archived'] as const;
export const caseInput = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(1).max(4000),
    severity: z.enum(caseSeverity),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  })
  .strict();
const storedId = z.string().min(1);
const storedTime = z.iso.datetime();
const storedSource = z.enum(diagnosticSources.map((source) => source.id));
const storedDecision = z
  .object({
    differenceId: storedId,
    disposition: z.enum(reviewDispositions),
    note: z.string(),
    at: storedTime,
    author: z.string(),
  })
  .passthrough();
const storedCaseFields = caseInput
  .extend({
    tags: caseInput.shape.tags.removeDefault(),
    status: z.enum(caseStatus),
    resolution: z.string().optional(),
    notes: z.array(
      z
        .object({
          id: storedId,
          at: storedTime,
          author: z.string(),
          kind: z.enum(['note', 'status', 'capture', 'link']),
          text: z.string(),
          captureId: storedId.optional(),
          changeId: storedId.optional(),
        })
        .passthrough(),
    ),
    captures: z.array(
      z
        .object({
          id: storedId,
          title: z.string(),
          sources: z.array(storedSource),
          capturedBy: z.string(),
          bundle: z
            .object({
              version: z.literal(1),
              instance: z.string(),
              startedAt: storedTime,
              finishedAt: storedTime,
              limits: z.array(z.string()),
              sections: z.array(
                z
                  .object({
                    id: storedSource,
                    title: z.string(),
                    path: z.string(),
                    observedAt: storedTime,
                    elapsedMs: z.number().nonnegative(),
                    status: z.enum(['collected', 'unavailable', 'too large', 'pending']),
                    httpStatus: z.number().int(),
                    data: z.unknown().optional(),
                    notice: z.string().optional(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
    linkedChanges: z.array(storedId),
    profile: z
      .object({
        id: storedId,
        revision: z.number().int().positive(),
        title: z.string(),
        sources: z.array(storedSource),
      })
      .passthrough()
      .optional(),
    checklist: z
      .array(
        z
          .object({
            id: storedId,
            title: z.string(),
            instruction: z.string(),
            required: z.boolean(),
            state: z.enum(['open', 'completed', 'not applicable']),
            note: z.string().optional(),
            updatedAt: storedTime.optional(),
            updatedBy: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    evidenceReviews: z
      .array(
        z
          .object({
            id: storedId,
            // A structurally readable future version still reaches the existing
            // unsupported-comparison response when the operator tries to change it.
            comparisonVersion: z.number().int().positive(),
            title: z.string(),
            beforeId: storedId,
            afterId: storedId,
            createdAt: storedTime,
            createdBy: z.string(),
            updatedAt: storedTime,
            decisions: z.array(storedDecision),
            history: z.array(storedDecision.extend({ eventId: storedId })),
            conclusion: z
              .object({
                text: z.string(),
                at: storedTime,
                author: z.string(),
                limitsAcknowledged: z.literal(true),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

/** Validate consumed structure, retaining original records and arbitrary native data. */
export function validStoredCase(value: Investigation): boolean {
  return storedCaseFields.safeParse(value).success;
}
export type CaseNote = {
  id: string;
  at: string;
  author: string;
  kind: 'note' | 'status' | 'capture' | 'link';
  text: string;
  captureId?: string;
  changeId?: string;
};
export type CaseCapture = {
  id: string;
  title: string;
  sources: DiagnosticId[];
  capturedBy: string;
  bundle: DiagnosticBundle;
};
export type Investigation = z.infer<typeof caseInput> & {
  version: 1;
  id: string;
  owner: string;
  instance: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  status: (typeof caseStatus)[number];
  resolution?: string;
  notes: CaseNote[];
  captures: CaseCapture[];
  linkedChanges: string[];
  evidenceReviews?: EvidenceReview[];
  profile?: { id: string; revision: number; title: string; sources: DiagnosticId[] };
  checklist?: Array<{
    id: string;
    title: string;
    instruction: string;
    required: boolean;
    state: 'open' | 'completed' | 'not applicable';
    note?: string;
    updatedAt?: string;
    updatedBy?: string;
  }>;
};
export type CaseSummary = Omit<
  Investigation,
  'captures' | 'notes' | 'checklist' | 'evidenceReviews'
> & {
  captureCount: number;
  noteCount: number;
  incompleteSources: number;
  openRequiredItems: number;
  reviewCount: number;
};
export function summarizeCase(value: Investigation): CaseSummary {
  if (!validStoredCase(value)) throw new Error('Invalid stored investigation fields.');
  const { captures, notes, checklist, evidenceReviews, ...rest } = value;
  return {
    ...rest,
    captureCount: captures.length,
    noteCount: notes.length,
    reviewCount: evidenceReviews?.length ?? 0,
    openRequiredItems:
      checklist?.filter((item) => item.required && item.state === 'open').length ?? 0,
    incompleteSources: captures.reduce(
      (n, c) => n + c.bundle.sections.filter((s) => s.status !== 'collected').length,
      0,
    ),
  };
}
