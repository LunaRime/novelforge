import type { DraftWritePort, DraftWriteResult } from '../ports/draft-write'

export interface DraftFinalizationInput {
  draftId: number
  chapterNumber: number
  expectedContent: string
  wordCount: number
}

export interface DraftFinalizationPort extends Pick<DraftWritePort, 'atomic' | 'read'> {
  markFinalized(id: number, wordCount: number): boolean
}

export type DraftFinalizationResult = DraftWriteResult & { alreadyFinalized?: boolean }

/** Finalize the saved body that the caller inspected, leaving its content identity intact. */
export function commitDraftFinalization(input: DraftFinalizationInput, port: DraftFinalizationPort): DraftFinalizationResult {
  if (!input || !Number.isSafeInteger(input.draftId) || input.draftId < 1
    || !Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1
    || typeof input.expectedContent !== 'string' || !input.expectedContent.trim()
    || !Number.isSafeInteger(input.wordCount) || input.wordCount < 0) {
    return { success: false, error: 'invalid-draft-finalization' }
  }
  return port.atomic(() => {
    const draft = port.read(input.draftId)
    if (!draft || draft.chapterNumber !== input.chapterNumber) return { success: false, error: 'draft-not-found' }
    if (draft.status === 'archived') return { success: false, error: 'draft-finalized-readonly' }
    if (draft.content !== input.expectedContent) return { success: false, conflict: true, error: 'draft-content-conflict' }
    if (draft.status === 'finalized') return { success: true, alreadyFinalized: true }
    return port.markFinalized(draft.id, input.wordCount)
      ? { success: true }
      : { success: false, error: 'draft-status-update-failed' }
  })
}
