import { fileRevision, serializeChapter } from '../adapters/chapter-format'
import { ChapterError, type Chapter } from '../domain/chapter'
import type { LockedFileChapterRepo } from '../ports/chapter-repo'

export type FileChapterCommit = {
  operationId: string
  recordId: number
  chapter: Chapter
} & (
  | { kind: 'create'; expectedRevision: null }
  | { kind: 'merge' | 'archive' | 'finalize'; expectedRevision: string }
)

export interface FileChapterCommitReceipt {
  status: 'committed'
  revision: string
}

export interface FileCommitJournal {
  prepare(intent: FileChapterCommit, allowNew?: boolean): FileChapterCommitReceipt | null
  finish(intent: FileChapterCommit, receipt: FileChapterCommitReceipt, applyMetadata: (receipt: FileChapterCommitReceipt) => void): FileChapterCommitReceipt
}

/** Complete one recorded operation. The caller supplies the retained DB mutation for that operation. */
export function commitFileChapter(
  input: FileChapterCommit,
  repo: { withCommitLock<T>(work: (locked: LockedFileChapterRepo) => Promise<T>): Promise<T> },
  journal: FileCommitJournal,
  applyMetadata: (receipt: FileChapterCommitReceipt) => void,
  assertCurrent: () => void = () => {},
): Promise<FileChapterCommitReceipt> {
  const intent = structuredClone(input)
  return repo.withCommitLock(locked => commitLocked(intent, locked, journal, applyMetadata, assertCurrent))
}

async function commitLocked(intent: FileChapterCommit, repo: LockedFileChapterRepo,
  journal: FileCommitJournal, applyMetadata: (receipt: FileChapterCommitReceipt) => void,
  assertCurrent: () => void): Promise<FileChapterCommitReceipt> {
  const { chapter, expectedRevision } = intent
  const revision = fileRevision(serializeChapter(chapter))
  const receipt = { status: 'committed', revision } as const
  const current = await repo.byId(chapter.id)
  // Check the number and canonical destination before creating a new recovery obligation.
  const canPrepare = intent.kind === 'create'
    ? !current && await repo.canCreate(chapter)
    : current?.chapter.projectId === chapter.projectId &&
      current.chapter.number === chapter.number && current.revision === expectedRevision
  assertCurrent()
  const completed = journal.prepare(intent, canPrepare)
  if (completed) return completed
  if ((current || intent.kind !== 'create') && current?.chapter.projectId !== chapter.projectId) {
    throw new ChapterError('project-mismatch', 'Commit chapter does not belong to this project')
  }

  // A retry after file publication must skip the write, including its history snapshot.
  // A third revision may belong to an external editor. Leave the intent pending for inspection.
  if (current?.revision !== revision) {
    // Renumbering has a different recovery path because it can leave two filenames after a crash.
    if (!canPrepare) {
      throw new ChapterError('conflict', 'Chapter changed during file commit')
    }
    await repo.save(chapter, { expectedRevision })
  }

  // Only metadata and the receipt share the SQLite transaction. File publication above survives rollback.
  return journal.finish(intent, receipt, applyMetadata)
}
