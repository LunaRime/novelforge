import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createDraftBranch, mergeDraftBranch } from './draft-branch-service'
import { DraftRepository } from '../repositories/draft-repository'

vi.mock('../database', () => ({
  getProjectDb: () => (globalThis as unknown as { __testDb: DatabaseSync }).__testDb,
}))

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL DEFAULT '',
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL,
      version INTEGER NOT NULL,
      status TEXT DEFAULT 'draft',
      source TEXT DEFAULT 'write',
      content_id INTEGER NOT NULL,
      word_count INTEGER DEFAULT 0,
      content_hash TEXT DEFAULT '',
      last_auto_snapshot_at INTEGER DEFAULT 0,
      branch_id INTEGER,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE draft_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL,
      draft_id INTEGER NOT NULL,
      branch_id INTEGER,
      label TEXT DEFAULT '',
      kind TEXT NOT NULL,
      content_id INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      word_count INTEGER DEFAULT 0,
      created_by TEXT DEFAULT 'user',
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE draft_branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      base_snapshot_id INTEGER,
      head_draft_id INTEGER,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000),
      merged_at INTEGER,
      UNIQUE(chapter_number, name)
    );
  `)
  ;(db as unknown as { transaction: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown }).transaction = (fn) => (...args) => fn(...args)
  ;(globalThis as unknown as { __testDb: DatabaseSync }).__testDb = db
  DraftRepository.create({ chapterNumber: 1, version: 1, source: 'write', content: '主线正文', wordCount: 4 })
})

describe('draft-branch-service', () => {
  it('创建分支：复制主线 head，写入 branch_id 与基线快照', () => {
    const { branch, draftId } = createDraftBranch(1, '实验一')
    expect(branch.name).toBe('实验一')
    expect(branch.status).toBe('active')
    expect(branch.baseSnapshotId).toBeGreaterThan(0)
    expect(DraftRepository.getFull(draftId)?.content).toBe('主线正文')
    expect(DraftRepository.getLatestByChapter(1, branch.id)?.id).toBe(draftId)
    expect(DraftRepository.getLatestByChapter(1, null)?.version).toBe(1)
  })

  it('合并分支：生成新的主线版本，不覆盖旧主线', () => {
    const { branch, draftId } = createDraftBranch(1, '实验二')
    DraftRepository.updateContent(draftId, '分支改写正文', 6)
    const merged = mergeDraftBranch(branch.id)
    expect(merged.branch.status).toBe('merged')
    expect(DraftRepository.getFull(merged.draftId)?.content).toBe('分支改写正文')
    expect(DraftRepository.getLatestByChapter(1, null)?.id).toBe(merged.draftId)
  })
})
