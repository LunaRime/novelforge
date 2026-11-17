import { FileChapterStore, SQLiteFileCommitJournal, commitFileChapter, fileRevision, ChapterError,
  type ChapterIndexDatabase, type FileChapterCommit, type FileChapterCommitReceipt, type MigratedDraftIdentityMap } from '../../src/core'
import type { FileDraftCommand, FileImportChapter, ProjectChannels } from '../../src/shared/ipc-channels'
import { freezeLegacyFileDrafts } from './freeze-legacy-file-drafts'
import { fileImportEntries } from './file-import-source'
import { readFileContinuationContext } from './file-continuation-context'
import { openFileDraftRevisions } from './file-draft-revisions'

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
  const fileRevisions = openFileDraftRevisions(db, projectId)
  const historyOnlyDrafts = new Set(identities.filter(entry => !currentDrafts.has(entry.chapterId)).map(entry => entry.draftId))

  function hasPublishedFileDraft(chapterId: string) {
    // 首次发布会登记稳定身份。正文普通保存后，当前 revision 以文件为准。
    return db.prepare('SELECT 1 FROM file_draft_states WHERE project_id = ? AND chapter_id = ?')
      .all(projectId, chapterId).length > 0
  }

  function apply(intent: FileChapterCommit, receipt: FileChapterCommitReceipt) {
    if (intent.kind === 'merge') {
      const base = currentDrafts.get(intent.chapter.id)
      if (base === undefined) {
        fileRevisions.merge(intent.chapter.id, intent.expectedRevision, intent.recordId, intent.chapter.content, receipt.revision)
      } else if (!db.prepare(`UPDATE revisions SET status = 'merged', merged_to_draft_id = ?, updated_at = ?
        WHERE id = ? AND base_draft_id = ? AND status = 'pending'
          AND EXISTS (SELECT 1 FROM contents c WHERE c.id = revisions.content_id AND c.body = ?)
        RETURNING id`)
        .all(base, Date.parse(intent.chapter.updatedAt), intent.recordId, base, intent.chapter.content).length) {
        throw new ChapterError('conflict', 'Revision no longer belongs to this draft or is no longer pending')
      }
    }
    // 用候选业务库记录文件状态和发布版本，旧草稿行保持冻结。
    db.prepare(`INSERT INTO file_draft_states (project_id, chapter_id, status, revision) VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, chapter_id) DO UPDATE SET status = excluded.status, revision = excluded.revision`)
      .run(projectId, intent.chapter.id, intent.chapter.status, receipt.revision)
  }

  const run = (intent: FileChapterCommit, beforePrepare?: Parameters<typeof commitFileChapter>[5],
    commitJournal: Parameters<typeof commitFileChapter>[2] = journal) =>
    commitFileChapter(intent, repo, commitJournal, receipt => apply(intent, receipt), assertCurrent, beforePrepare)

  function guardedJournal(check: () => void): Parameters<typeof commitFileChapter>[2] {
    return {
      prepare(intent, allowNew = true) {
        if (!allowNew) return journal.prepare(intent, allowNew)
        // 同一写事务内校验业务数据并登记意图，避免校验后被另一个连接改写。
        db.exec('BEGIN IMMEDIATE')
        try {
          if (journal.pending()?.operationId !== intent.operationId && !journal.receipt(intent.operationId)) check()
          const receipt = journal.prepare(intent, allowNew)
          db.exec('COMMIT')
          return receipt
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      },
      finish: (intent, receipt, apply) => journal.finish(intent, receipt, apply),
    }
  }

  function create(command: Omit<Extract<FileDraftCommand, { kind: 'create' }>, 'kind'>, operationId: string) {
    const { chapterId, number, title, content, createdAt, source } = command
    if (source !== undefined && (!source || typeof source.chapterId !== 'string' || !/^ch_[a-f0-9]{8,64}$/.test(source.chapterId) ||
        typeof source.revision !== 'string' || !/^[a-f0-9]{64}$/.test(source.revision) ||
        (source.contextRevision !== undefined && (typeof source.contextRevision !== 'string' || !/^[a-f0-9]{64}$/.test(source.contextRevision))))) {
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
      ...(source && { source: { chapterId: source.chapterId, revision: source.revision, contextRevision: source.contextRevision } }),
    }, source && (async locked => {
      // 首次登记前核对续写来源，已登记的发布继续按原请求恢复。
      if (journal.pending()?.operationId === operationId || journal.receipt(operationId)) return
      const previous = await locked.byId(source.chapterId)
      if (!previous || previous.revision !== source.revision || previous.chapter.number !== number - 1 || !previous.chapter.content.trim()) {
        throw new ChapterError('conflict', 'Source chapter changed')
      }
    }), source?.contextRevision ? guardedJournal(() => {
      if (readFileContinuationContext(db, number).contextRevision !== source.contextRevision) {
        throw new ChapterError('conflict', 'Continuation context changed')
      }
    }) : undefined)
  }

  function legacyRevision(chapterId: string, revisionId: number) {
    const [revision] = db.prepare(`SELECT c.body FROM revisions r JOIN contents c ON c.id = r.content_id
      WHERE r.id = ? AND r.base_draft_id = ? AND r.status = 'pending'`)
      .all(revisionId, currentDrafts.get(chapterId) ?? null) as Array<{ body: string }>
    if (!revision || typeof revision.body !== 'string') throw new ChapterError('conflict', 'Revision is unavailable')
    return revision.body
  }
  return {
    async preview(chapterId: string, revisionId: number) {
      if (currentDrafts.has(chapterId)) {
        const content = legacyRevision(chapterId, revisionId)
        return { content, contentHash: fileRevision(content) }
      }
      const current = (await repo.readByIds([chapterId])).get(chapterId)
      assertCurrent?.()
      if (!current || !hasPublishedFileDraft(chapterId) || current.chapter.metadata?.legacyDraftId !== undefined ||
          ['finalized', 'archived'].includes(current.chapter.status)) throw new ChapterError('conflict', 'File draft revision is unavailable')
      const content = fileRevisions.body(chapterId, current.revision, revisionId)
      return { content, contentHash: fileRevision(content) }
    },
    async stageRevision(chapterId: string, revision: string, offerId: string, edit: (body: string) => string, assertOfferCurrent: () => void) {
      return repo.withCommitLock(async locked => {
        const current = await locked.byId(chapterId)
        if (!current || journal.pending() || currentDrafts.has(chapterId) || !hasPublishedFileDraft(chapterId) ||
            current.revision !== revision || current.chapter.metadata?.legacyDraftId !== undefined ||
            ['finalized', 'archived'].includes(current.chapter.status)) throw new ChapterError('conflict', 'File draft is unavailable for staging')
        assertOfferCurrent()
        return fileRevisions.stage(chapterId, revision, offerId, edit(current.chapter.content))
      })

    },
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
      if (!chapter || chapter.revision !== expectedRevision ||
          chapter.chapter.metadata?.legacyDraftId !== draftId || chapter.chapter.status === 'archived') return
      if (draftId === undefined && !hasPublishedFileDraft(chapterId)) return
      const editable = chapter.chapter.status !== 'finalized'
      const canStageRevision = editable && draftId === undefined
      const pending = editable && draftId !== undefined ? db.prepare(`SELECT r.id FROM revisions r JOIN contents c ON c.id = r.content_id
        WHERE r.base_draft_id = ? AND r.status = 'pending' AND typeof(c.body) = 'text' ORDER BY r.id`)
        .all(draftId) as Array<{ id: number }> : canStageRevision ? fileRevisions.pending(chapterId, expectedRevision) : []
      return { canArchive: true, canFinalize: editable && Boolean(chapter.chapter.content.trim()), pending,
        ...(canStageRevision && { canStageRevision }) }
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
      if (draftId === undefined && !hasPublishedFileDraft(chapterId)) {
        throw new ChapterError('conflict', 'No draft association for this file operation')
      }
      const associatedId = kind === 'merge' ? command.revisionId : draftId
      // 保留迁移旧稿的操作 ID 算法。新建章直接用稳定章节 ID 和 revision 标识重试。
      const proposalHash = kind === 'merge' ? command.proposalHash : undefined
      if (proposalHash !== undefined && !/^[a-f0-9]{64}$/.test(proposalHash)) {
        throw new ChapterError('invalid-chapter', 'Invalid revision preview hash')
      }
      const operationKey: Array<string | number> = [kind, chapterId, expectedRevision]
      if (associatedId !== undefined) operationKey.push(associatedId)
      if (proposalHash !== undefined) operationKey.push(proposalHash)
      const operationId = fileRevision(JSON.stringify(operationKey))
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
      let mergeJournal: Parameters<typeof commitFileChapter>[2] | undefined
      if (kind === 'merge') {
        if (draftId === undefined) {
          if (!proposalHash) throw new ChapterError('conflict', 'File draft merge requires a preview')
          content = fileRevisions.body(chapterId, expectedRevision, command.revisionId)
          mergeJournal = guardedJournal(() => {
            if (fileRevisions.body(chapterId, expectedRevision, command.revisionId) !== content) {
              throw new ChapterError('conflict', 'Revision changed after preview')
            }
          })
        } else content = legacyRevision(chapterId, command.revisionId)
        // 只接受用户预览过的正文，期间修稿内容改变就拒绝合并。
        if (proposalHash !== undefined && fileRevision(content) !== proposalHash) {
          throw new ChapterError('conflict', 'Revision changed after preview')
        }
      }
      if (kind === 'finalize' && !content.trim()) throw new ChapterError('invalid-chapter', 'Finalization requires saved content')
      const status = kind === 'merge' ? 'revised' : kind === 'archive' ? 'archived' : 'finalized'
      return run({ operationId, kind, recordId: associatedId ?? chapter.number, expectedRevision,
        chapter: { ...chapter, status, content, updatedAt: new Date().toISOString() } }, undefined, mergeJournal)
    },
  }
}
