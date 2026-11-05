import type { ChapterMeta } from '../domain/chapter'
import type { ChapterIndex } from '../ports/chapter-index'

type SqlValue = string | number | null

/** A project-owned SQLite connection; the adapter never opens a database itself. */
export interface ChapterIndexDatabase {
  exec(sql: string): unknown
  prepare(sql: string): {
    all(...values: SqlValue[]): unknown[]
    run(...values: SqlValue[]): unknown
  }
}

export class SQLiteChapterIndex implements ChapterIndex {
  constructor(private readonly db: ChapterIndexDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS chapter_index (
      id TEXT PRIMARY KEY NOT NULL,
      number INTEGER NOT NULL UNIQUE CHECK (number > 0),
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'revised', 'reviewed', 'finalized', 'archived')),
      path TEXT NOT NULL,
      revision TEXT NOT NULL,
      wordCount INTEGER NOT NULL CHECK (wordCount >= 0)
    )`)
  }

  async list(): Promise<ChapterMeta[]> {
    return this.db.prepare(
      'SELECT id, number, title, status, path, revision, wordCount FROM chapter_index ORDER BY number',
    ).all() as ChapterMeta[]
  }

  async replace(entries: ChapterMeta[]): Promise<void> {
    // Savepoints compose with a caller transaction while keeping a full rebuild atomic.
    this.db.exec('SAVEPOINT chapter_index_replace')
    try {
      this.db.exec('DELETE FROM chapter_index')
      const insert = this.db.prepare(
        'INSERT INTO chapter_index (id, number, title, status, path, revision, wordCount) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      for (const entry of entries) {
        insert.run(entry.id, entry.number, entry.title, entry.status, entry.path, entry.revision, entry.wordCount)
      }
      this.db.exec('RELEASE chapter_index_replace')
    } catch (error) {
      this.db.exec('ROLLBACK TO chapter_index_replace')
      this.db.exec('RELEASE chapter_index_replace')
      throw error
    }
  }
}
