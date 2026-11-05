import { commitDraftContent } from '../../src/core/application/commit-draft-content'
import type { DraftContentWrite, DraftWriteResult } from '../../src/core/ports/draft-write'
import { getProjectDb } from '../database'
import { DraftRepository } from '../repositories/draft-repository'
import { DraftSnapshotRepository } from '../repositories/draft-snapshot-repository'
import { maybeCreateAutoSnapshot } from './draft-snapshot-service'
import { logger } from '../utils/logger'

/** Composition root for the current DB backend; does not switch storage formats. */
export function commitDatabaseDraft(input: DraftContentWrite): DraftWriteResult {
  const db = getProjectDb()
  if (!db) return { success: false, error: 'project-db-not-connected' }
  const result = commitDraftContent(input, {
    atomic: operation => db.transaction(operation)(),
    read: id => DraftRepository.getFull(id),
    snapshot: before => {
      DraftSnapshotRepository.create({ chapterNumber: before.chapterNumber, draftId: before.id,
        branchId: before.branchId, label: '', kind: 'pre-agent', content: before.content,
        contentHash: before.contentHash, wordCount: before.wordCount, createdBy: 'agent' })
    },
    replace: (command, before) => {
      const changed = DraftRepository.applyContentIfUnchanged(command.draftId, before.contentHash,
        before.updatedAt, command.content, command.wordCount)
      return changed.ok ? { success: true } : { success: false, conflict: changed.conflict,
        currentHash: changed.currentHash, currentUpdatedAt: changed.currentUpdatedAt,
        ...(!changed.conflict ? { error: 'draft-not-found' } : {}) }
    },
  })
  if (result.success && input.actor === 'user') {
    try { maybeCreateAutoSnapshot(input.draftId) }
    catch (error) { logger.warn('Save:Draft', `Auto snapshot failed after content commit: ${String(error)}`) }
  }
  return result
}
