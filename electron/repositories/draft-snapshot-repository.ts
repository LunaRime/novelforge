/**
 * DraftSnapshotRepository — 草稿快照（追加式历史）
 *
 * v20 起：手动快照、自动快照、Agent 编辑前快照共用一张表。
 * 快照引用 contents.body，不覆盖 drafts。
 */
import { getProjectDb } from '../database'
import { t } from '../../src/shared/locale'
import { ContentRepository } from './content-repository'

export type SnapshotKind = 'auto' | 'manual' | 'pre-agent' | 'pre-restore' | 'branch-base'
export type SnapshotCreatedBy = 'user' | 'agent' | 'system'

export interface DraftSnapshotMeta {
  id: number
  chapterNumber: number
  draftId: number
  branchId: number | null
  label: string
  kind: SnapshotKind
  contentId: number
  contentHash: string
  wordCount: number
  createdBy: SnapshotCreatedBy
  createdAt: number
}

export interface DraftSnapshotFull extends DraftSnapshotMeta {
  content: string
}

function rowToMeta(row: Record<string, unknown>): DraftSnapshotMeta {
  return {
    id: row.id as number,
    chapterNumber: row.chapter_number as number,
    draftId: row.draft_id as number,
    branchId: (row.branch_id as number | null) ?? null,
    label: (row.label as string) || '',
    kind: (row.kind as SnapshotKind) || 'manual',
    contentId: row.content_id as number,
    contentHash: (row.content_hash as string) || '',
    wordCount: (row.word_count as number) || 0,
    createdBy: (row.created_by as SnapshotCreatedBy) || 'user',
    createdAt: (row.created_at as number) || 0,
  }
}

export class DraftSnapshotRepository {
  static create(params: {
    chapterNumber: number
    draftId: number
    branchId?: number | null
    label?: string
    kind: SnapshotKind
    content: string
    contentHash: string
    wordCount: number
    createdBy: SnapshotCreatedBy
  }): number {
    const db = getProjectDb()
    if (!db) throw new Error(t('error.repoDbNotConnected').replace('{repo}', '[DraftSnapshotRepository]'))
    const tx = db.transaction(() => {
      const contentId = ContentRepository.create(params.content)
      const result = db.prepare(`
        INSERT INTO draft_snapshots
          (chapter_number, draft_id, branch_id, label, kind, content_id, content_hash, word_count, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.chapterNumber,
        params.draftId,
        params.branchId ?? null,
        params.label ?? '',
        params.kind,
        contentId,
        params.contentHash,
        params.wordCount,
        params.createdBy,
      )
      return Number(result.lastInsertRowid)
    })
    return tx()
  }

  static listByChapter(chapterNumber: number, limit = 200): DraftSnapshotMeta[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(`
      SELECT * FROM draft_snapshots
      WHERE chapter_number = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(chapterNumber, Math.max(1, Math.min(1000, limit))) as Record<string, unknown>[]
    return rows.map(rowToMeta)
  }

  static getFull(id: number): DraftSnapshotFull | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(`
      SELECT s.*, c.body FROM draft_snapshots s
      JOIN contents c ON s.content_id = c.id
      WHERE s.id = ?
    `).get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return { ...rowToMeta(row), content: (row.body as string) ?? '' }
  }

  /** 保留最近 keep 个 auto，其余删除；manual/pre-agent 等不参与清理 */
  static pruneAuto(chapterNumber: number, keep: number): number {
    const db = getProjectDb()
    if (!db) return 0
    const safeKeep = Math.max(0, Math.min(500, keep))
    const rows = db.prepare(`
      SELECT id, content_id FROM draft_snapshots
      WHERE chapter_number = ? AND kind = 'auto'
      ORDER BY created_at DESC, id DESC
    `).all(chapterNumber) as Array<{ id: number; content_id: number }>
    const stale = rows.slice(safeKeep)
    if (stale.length === 0) return 0
    const tx = db.transaction(() => {
      for (const row of stale) {
        db.prepare('DELETE FROM draft_snapshots WHERE id = ?').run(row.id)
        try { ContentRepository.delete(row.content_id) } catch { /* 仍被其它记录引用则保留 */ }
      }
    })
    tx()
    return stale.length
  }
}
