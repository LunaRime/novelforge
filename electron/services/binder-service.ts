/**
 * 活页夹重排（v22）：章节号不变，只改卷成员与 sort_order。
 * targetIndex 省略时追加到目标卷末尾。
 */
import { getProjectDb } from '../database'

export interface BinderReorderResult {
  chapterNumber: number
  volumeNumber: number | null
}

export function reorderChapter(chapterNumber: number, toVolumeNumber: number | null, targetIndex?: number): BinderReorderResult {
  const db = getProjectDb()
  if (!db) throw new Error('db-not-connected')
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT chapter_number, volume_number, sort_order FROM blueprints WHERE chapter_number = ?')
      .get(chapterNumber) as { chapter_number: number; volume_number: number | null; sort_order: number } | undefined
    if (!row) throw new Error('chapter-not-found')
    const oldVolume = row.volume_number

    db.prepare('UPDATE blueprints SET volume_number = ?, updated_at = unixepoch() * 1000 WHERE chapter_number = ?')
      .run(toVolumeNumber, chapterNumber)

    const reindex = (volume: number | null) => {
      const rows = db.prepare(`
        SELECT chapter_number FROM blueprints
        WHERE ${volume === null ? 'volume_number IS NULL' : 'volume_number = ?'}
        ORDER BY sort_order ASC, chapter_number ASC
      `).all(...(volume === null ? [] : [volume])) as Array<{ chapter_number: number }>
      const stmt = db.prepare('UPDATE blueprints SET sort_order = ? WHERE chapter_number = ?')
      rows.forEach((r, i) => stmt.run((i + 1) * 10, r.chapter_number))
    }

    if (toVolumeNumber !== null) {
      const targetRows = db.prepare(`
        SELECT chapter_number FROM blueprints
        WHERE volume_number = ? AND chapter_number != ?
        ORDER BY sort_order ASC, chapter_number ASC
      `).all(toVolumeNumber, chapterNumber) as Array<{ chapter_number: number }>
      const insertAt = targetIndex === undefined
        ? targetRows.length
        : Math.max(0, Math.min(targetRows.length, targetIndex))
      const ordered = targetRows.map(r => r.chapter_number)
      ordered.splice(insertAt, 0, chapterNumber)
      const stmt = db.prepare('UPDATE blueprints SET sort_order = ? WHERE chapter_number = ?')
      ordered.forEach((cn, i) => stmt.run((i + 1) * 10, cn))
    } else {
      reindex(null)
    }
    if (oldVolume !== toVolumeNumber && oldVolume !== null) reindex(oldVolume)

    // 重算受影响卷的展示区间
    const volumes = new Set<number>()
    if (oldVolume !== null) volumes.add(oldVolume)
    if (toVolumeNumber !== null) volumes.add(toVolumeNumber)
    for (const v of volumes) {
      const range = db.prepare(`
        SELECT MIN(chapter_number) AS minCh, MAX(chapter_number) AS maxCh
        FROM blueprints WHERE volume_number = ?
      `).get(v) as { minCh: number | null; maxCh: number | null }
      db.prepare('UPDATE volumes SET chapter_start = ?, chapter_end = ?, updated_at = unixepoch() * 1000 WHERE volume_number = ?')
        .run(range.minCh ?? 0, range.maxCh ?? 0, v)
    }
    return { chapterNumber, volumeNumber: toVolumeNumber }
  })
  return tx()
}
