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
}
