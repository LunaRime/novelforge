/**
 * PublicationRepository — 连载监控（手动导入平台章节）
 *
 * 本地优先设计：不自动抓取平台内容（无网络爬取/登录——产品边界），
 * 作者手动粘贴平台章节正文，与本地定稿对比相似度 + 审计。
 */
import { getProjectDb } from '../database'

export interface PublicationEntry {
  chapterNumber: number
  externalTitle: string
  externalContent: string
  importedAt: number
  /** 与本地定稿的相似度（0-1，导入时计算） */
  similarity: number
  /** 审计告警数（术语/水文，导入时计算） */
  auditIssues: number
}

export class PublicationRepository {
  static getAll(): PublicationEntry[] {
    const db = getProjectDb()
    if (!db) return []
    return db.prepare(`
      SELECT chapter_number as chapterNumber, external_title as externalTitle,
             external_content as externalContent, imported_at as importedAt,
             similarity, audit_issues as auditIssues
      FROM publication_tracker ORDER BY chapter_number ASC
    `).all() as PublicationEntry[]
  }

  static upsert(entry: Omit<PublicationEntry, 'externalContent'> & { externalContent: string }): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`
      INSERT INTO publication_tracker (chapter_number, external_title, external_content, imported_at, similarity, audit_issues)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(chapter_number) DO UPDATE SET
        external_title = excluded.external_title,
        external_content = excluded.external_content,
        imported_at = excluded.imported_at,
        similarity = excluded.similarity,
        audit_issues = excluded.audit_issues
    `).run(
      entry.chapterNumber,
      entry.externalTitle,
      entry.externalContent,
      entry.importedAt,
      entry.similarity,
      entry.auditIssues,
    )
  }

  static delete(chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM publication_tracker WHERE chapter_number = ?').run(chapterNumber)
  }
}
