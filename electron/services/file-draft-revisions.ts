import { ChapterError, type ChapterIndexDatabase } from '../../src/core'

export function openFileDraftRevisions(db: ChapterIndexDatabase, projectId: string) {
  // 旧候选副本在首次打开时幂等建表，文件稿修稿使用自己的章节身份。
  db.exec(`CREATE TABLE IF NOT EXISTS file_draft_revisions (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    base_revision TEXT NOT NULL,
    offer_id TEXT NOT NULL,
    body TEXT NOT NULL,
    merged_revision TEXT,
    UNIQUE(project_id, offer_id)
  );
  CREATE INDEX IF NOT EXISTS idx_file_draft_revisions_pending
    ON file_draft_revisions(project_id, chapter_id, base_revision, id) WHERE merged_revision IS NULL;`)

  return {
    stage(chapterId: string, baseRevision: string, offerId: string, body: string) {
      db.prepare(`INSERT INTO file_draft_revisions (project_id, chapter_id, base_revision, offer_id, body)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, offer_id) DO NOTHING`).run(projectId, chapterId, baseRevision, offerId, body)
      const [saved] = db.prepare(`SELECT id FROM file_draft_revisions WHERE project_id = ? AND offer_id = ?`)
        .all(projectId, offerId) as Array<{ id: number }>
      return saved.id
    },
    pending(chapterId: string, baseRevision: string) {
      return db.prepare(`SELECT id FROM file_draft_revisions
        WHERE project_id = ? AND chapter_id = ? AND base_revision = ? AND merged_revision IS NULL ORDER BY id`)
        .all(projectId, chapterId, baseRevision) as Array<{ id: number }>
    },
    body(chapterId: string, baseRevision: string, revisionId: number) {
      const [revision] = db.prepare(`SELECT body FROM file_draft_revisions
        WHERE id = ? AND project_id = ? AND chapter_id = ? AND base_revision = ? AND merged_revision IS NULL`)
        .all(revisionId, projectId, chapterId, baseRevision) as Array<{ body: string }>
      if (typeof revision?.body !== 'string') throw new ChapterError('conflict', 'File draft revision is unavailable')
      return revision.body
    },
    merge(chapterId: string, baseRevision: string, revisionId: number, body: string, mergedRevision: string) {
      // 与发布回执同一事务，写入真正落盘的版本并核对预览正文。
      if (!db.prepare(`UPDATE file_draft_revisions SET merged_revision = ?
        WHERE id = ? AND project_id = ? AND chapter_id = ? AND base_revision = ? AND merged_revision IS NULL AND body = ? RETURNING id`)
        .all(mergedRevision, revisionId, projectId, chapterId, baseRevision, body).length) {
        throw new ChapterError('conflict', 'File draft revision changed before committing')
      }
    },
  }
}
