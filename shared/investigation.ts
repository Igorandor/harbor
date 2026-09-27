import { z } from 'zod';
import type { DiagnosticBundle, DiagnosticId } from './diagnostics.js';
import type { EvidenceReview } from './evidence-comparison.js';
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
