import { FileChapterStore, SQLiteFileCommitJournal, commitFileChapter, fileRevision, ChapterError,
  type ChapterIndexDatabase, type FileChapterCommit, type FileChapterCommitReceipt, type MigratedDraftIdentityMap } from '../../src/core'
import type { FileDraftCommand, FileImportChapter, ProjectChannels } from '../../src/shared/ipc-channels'
import { freezeLegacyFileDrafts } from './freeze-legacy-file-drafts'
import { fileImportEntries } from './file-import-source'

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
  const historyOnlyDrafts = new Set(identities.filter(entry => !currentDrafts.has(entry.chapterId)).map(entry => entry.draftId))

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

  const run = (intent: FileChapterCommit, beforePrepare?: Parameters<typeof commitFileChapter>[5]) =>
    commitFileChapter(intent, repo, journal, receipt => apply(intent, receipt), assertCurrent, beforePrepare)

  function create(command: Omit<Extract<FileDraftCommand, { kind: 'create' }>, 'kind'>, operationId: string) {
    const { chapterId, number, title, content, createdAt, source } = command
    if (source !== undefined && (!source || typeof source.chapterId !== 'string' || !/^ch_[a-f0-9]{8,64}$/.test(source.chapterId) ||
        typeof source.revision !== 'string' || !/^[a-f0-9]{64}$/.test(source.revision))) {
      throw new ChapterError('invalid-chapter', 'Invalid source chapter')
    }
    // 迁移身份和仅历史稿占用的章号须通过显式恢复流程复用。
    const reservedNumber = historyOnlyDrafts.size > 0 && (db.prepare('SELECT id FROM drafts WHERE chapter_number = ?')
      .all(number) as Array<{ id: number }>).some(row => historyOnlyDrafts.has(row.id))
    if (reservedNumber || identities.some(entry => entry.chapterId === chapterId)) {
      throw new ChapterError('conflict', 'Chapter belongs to the migration history')
    }
    return run({ operationId, kind: 'create', recordId: number, expectedRevision: null,
      chapter: { projectId, id: chapterId, number, title, content, status: 'draft', createdAt, updatedAt: createdAt },
      ...(source && { source: { chapterId: source.chapterId, revision: source.revision } }),
    }, source && (async locked => {
      // 首次登记前核对续写来源，已登记的发布继续按原请求恢复。
      if (journal.pending()?.operationId === operationId || journal.receipt(operationId)) return
      const previous = await locked.byId(source.chapterId)
      if (!previous || previous.revision !== source.revision || previous.chapter.number !== number - 1 || !previous.chapter.content.trim()) {
        throw new ChapterError('conflict', 'Source chapter changed')
      }
    }))
  }

  function preview(chapterId: string, revisionId: number) {
    const [revision] = db.prepare(`SELECT c.body FROM revisions r JOIN contents c ON c.id = r.content_id
      WHERE r.id = ? AND r.base_draft_id = ? AND r.status = 'pending'`)
      .all(revisionId, currentDrafts.get(chapterId) ?? null) as Array<{ body: string }>
    if (!revision || typeof revision.body !== 'string') throw new ChapterError('conflict', 'Revision is unavailable')
    return { content: revision.body, contentHash: fileRevision(revision.body) }
  }
  return {
    preview,
    async importChapters(firstNumber: number, chapters: FileImportChapter[]) {
      const result: ProjectChannels['project:file-editor-import']['return'] = { completed: 0 }
      for (const { operationId, chapterId, number, title, content } of fileImportEntries(projectId, firstNumber, chapters)) {
        assertCurrent?.()
        if (!journal.receipt(operationId)) {
          try {
            const pending = journal.pending()
            if (pending?.operationId === operationId) await run(pending)
            else await create({ chapterId, number, title, content, createdAt: new Date().toISOString() }, operationId)
          } catch (error) {
            // 章号冲突时保留已提交的章节。如果仍有待提交记录，则交给恢复流程处理。
            if (error instanceof ChapterError && error.code === 'conflict' && !journal.pending()) {
              if (!journal.receipt(operationId)) return { ...result, blockedNumber: number }
            } else throw error
          }
        }
        assertCurrent?.()
        result.firstLocator ??= `doc://chapter/${chapterId}`
        result.completed++
      }
      return result
    },
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
      if (command?.kind === 'create') {
        if (!Number.isSafeInteger(command.number) || command.number < 1) {
          throw new ChapterError('invalid-chapter', 'Invalid file chapter number')
        }
        // 单章创建使用稳定章节 ID 计算操作 ID，重试由日志比对完整请求。
        return create(command, fileRevision(JSON.stringify(['create', command.chapterId])))
      }
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
