import { createHash } from 'node:crypto'
import type { FileChapterCommit, FileChapterCommitReceipt, FileCommitJournal } from '../application/commit-file-chapter'
import { ChapterError } from '../domain/chapter'
import type { ChapterIndexDatabase } from './sqlite-chapter-index'

interface JournalRow {
  intent_hash: string
  revision: string | null
}

const intentHash = (payload: string) => createHash('sha256').update(payload).digest('hex')

function readCommitRow(db: ChapterIndexDatabase, projectId: string, operationId: string): JournalRow | undefined {
  const [row] = db.prepare(
    'SELECT intent_hash, revision FROM file_chapter_commits WHERE project_id = ? AND operation_id = ?',
  ).all(projectId, operationId) as JournalRow[]
  return row
}

/** 读取已提交回执，兼容只读连接。未完成的提交只有待恢复意图。 */
export function readFileChapterCommitReceipt(db: ChapterIndexDatabase, projectId: string,
  operationId: string): FileChapterCommitReceipt | null {
  const revision = readCommitRow(db, projectId, operationId)?.revision
  return revision ? { status: 'committed', revision } : null
}

/** Store this journal in the same retained database connection used by the metadata mutation. */
export class SQLiteFileCommitJournal implements FileCommitJournal {
  constructor(private readonly db: ChapterIndexDatabase, private readonly projectId: string) {
    // The partial index also serializes independent connections. Completed receipts remain available for retries.
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_chapter_commits (
        project_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        payload TEXT,
        intent_hash TEXT NOT NULL,
        revision TEXT,
        CHECK ((payload IS NULL) = (revision IS NOT NULL)),
        PRIMARY KEY (project_id, operation_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_file_chapter_commit_pending
        ON file_chapter_commits(project_id) WHERE revision IS NULL;
    `)
  }

  pending(): FileChapterCommit | null {
    const [row] = this.db.prepare(
      'SELECT payload FROM file_chapter_commits WHERE project_id = ? AND revision IS NULL',
    ).all(this.projectId) as Array<{ payload: string }>
    return row ? JSON.parse(row.payload) : null
  }

  receipt(operationId: string): FileChapterCommitReceipt | null {
    return readFileChapterCommitReceipt(this.db, this.projectId, operationId)
  }

  prepare(intent: FileChapterCommit, allowNew = true): FileChapterCommitReceipt | null {
    if (intent.chapter.projectId !== this.projectId) throw new ChapterError('project-mismatch', 'Commit belongs to another project')
    const validKindAndRevision = intent.kind === 'create'
      ? intent.expectedRevision === null
      : ['merge', 'archive', 'finalize'].includes(intent.kind) && /^[a-f0-9]{64}$/.test(intent.expectedRevision)
    if (!intent.operationId || !Number.isSafeInteger(intent.recordId) || intent.recordId < 1 ||
        !validKindAndRevision) {
      throw new ChapterError('invalid-chapter', 'Invalid file commit intent')
    }
    const payload = JSON.stringify(intent)
    const hash = intentHash(payload)
    if (allowNew) {
      this.db.prepare('INSERT INTO file_chapter_commits (project_id, operation_id, payload, intent_hash) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
        .run(this.projectId, intent.operationId, payload, hash)
    }
    const row = readCommitRow(this.db, this.projectId, intent.operationId)
    if (!row) {
      if (!allowNew) throw new ChapterError('conflict', 'Chapter changed before preparing the file commit')
      throw new ChapterError('locked', 'Another file commit is awaiting recovery')
    }
    if (row.intent_hash !== hash) throw new ChapterError('conflict', 'Operation ID belongs to a different file commit')
    return row.revision ? { status: 'committed', revision: row.revision } : null
  }

  finish(intent: FileChapterCommit, receipt: FileChapterCommitReceipt,
    applyMetadata: (receipt: FileChapterCommitReceipt) => void): FileChapterCommitReceipt {
    // Acquire the write transaction before reading the receipt so a concurrent retry cannot apply metadata twice.
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = readCommitRow(this.db, this.projectId, intent.operationId)
      if (intent.chapter.projectId !== this.projectId || !row || row.intent_hash !== intentHash(JSON.stringify(intent))) {
        throw new ChapterError('conflict', 'No matching prepared file commit')
      }
      if (row.revision) {
        this.db.exec('COMMIT')
        return { status: 'committed', revision: row.revision }
      }
      applyMetadata(receipt)
      // Drop the replay payload when the receipt commits. The chapter file owns the manuscript.
      this.db.prepare('UPDATE file_chapter_commits SET revision = ?, payload = NULL WHERE project_id = ? AND operation_id = ?')
        .run(receipt.revision, this.projectId, intent.operationId)
      this.db.exec('COMMIT')
      return receipt
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
