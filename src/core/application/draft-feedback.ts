interface DraftFeedbackPort<Input> {
  assertCurrent(): void
  nextIndex(draftId: number): Promise<number>
  create(input: Input): Promise<number>
}

export interface DraftRevisionWrite {
  baseDraftId: number
  revisionIndex: number
  revisionType: 'refine' | 'review-fix'
  content: string
  wordCount: number
  userPrompt?: string
}

export interface DraftReviewWrite {
  baseDraftId: number
  reviewIndex: number
  content: string
}

export interface DraftRevisionPort extends DraftFeedbackPort<DraftRevisionWrite> {
  pending(draftId: number): Promise<readonly { id: number }[]>
  discard(id: number): Promise<void>
}

export type DraftReviewPort = DraftFeedbackPort<DraftReviewWrite>

async function scopedStep<T>(port: { assertCurrent(): void }, operation: () => Promise<T>): Promise<T> {
  port.assertCurrent()
  const result = await operation()
  port.assertCurrent()
  return result
}

export async function saveDraftRevision(input: Omit<DraftRevisionWrite, 'revisionIndex'>, port: DraftRevisionPort) {
  const captured = { ...input }
  const revisionIndex = await scopedStep(port, () => port.nextIndex(captured.baseDraftId))
  const pending = await scopedStep(port, () => port.pending(captured.baseDraftId))
  const id = await scopedStep(port, () => port.create({ ...captured, revisionIndex }))
  // Existing proposals remain pending until the replacement is saved.
  for (const revision of pending) await scopedStep(port, () => port.discard(revision.id))
  return { id, revisionIndex }
}

export async function saveDraftReview(input: Omit<DraftReviewWrite, 'reviewIndex'>, port: DraftReviewPort) {
  const captured = { ...input }
  const reviewIndex = await scopedStep(port, () => port.nextIndex(captured.baseDraftId))
  const id = await scopedStep(port, () => port.create({ ...captured, reviewIndex }))
  return { id, reviewIndex }
}
