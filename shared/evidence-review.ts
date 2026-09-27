import { z } from 'zod';
import { reviewDispositions } from './evidence-comparison.js';

const revision = z.number().int().positive();
export const evidenceReviewInput = z
  .object({
    revision,
    title: z.string().trim().min(3).max(120),
    beforeId: z.string().uuid(),
    afterId: z.string().uuid(),
  })
  .strict();
export const evidenceDecisionInput = z
  .object({
    revision,
    differenceId: z.string().min(1).max(128),
    disposition: z.enum(reviewDispositions),
    note: z.string().trim().min(1).max(2000),
  })
  .strict();
export const evidenceConclusionInput = z
  .object({
    revision,
    text: z.string().trim().min(3).max(4000),
    acknowledgeLimits: z.literal(true),
  })
  .strict();
export const evidenceReopenInput = z
  .object({
    revision,
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();
