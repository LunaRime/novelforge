import type { RevisionMergeInput, RevisionMergePort, RevisionMergeResult } from '../ports/revision-merge'

class MergeRejected extends Error {
  constructor(readonly result: RevisionMergeResult) { super(result.error ?? 'revision-merge-rejected') }
}
/** All three mutations must commit or roll back together. */
export function commitRevisionMerge(input: RevisionMergeInput, port: RevisionMergePort): RevisionMergeResult {
  if (!input || !Number.isSafeInteger(input.draftId) || input.draftId < 1 ||
      !Number.isSafeInteger(input.revisionId) || input.revisionId < 1 ||
      (input.chapterNumber !== undefined && (!Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1)) ||
      typeof input.content !== 'string' || typeof input.projectPath !== 'string' || !input.projectPath ||
      !Number.isSafeInteger(input.wordCount) || input.wordCount < 0 ||
      typeof input.expectedContent !== 'string') {
    return { success: false, error: 'invalid-revision-merge' }
  }
  try {
    return port.atomic(() => {
      const before = port.draft(input.draftId)
      if (!before || (input.chapterNumber !== undefined && before.chapterNumber !== input.chapterNumber)) {
        return { success: false, error: 'draft-not-found' }
      }
      if (before.status === 'finalized' || before.status === 'archived') return { success: false, error: 'draft-finalized-readonly' }
      const revision = port.revision(input.revisionId)
      if (!revision || revision.baseDraftId !== before.id || revision.status !== 'pending') {
        return { success: false, error: 'revision-not-pending' }
      }
      if (input.expectedContent !== before.content) {
        return { success: false, conflict: true, error: 'draft-content-conflict' }
      }
      const written = port.write(input, before)
      if (!written.success) throw new MergeRejected(written)
      if (!port.reviseDraft(before.id, input.wordCount)) throw new MergeRejected({ success: false, error: 'draft-status-update-failed' })
      if (!port.mergeRevision(input.revisionId, before.id)) throw new MergeRejected({ success: false, error: 'revision-mark-merged-failed' })
      return { success: true, chapterNumber: before.chapterNumber }
    })
  } catch (error) {
    if (error instanceof MergeRejected) return error.result
    throw error
  }
}
