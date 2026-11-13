import { fileRevision, serializeChapter } from '../adapters/chapter-format'
import { ChapterError, type Chapter } from '../domain/chapter'
import type { ChapterRepo } from '../ports/chapter-repo'

export interface FileChapterCommit {
  operationId: string
  kind: 'merge' | 'archive' | 'finalize'
  recordId: number
  expectedRevision: string
  chapter: Chapter
}

export interface FileChapterCommitReceipt {
  status: 'committed'
  revision: string
}

export interface FileCommitJournal {
  prepare(intent: FileChapterCommit): FileChapterCommitReceipt | null
  finish(intent: FileChapterCommit, receipt: FileChapterCommitReceipt, applyMetadata: () => void): FileChapterCommitReceipt
}

/** Complete one recorded operation. The caller supplies the retained DB mutation for that operation. */
export function commitFileChapter(
  input: FileChapterCommit,
  repo: { withCommitLock<T>(work: (locked: Pick<ChapterRepo, 'byId' | 'save'>) => Promise<T>): Promise<T> },
  journal: FileCommitJournal,
  applyMetadata: () => void,
): Promise<FileChapterCommitReceipt> {
  const intent = structuredClone(input)
  return repo.withCommitLock(locked => commitLocked(intent, locked, journal, applyMetadata))
}

async function commitLocked(intent: FileChapterCommit, repo: Pick<ChapterRepo, 'byId' | 'save'>,
  journal: FileCommitJournal, applyMetadata: () => void): Promise<FileChapterCommitReceipt> {
  const { chapter, expectedRevision } = intent
  const revision = fileRevision(serializeChapter(chapter))
  const receipt = { status: 'committed', revision } as const
  const completed = journal.prepare(intent)
  if (completed) return completed

  const current = await repo.byId(chapter.id)
  if (current?.chapter.projectId !== chapter.projectId) throw new ChapterError('project-mismatch', 'Commit chapter does not belong to this project')

  // A retry after file publication must skip the write, including its history snapshot.
  // A third revision may belong to an external editor. Leave the intent pending for inspection.
  if (current.revision !== revision) {
    // Renumbering has a different recovery path because it can leave two filenames after a crash.
    if (current.revision !== expectedRevision || current.chapter.number !== chapter.number) {
      throw new ChapterError('conflict', 'Chapter changed during file commit')
    }
    await repo.save(chapter, { expectedRevision })
  }

  // Only metadata and the receipt share the SQLite transaction. File publication above survives rollback.
  return journal.finish(intent, receipt, applyMetadata)
}
