import type { DraftContentWrite, DraftWritePort, DraftWriteResult } from '../ports/draft-write'

class WriteRejected extends Error {
  constructor(readonly result: DraftWriteResult) { super('Draft write rejected') }
}

/** Synchronous transaction: no await or global project state may escape the port. */
export function commitDraftContent(input: DraftContentWrite, port: DraftWritePort): DraftWriteResult {
  if (!Number.isSafeInteger(input.draftId) || input.draftId < 1 || typeof input.content !== 'string' ||
      !Number.isSafeInteger(input.wordCount) || input.wordCount < 0 || !['user', 'agent'].includes(input.actor) ||
      (input.expectedHash !== undefined && typeof input.expectedHash !== 'string') ||
      (input.expectedUpdatedAt !== undefined && !Number.isFinite(input.expectedUpdatedAt)) ||
      ((input.expectedHash === undefined) !== (input.expectedUpdatedAt === undefined)) ||
      (input.actor === 'agent' && input.expectedHash === undefined)) {
    return { success: false, error: 'invalid-draft-write' }
  }
  try {
    return port.atomic(() => {
      const before = port.read(input.draftId)
      if (!before) return { success: false, error: 'draft-not-found' }
      if (input.actor === 'agent' && before.status === 'finalized') return { success: false, error: 'draft-finalized-readonly' }
      if (input.expectedHash !== undefined &&
          (before.contentHash !== input.expectedHash || before.updatedAt !== input.expectedUpdatedAt)) {
        return { success: false, conflict: true, currentHash: before.contentHash, currentUpdatedAt: before.updatedAt }
      }
      if (input.actor === 'agent') port.snapshot(before)
      const result = port.replace(input, before)
      // A post-snapshot CAS rejection must roll back the snapshot as well.
      if (!result.success) throw new WriteRejected(result)
      return result
    })
  } catch (error) {
    if (error instanceof WriteRejected) return error.result
    throw error
  }
}
