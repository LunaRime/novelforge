/**
 * DraftBranchRepository — 章内实验分支（v21）
 *
 * 分支是草稿的隔离线：drafts.branch_id 为 NULL = 主线。
 * 分支只做三件事：创建（复制 head）、切换（读 head）、合并（生成新主线版本）。
 */
import { getProjectDb } from '../database'

export interface DraftBranch {
  id: number
  chapterNumber: number
  name: string
  status: 'active' | 'merged' | 'archived'
  baseSnapshotId: number | null
  headDraftId: number | null
  createdAt: number
  updatedAt: number
  mergedAt: number | null
}

function rowToData(row: Record<string, unknown>): DraftBranch {
  return {
    id: row.id as number,
    chapterNumber: row.chapter_number as number,
    name: (row.name as string) || '',
    status: (row.status as DraftBranch['status']) || 'active',
    baseSnapshotId: (row.base_snapshot_id as number | null) ?? null,
    headDraftId: (row.head_draft_id as number | null) ?? null,
    createdAt: (row.created_at as number) || 0,
    updatedAt: (row.updated_at as number) || 0,
    mergedAt: (row.merged_at as number | null) ?? null,
  }
}

export class DraftBranchRepository {
  static listByChapter(chapterNumber: number): DraftBranch[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(`
      SELECT * FROM draft_branches WHERE chapter_number = ? ORDER BY created_at ASC, id ASC
    `).all(chapterNumber) as Record<string, unknown>[]
    return rows.map(rowToData)
  }

  static get(id: number): DraftBranch | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare('SELECT * FROM draft_branches WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? rowToData(row) : null
  }

  static create(chapterNumber: number, name: string, baseSnapshotId: number | null): number {
    const db = getProjectDb()
    if (!db) throw new Error('db-not-connected')
    const result = db.prepare(`
      INSERT INTO draft_branches (chapter_number, name, base_snapshot_id)
      VALUES (?, ?, ?)
    `).run(chapterNumber, name, baseSnapshotId)
    return Number(result.lastInsertRowid)
  }

  static setBaseSnapshot(id: number, snapshotId: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('UPDATE draft_branches SET base_snapshot_id = ?, updated_at = unixepoch() * 1000 WHERE id = ?').run(snapshotId, id)
  }

  static setHead(id: number, headDraftId: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`
      UPDATE draft_branches SET head_draft_id = ?, updated_at = unixepoch() * 1000 WHERE id = ?
    `).run(headDraftId, id)
  }

  static markMerged(id: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`
      UPDATE draft_branches SET status = 'merged', merged_at = unixepoch() * 1000, updated_at = unixepoch() * 1000 WHERE id = ?
    `).run(id)
  }

  static archive(id: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`
      UPDATE draft_branches SET status = 'archived', updated_at = unixepoch() * 1000 WHERE id = ?
    `).run(id)
  }
}
