import { getProjectDb } from '../database'

export interface SceneCard {
  id: number
  chapterNumber: number
  title: string
  summary: string
  status: string
  sortOrder: number
  wordCount: number
  contentId: number | null
}

function rowToData(row: Record<string, unknown>): SceneCard {
  return {
    id: row.id as number,
    chapterNumber: row.chapter_number as number,
    title: (row.title as string) || '',
    summary: (row.summary as string) || '',
    status: (row.status as string) || 'planned',
    sortOrder: (row.sort_order as number) || 0,
    wordCount: (row.word_count as number) || 0,
    contentId: (row.content_id as number | null) ?? null,
  }
}

export class SceneRepository {
  static listByChapter(chapterNumber: number): SceneCard[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(`SELECT * FROM scene_cards WHERE chapter_number = ? ORDER BY sort_order ASC, id ASC`)
      .all(chapterNumber) as Record<string, unknown>[]
    return rows.map(rowToData)
  }

  static upsert(data: Omit<SceneCard, 'id' | 'contentId'> & { id?: number; contentId?: number | null }): number {
    const db = getProjectDb()
    if (!db) throw new Error('db-not-connected')
    if (data.id) {
      db.prepare(`
        UPDATE scene_cards SET title = ?, summary = ?, status = ?, sort_order = ?, word_count = ?, content_id = ?, updated_at = unixepoch() * 1000
        WHERE id = ?
      `).run(data.title, data.summary, data.status, data.sortOrder, data.wordCount, data.contentId ?? null, data.id)
      return data.id
    }
    const res = db.prepare(`
      INSERT INTO scene_cards (chapter_number, title, summary, status, sort_order, word_count, content_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(data.chapterNumber, data.title, data.summary, data.status, data.sortOrder, data.wordCount, data.contentId ?? null)
    return Number(res.lastInsertRowid)
  }

  static delete(id: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM scene_cards WHERE id = ?').run(id)
  }

  /**
   * 按给定顺序重排某章的场景卡（步长 10，留出手工插入余量）。
   *
   * 显式 BEGIN/COMMIT 而非 better-sqlite3 的 `db.transaction()`——测试用 node:sqlite 的
   * DatabaseSync 没有该 API（见 automation-repository 同一取舍）。只更新属于本章的 id，
   * 跨章 id 会被静默跳过（调用方传错时不会污染别的章）。
   */
  static reorder(chapterNumber: number, orderedIds: number[]): void {
    const db = getProjectDb()
    if (!db) return
    if (orderedIds.length === 0) return
    const stmt = db.prepare('UPDATE scene_cards SET sort_order = ?, updated_at = unixepoch() * 1000 WHERE id = ? AND chapter_number = ?')
    db.exec('BEGIN')
    try {
      orderedIds.forEach((id, index) => { stmt.run((index + 1) * 10, id, chapterNumber) })
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}
