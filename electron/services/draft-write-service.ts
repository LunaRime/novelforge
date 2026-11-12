import { commitDraftContent, commitDraftFinalization } from '../../src/core'
import type { DraftContentWrite, DraftFinalizationInput, DraftFinalizationResult, DraftWriteResult } from '../../src/core'
import { getCurrentProjectPath, getProjectDb } from '../database'
import { DraftRepository } from '../repositories/draft-repository'
import { DraftSnapshotRepository } from '../repositories/draft-snapshot-repository'
import { maybeCreateAutoSnapshot } from './draft-snapshot-service'
import { logger } from '../utils/logger'
import { captureProjectWriteScope } from './project-write-scope'

function autoSnapshot(draftId: number): void {
  try { maybeCreateAutoSnapshot(draftId) }
  catch (error) { logger.warn('Save:Draft', `Auto snapshot failed after content commit: ${String(error)}`) }
}

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
  if (result.success && input.actor === 'user') autoSnapshot(input.draftId)
  return result
}

export function commitDatabaseDraftFinalization(
  input: DraftFinalizationInput & { projectPath: string; writeToken?: string },
): DraftFinalizationResult {
  const db = getProjectDb()
  if (!db) return { success: false, error: 'project-db-not-connected' }
  if (!input?.projectPath || input.projectPath !== getCurrentProjectPath()
    || (input.writeToken !== undefined && input.writeToken !== captureProjectWriteScope().token)) {
    return { success: false, error: 'project-scope-changed' }
  }
  try {
    const result = commitDraftFinalization(input, {
      atomic: operation => db.transaction(operation)(),
      read: id => DraftRepository.getFull(id),
      markFinalized: (id, wordCount) => db.prepare(
        "UPDATE drafts SET status='finalized', word_count=?, updated_at=unixepoch()*1000 WHERE id=? AND status NOT IN ('archived','finalized')",
      ).run(wordCount, id).changes === 1,
    })
    if (result.success && !result.alreadyFinalized) autoSnapshot(input.draftId)
    return result
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
