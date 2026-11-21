import { commitDraftContent, commitDraftFinalization } from '../../src/core'
import type { DraftContentWrite, DraftFinalizationInput, DraftFinalizationResult, DraftWriteResult } from '../../src/core'
import type { DatabaseChannels } from '../../src/shared/ipc-channels'
import { stripMarkdownUnderline } from '../../src/shared/markdown-underline'
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

/** 正式稿只接受显示格式调整。正文比较和写入共用一个事务。 */
type FinalizedUnderlineChannel = DatabaseChannels['db:draft-format-underline']

export function commitDatabaseFinalizedUnderline(
  input: FinalizedUnderlineChannel['args'][0],
): FinalizedUnderlineChannel['return'] {
  const db = getProjectDb()
  if (!db) return { success: false, error: 'project-db-not-connected' }
  if (!input?.projectPath || input.projectPath !== getCurrentProjectPath() ||
      (input.writeToken !== undefined && input.writeToken !== captureProjectWriteScope().token)) {
    return { success: false, error: 'project-scope-changed' }
  }
  if (!Number.isSafeInteger(input.draftId) || input.draftId < 1 || typeof input.content !== 'string' ||
      typeof input.expectedContent !== 'string') return { success: false, error: 'invalid-draft-write' }

  try {
    return db.transaction((): FinalizedUnderlineChannel['return'] => {
      const before = DraftRepository.getFull(input.draftId)
      if (!before) return { success: false, error: 'draft-not-found' }
      if (before.status !== 'finalized') return { success: false, error: 'draft-not-finalized' }
      if (before.content !== input.expectedContent) return { success: false, conflict: true }
      if (before.content === input.content) return { success: true, chapterNumber: before.chapterNumber }
      if (stripMarkdownUnderline(before.content) !== stripMarkdownUnderline(input.content)) {
        return { success: false, error: 'draft-underline-only' }
      }
      const result = DraftRepository.applyContentIfUnchanged(before.id, before.contentHash, before.updatedAt, input.content, before.wordCount)
      return result.ok ? { success: true, chapterNumber: before.chapterNumber } : { success: false, conflict: result.conflict }
    })()
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
