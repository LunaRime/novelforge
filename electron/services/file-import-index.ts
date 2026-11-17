import Database from 'better-sqlite3'
import type { FileImportExcerpt, ProjectChannels } from '../../src/shared/ipc-channels'
import { tokenizeToSpaceSeparated } from '../chinese-tokenizer'
import { chunkText } from '../embedding'

type ImportSource = ProjectChannels['project:file-editor-import-source']['return']

export const fileImportIndexPath = '.novelforge/file-import-index.v1.db'

const inferenceTerms = ['世界观', '世界', '主角', '冲突', '叙事', '力量', 'world', 'protagonist', 'conflict', 'power',
  'мир', 'герой', 'конфликт', 'сила'].map(term => `"${term}"`).join(' OR ')

export function readImportInferenceContext(path: string, source: ImportSource): ProjectChannels['project:file-editor-import-inference']['return'] {
  const { projectId, chapters } = source
  const revisions = chapters.map(({ chapterId, revision }) => ({ chapterId, revision }))
  if (!chapters.length) throw new Error('No published chapters to infer')
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    // 在相关性排序和截取前同时限定章 ID 与发布 revision，旧分块和其他批次不进入模型上下文。
    const excerpts = db.prepare(`
      SELECT c.chapter_number AS number, substr(c.title, 1, 240) AS title, substr(c.content, 1, 1000) AS content
      FROM import_fts
      JOIN import_chunks c ON c.id = import_fts.rowid
      JOIN json_each(?) s ON json_extract(s.value, '$.chapterId') = c.chapter_id
        AND json_extract(s.value, '$.revision') = c.revision
      WHERE import_fts MATCH ?
      ORDER BY import_fts.rank, c.chapter_number, c.ordinal
      LIMIT 6
    `).all(JSON.stringify(revisions), inferenceTerms) as FileImportExcerpt[]
    // 首、中、末各保留一个正文样本，全文索引没有关键词命中时仍有上下文。
    const samples = [...new Set([0, Math.floor(chapters.length / 2), chapters.length - 1])].map(index => {
      const { number, title, content } = chapters[index]
      return { number, title: title.slice(0, 240), content: content.slice(0, 2000) }
    })
    return { projectId, revisions, samples, excerpts }
  } finally { db.close() }
}

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
