import { commitRevisionMerge, type RevisionMergeInput, type RevisionMergeResult } from '../../src/core'
import { getCurrentProjectPath, getProjectDb } from '../database'
import { DraftRepository } from '../repositories/draft-repository'
import { RevisionRepository } from '../repositories/revision-repository'
import { commitDatabaseDraft } from './draft-write-service'

/** Existing DB backend: nested content/snapshot work remains inside the outer merge transaction. */
export function mergeDatabaseRevision(input: RevisionMergeInput): RevisionMergeResult {
  const db = getProjectDb()
  if (!db) return { success: false, error: 'project-db-not-connected' }
  if (!input || input.projectPath !== getCurrentProjectPath()) return { success: false, error: 'project-scope-changed' }
  try {
    return commitRevisionMerge(input, {
      atomic: operation => db.transaction(operation)(),
      draft: id => DraftRepository.getFull(id),
      revision: id => RevisionRepository.getFull(id),
      write: (command, before) => commitDatabaseDraft({ draftId: command.draftId,
        content: command.content, wordCount: command.wordCount, actor: 'user',
        expectedHash: before.contentHash, expectedUpdatedAt: before.updatedAt }),
      reviseDraft: (id, wordCount) => db.prepare("UPDATE drafts SET status='revised', word_count=?, updated_at=unixepoch()*1000 WHERE id=? AND status NOT IN ('finalized','archived')").run(wordCount, id).changes === 1,
      mergeRevision: (id, target) => db.prepare("UPDATE revisions SET status='merged', merged_to_draft_id=?, updated_at=unixepoch()*1000 WHERE id=? AND base_draft_id=? AND status='pending'").run(target, id, target).changes === 1,
    })
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
