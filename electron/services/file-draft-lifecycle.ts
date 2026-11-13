import { FileChapterStore, SQLiteFileCommitJournal, commitFileChapter, fileRevision, ChapterError,
  type ChapterIndexDatabase, type FileChapterCommit, type FileChapterCommitReceipt, type MigratedDraftIdentityMap } from '../../src/core'
import { freezeLegacyFileDrafts } from './freeze-legacy-file-drafts'

export type FileDraftCommand = { chapterId: string; expectedRevision: string } & (
  { kind: 'merge'; revisionId: number; proposalHash?: string } | { kind: 'archive' | 'finalize' }
)

/** The retained database owns revision associations and receipts. Its legacy chapter rows are frozen. */
export function createFileDraftLifecycle(db: ChapterIndexDatabase, repo: FileChapterStore,
  projectId: string, identities: MigratedDraftIdentityMap['entries'], assertCurrent?: () => void) {
  freezeLegacyFileDrafts(db)
  const journal = new SQLiteFileCommitJournal(db, projectId)
  db.exec(`CREATE TABLE IF NOT EXISTS file_draft_states (
    project_id TEXT NOT NULL, chapter_id TEXT NOT NULL, status TEXT NOT NULL, revision TEXT NOT NULL,
    PRIMARY KEY (project_id, chapter_id)
  )`)
  const currentDrafts = new Map(identities.filter(entry => entry.target.kind === 'current')
    .map(entry => [entry.chapterId, entry.draftId]))

  function apply(intent: FileChapterCommit, receipt: FileChapterCommitReceipt) {
    if (intent.kind === 'merge') {
      const base = currentDrafts.get(intent.chapter.id)
      if (!base || !db.prepare(`UPDATE revisions SET status = 'merged', merged_to_draft_id = ?, updated_at = ?
        WHERE id = ? AND base_draft_id = ? AND status = 'pending'
          AND EXISTS (SELECT 1 FROM contents c WHERE c.id = revisions.content_id AND c.body = ?)
        RETURNING id`)
        .all(base, Date.parse(intent.chapter.updatedAt), intent.recordId, base, intent.chapter.content).length) {
        throw new ChapterError('conflict', 'Revision no longer belongs to this draft or is no longer pending')
      }
    }
    // This receipt tracks the file operation, leaving legacy draft rows untouched.
    db.prepare(`INSERT INTO file_draft_states (project_id, chapter_id, status, revision) VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, chapter_id) DO UPDATE SET status = excluded.status, revision = excluded.revision`)
      .run(projectId, intent.chapter.id, intent.chapter.status, receipt.revision)
  }

  const run = (intent: FileChapterCommit) => commitFileChapter(intent, repo, journal, receipt => apply(intent, receipt), assertCurrent)
  function preview(chapterId: string, revisionId: number) {
    const [revision] = db.prepare(`SELECT c.body FROM revisions r JOIN contents c ON c.id = r.content_id
      WHERE r.id = ? AND r.base_draft_id = ? AND r.status = 'pending'`)
      .all(revisionId, currentDrafts.get(chapterId) ?? null) as Array<{ body: string }>
    if (!revision || typeof revision.body !== 'string') throw new ChapterError('conflict', 'Revision is unavailable')
    return { content: revision.body, contentHash: fileRevision(revision.body) }
  }
  return {
    preview,
    async actions(chapterId: string, expectedRevision: string) {
      const chapter = await repo.byId(chapterId)
      const draftId = currentDrafts.get(chapterId)
      if (!chapter || chapter.revision !== expectedRevision || !draftId ||
          chapter.chapter.metadata?.legacyDraftId !== draftId || chapter.chapter.status === 'archived') return
      const editable = chapter.chapter.status !== 'finalized'
      const pending = editable ? db.prepare(`SELECT r.id FROM revisions r JOIN contents c ON c.id = r.content_id
        WHERE r.base_draft_id = ? AND r.status = 'pending' AND typeof(c.body) = 'text' ORDER BY r.id`)
        .all(draftId) as Array<{ id: number }> : []
      return { canArchive: true, canFinalize: editable && Boolean(chapter.chapter.content.trim()), pending }
    },
    async recover() {
      const intent = journal.pending()
      return intent ? run(intent) : null
    },
    assertIdle() {
      if (journal.pending()) throw new ChapterError('locked', 'A file operation is awaiting recovery')
    },
    async commit(command: FileDraftCommand) {
      if (!command || !['merge', 'archive', 'finalize'].includes(command.kind) ||
          !/^ch_[a-f0-9]{8,64}$/.test(command.chapterId) || !/^[a-f0-9]{64}$/.test(command.expectedRevision) ||
          (command.kind === 'merge' && (!Number.isSafeInteger(command.revisionId) || command.revisionId < 1))) {
        throw new ChapterError('invalid-chapter', 'Invalid file draft operation')
      }
      const { kind, chapterId, expectedRevision } = command
      const draftId = currentDrafts.get(chapterId)
      if (!draftId) throw new ChapterError('conflict', 'No current migrated draft for this chapter')
      const recordId = kind === 'merge' ? command.revisionId : draftId
      // The immutable request identifies retries, including those after a process restart.
      const proposalHash = kind === 'merge' ? command.proposalHash : undefined
      if (proposalHash !== undefined && !/^[a-f0-9]{64}$/.test(proposalHash)) {
        throw new ChapterError('invalid-chapter', 'Invalid revision preview hash')
      }
      const operationId = fileRevision(JSON.stringify(proposalHash === undefined
        ? [kind, chapterId, expectedRevision, recordId]
        : [kind, chapterId, expectedRevision, recordId, proposalHash]))
      const pending = journal.pending()
      if (pending?.operationId === operationId) return run(pending)
      const completed = journal.receipt(operationId)
      if (completed) return completed
      if (pending) throw new ChapterError('locked', 'A file operation is awaiting recovery')

      const current = await repo.byId(chapterId)
      if (!current || current.revision !== expectedRevision || current.chapter.metadata?.legacyDraftId !== draftId) {
        throw new ChapterError('conflict', 'The selected draft changed')
      }
      const { chapter } = current
      if (chapter.status === 'archived' || (chapter.status === 'finalized' && kind !== 'archive')) {
        throw new ChapterError('conflict', 'The selected draft is read-only')
      }
      let content = chapter.content
      if (kind === 'merge') {
        const proposal = preview(chapterId, recordId)
        // Apply the exact body reviewed by the editor, even if the retained revision changed meanwhile.
        if (proposalHash !== undefined && proposal.contentHash !== proposalHash) {
          throw new ChapterError('conflict', 'Revision changed after preview')
        }
        content = proposal.content
      }
      if (kind === 'finalize' && !content.trim()) throw new ChapterError('invalid-chapter', 'Finalization requires saved content')
      const status = kind === 'merge' ? 'revised' : kind === 'archive' ? 'archived' : 'finalized'
      return run({ operationId, kind, recordId, expectedRevision,
        chapter: { ...chapter, status, content, updatedAt: new Date().toISOString() } })
    },
  }
}
