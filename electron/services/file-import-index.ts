import Database from 'better-sqlite3'
import type { ProjectChannels } from '../../src/shared/ipc-channels'
import { tokenizeToSpaceSeparated } from '../chinese-tokenizer'
import { chunkText } from '../embedding'

type ImportSource = ProjectChannels['project:file-editor-import-source']['return']

export const fileImportIndexPath = '.novelforge/file-import-index.v1.db'

export function indexImportedChapters(path: string, chapters: ImportSource['chapters']): ProjectChannels['project:file-editor-index-import']['return'] {
  if (!chapters.length) return { indexed: 0, chunks: 0 }
  const db = new Database(path)
  try {
    // 派生库的分块与全文索引用同一事务提交。失败时保留上一版可检索的数据。
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS import_chunks (
          id INTEGER PRIMARY KEY, chapter_id TEXT NOT NULL, chapter_number INTEGER NOT NULL,
          revision TEXT NOT NULL, title TEXT NOT NULL, ordinal INTEGER NOT NULL,
          content TEXT NOT NULL, tokens TEXT NOT NULL, UNIQUE(chapter_id, ordinal)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS import_fts USING fts5(tokens, content='import_chunks', content_rowid='id');
        CREATE TRIGGER IF NOT EXISTS import_chunks_insert AFTER INSERT ON import_chunks BEGIN
          INSERT INTO import_fts(rowid, tokens) VALUES (new.id, new.tokens);
        END;
        CREATE TRIGGER IF NOT EXISTS import_chunks_delete AFTER DELETE ON import_chunks BEGIN
          INSERT INTO import_fts(import_fts, rowid, tokens) VALUES ('delete', old.id, old.tokens);
        END;
      `)
      const remove = db.prepare('DELETE FROM import_chunks WHERE chapter_id = ?')
      const insert = db.prepare(`INSERT INTO import_chunks (chapter_id, chapter_number, revision, title, ordinal, content, tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      let chunks = 0
      for (const chapter of chapters) {
        remove.run(chapter.chapterId)
        for (const [ordinal, content] of chunkText(chapter.content, 500, 50).entries()) {
          const searchable = `${chapter.title}\n${content}`
          insert.run(chapter.chapterId, chapter.number, chapter.revision, chapter.title, ordinal, content,
            tokenizeToSpaceSeparated(searchable) || searchable)
          chunks++
        }
      }
      db.exec('COMMIT')
      return { indexed: chapters.length, chunks }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } finally { db.close() }
}
