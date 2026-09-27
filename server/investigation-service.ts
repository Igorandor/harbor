import { randomUUID } from 'node:crypto';
import { ApiError, IrisClient } from './upstream.js';
import { WorkspaceStore, type WorkspaceIdentity } from './workspace-store.js';
import {
  caseInput,
  type Investigation,
  type CaseCapture,
  summarizeCase,
  validStoredCase,
} from '../shared/investigation.js';
import type { DiagnosticId } from '../shared/diagnostics.js';
import { captureDiagnostics } from './diagnostics.js';
import type { ChangeRecord } from '../shared/change-record.js';
import type { InvestigationProfile } from '../shared/investigation-profile.js';
import {
  compareEvidence,
  reviewProgress,
  type ReviewDisposition,
  type EvidenceReview,
} from '../shared/evidence-comparison.js';

type Actor = WorkspaceIdentity & { auth: string };
export class InvestigationService {
  constructor(
    readonly store: WorkspaceStore,
    private client: IrisClient,
  ) {}
  async list(actor: Actor) {
    return this.store.scan(actor, 'investigations', (record: Investigation) =>
      summarizeCase(record),
    );
  }
  async create(actor: Actor, input: unknown, profile?: InvestigationProfile) {
    const parsed = caseInput.parse(input);
    return this.store.create(actor, 'investigations', {
      ...parsed,
      version: 1 as const,
      owner: actor.owner,
      instance: actor.instance,
      status: 'open' as const,
      notes: [],
      captures: [],
      linkedChanges: [],
      ...(profile
        ? {
            profile: {
              id: profile.id,
              revision: profile.revision,
              title: profile.title,
              sources: profile.sources,
            },
            checklist: profile.steps.map((step) => ({
              ...step,
              id: randomUUID(),
              state: 'open' as const,
            })),
          }
        : {}),
    });
  }
  async get(actor: Actor, id: string) {
    const record = await this.store.read<Investigation>(actor, 'investigations', id);
    if (!validStoredCase(record))
      throw new ApiError(500, 'The investigation record is invalid. Preserve it for inspection.');
    return record;
  }
  private async update(
    actor: Actor,
    id: string,
    revision: number,
    fn: (record: Investigation) => Promise<void> | void,
  ) {
    return this.store.exclusive(actor, 'investigations', id, async () => {
      const record = await this.get(actor, id);
      if (record.revision !== revision)
        throw new ApiError(409, 'The investigation changed. Refresh before saving.');
      if (record.notes.length >= 200)
        throw new ApiError(
          409,
          'This investigation reached 200 timeline entries. Export it and continue in a new investigation.',
        );
      await fn(record);
      record.revision++;
      record.updatedAt = new Date().toISOString();
      return this.store.write(record, 'investigations', revision);
    });
  }
  async note(actor: Actor, id: string, revision: number, text: string) {
    if (!text.trim() || text.length > 4000)
      throw new ApiError(400, 'Write a note of 1–4,000 characters.');
    return this.update(actor, id, revision, (record) => {
      if (record.status === 'archived')
        throw new ApiError(409, 'Reopen the investigation before adding a note.');
      record.notes.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        author: actor.owner,
        kind: 'note',
        text: text.trim(),
      });
    });
  }
  async status(
    actor: Actor,
    id: string,
    revision: number,
    status: Investigation['status'],
    reason: string,
  ) {
    if (!reason.trim() || reason.length > 4000)
      throw new ApiError(400, 'Record why the status is changing.');
    return this.update(actor, id, revision, (record) => {
      if (status === record.status)
        throw new ApiError(409, 'The investigation already has this status.');
      if (
        status === 'resolved' &&
        record.checklist?.some((item) => item.required && item.state === 'open')
      )
        throw new ApiError(
          409,
          'Complete or explicitly mark each required checklist item not applicable before resolving this investigation.',
        );
      if (status === 'archived' && record.status !== 'resolved')
        throw new ApiError(409, 'Resolve the investigation before archiving it.');
      if (record.status === 'archived' && status !== 'open')
        throw new ApiError(409, 'Archived investigations can be reopened first.');
      const previous = record.status;
      record.status = status;
      if (status === 'resolved') record.resolution = reason.trim();
      record.notes.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        author: actor.owner,
        kind: 'status',
        text: `${previous} → ${status}: ${reason.trim()}`,
      });
    });
  }
  async capture(
    actor: Actor,
    id: string,
    revision: number,
    sources: DiagnosticId[],
    title: string,
  ) {
    if (!title.trim() || title.length > 120)
      throw new ApiError(400, 'Give the capture a title of 1–120 characters.');
    return this.update(actor, id, revision, async (record) => {
      if (record.status === 'archived' || record.status === 'resolved')
        throw new ApiError(409, 'Reopen this investigation before collecting more data.');
      if (record.captures.length >= 12)
        throw new ApiError(
          409,
          'This investigation reached 12 captures. Export it and start a follow-up investigation.',
        );
      const bundle = await captureDiagnostics(this.client, actor.auth, actor.instance, sources);
      const capture: CaseCapture = {
        id: randomUUID(),
        title: title.trim(),
        sources,
        capturedBy: actor.owner,
        bundle,
      };
      record.captures.push(capture);
      record.notes.push({
        id: randomUUID(),
        at: bundle.finishedAt,
        author: actor.owner,
        kind: 'capture',
        text: title.trim(),
        captureId: capture.id,
      });
    });
  }
  async link(actor: Actor, id: string, revision: number, changeId: string, note: string) {
    const change = await this.store.read<ChangeRecord>(actor, 'changes', changeId);
    return this.update(actor, id, revision, (record) => {
      if (record.status === 'archived')
        throw new ApiError(409, 'Reopen this investigation before linking a change.');
      if (record.linkedChanges.includes(changeId))
        throw new ApiError(409, 'This change is already linked.');
      if (record.linkedChanges.length >= 30)
        throw new ApiError(409, 'An investigation can link at most 30 changes.');
      record.linkedChanges.push(changeId);
      record.notes.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        author: actor.owner,
        kind: 'link',
        text: (note.trim() || `${change.title}: ${change.target}`).slice(0, 4000),
        changeId,
      });
    });
  }
  async checklist(
    actor: Actor,
    id: string,
    revision: number,
    itemId: string,
    state: 'open' | 'completed' | 'not applicable',
    note: string,
  ) {
    if (!note.trim() || note.length > 2000)
      throw new ApiError(400, 'Record a note of 1–2,000 characters for this checklist decision.');
    return this.update(actor, id, revision, (record) => {
      if (['resolved', 'archived'].includes(record.status))
        throw new ApiError(409, 'Reopen the investigation before changing its checklist.');
      const item = record.checklist?.find((item) => item.id === itemId);
      if (!item) throw new ApiError(404, 'Checklist item not found.');
      item.state = state;
      item.note = note.trim();
      item.updatedAt = new Date().toISOString();
      item.updatedBy = actor.owner;
      record.notes.push({
        id: randomUUID(),
        at: item.updatedAt,
        author: actor.owner,
        kind: 'note',
        text: `Checklist “${item.title}” — ${state}: ${item.note}`,
      });
    });
  }
  async startReview(
    actor: Actor,
    id: string,
    revision: number,
    title: string,
    beforeId: string,
    afterId: string,
  ) {
    return this.update(actor, id, revision, (record) => {
      this.reviewEditable(record);
      const before = record.captures.find((capture) => capture.id === beforeId);
      const after = record.captures.find((capture) => capture.id === afterId);
      if (!before || !after)
        throw new ApiError(404, 'A selected capture is not part of this investigation.');
      if (beforeId === afterId) throw new ApiError(400, 'Choose two different captures.');
      if ((record.evidenceReviews?.length ?? 0) >= 20)
        throw new ApiError(409, 'This investigation reached 20 evidence reviews.');
      if (
        record.evidenceReviews?.some(
          (review) => review.beforeId === beforeId && review.afterId === afterId,
        )
      )
        throw new ApiError(
          409,
          'A review for this capture pair already exists. Open the saved review.',
        );
      compareEvidence(before, after);
      const now = new Date().toISOString();
      const review: EvidenceReview = {
        id: randomUUID(),
        comparisonVersion: 1,
        title: title.trim(),
        beforeId,
        afterId,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.owner,
        decisions: [],
        history: [],
      };
      record.evidenceReviews ??= [];
      record.evidenceReviews.push(review);
      this.reviewEvent(
        record,
        actor,
        `Evidence review “${review.title}” opened: ${before.title} → ${after.title}.`,
      );
    });
  }
  async decideEvidence(
    actor: Actor,
    id: string,
    revision: number,
    reviewId: string,
    differenceId: string,
    disposition: ReviewDisposition,
    note: string,
  ) {
    return this.update(actor, id, revision, (record) => {
      this.reviewEditable(record);
      const review = this.findReview(record, reviewId);
      if (review.conclusion)
        throw new ApiError(409, 'Reopen the review before changing a decision.');
      if (review.history.length >= 2000)
        throw new ApiError(
          409,
          'This review reached 2,000 decision revisions. Export it before continuing in a follow-up investigation.',
        );
      const comparison = this.reviewComparison(record, review);
      const difference = comparison.sources
        .flatMap((source) => source.differences)
        .find((row) => row.id === differenceId);
      if (!difference) throw new ApiError(400, 'The difference does not belong to this review.');
      const decision = {
        differenceId,
        disposition,
        note: note.trim(),
        author: actor.owner,
        at: new Date().toISOString(),
      };
      review.decisions = review.decisions.filter((entry) => entry.differenceId !== differenceId);
      review.decisions.push(decision);
      review.history.push({ ...decision, eventId: randomUUID() });
      review.updatedAt = decision.at;
      // Decision history lives with the review; it does not consume the case's
      // 200 timeline slots for every path in a large diagnostic source.
    });
  }
  async concludeReview(actor: Actor, id: string, revision: number, reviewId: string, text: string) {
    return this.update(actor, id, revision, (record) => {
      this.reviewEditable(record);
      const review = this.findReview(record, reviewId);
      if (review.conclusion) throw new ApiError(409, 'This review already has a conclusion.');
      const progress = reviewProgress(this.reviewComparison(record, review), review);
      if (progress.unreviewed || progress.investigate)
        throw new ApiError(
          409,
          'Explain or mark each retained difference expected before concluding the review.',
        );
      review.conclusion = {
        text: text.trim(),
        at: new Date().toISOString(),
        author: actor.owner,
        limitsAcknowledged: true,
      };
      review.updatedAt = review.conclusion.at;
      this.reviewEvent(
        record,
        actor,
        `Evidence review “${review.title}” concluded: ${review.conclusion.text}`,
      );
    });
  }
  async reopenReview(actor: Actor, id: string, revision: number, reviewId: string, reason: string) {
    return this.update(actor, id, revision, (record) => {
      this.reviewEditable(record);
      const review = this.findReview(record, reviewId);
      if (!review.conclusion) throw new ApiError(409, 'This review is already open.');
      delete review.conclusion;
      review.updatedAt = new Date().toISOString();
      this.reviewEvent(
        record,
        actor,
        `Evidence review “${review.title}” reopened: ${reason.trim()}`,
      );
    });
  }
  private reviewEditable(record: Investigation) {
    if (['resolved', 'archived'].includes(record.status))
      throw new ApiError(409, 'Reopen the investigation before changing an evidence review.');
  }
  private findReview(record: Investigation, id: string) {
    const review = record.evidenceReviews?.find((entry) => entry.id === id);
    if (!review) throw new ApiError(404, 'Evidence review not found.');
    if (review.comparisonVersion !== 1)
      throw new ApiError(
        409,
        'This review uses a different comparison version. Preserve and export it before continuing.',
      );
    return review;
  }
  private reviewComparison(record: Investigation, review: EvidenceReview) {
    const before = record.captures.find((capture) => capture.id === review.beforeId);
    const after = record.captures.find((capture) => capture.id === review.afterId);
    if (!before || !after)
      throw new ApiError(
        500,
        'The evidence review references missing captures. Preserve this record for inspection.',
      );
    return compareEvidence(before, after);
  }
  private reviewEvent(record: Investigation, actor: Actor, text: string) {
    record.notes.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      author: actor.owner,
      kind: 'note',
      text,
    });
  }
}
