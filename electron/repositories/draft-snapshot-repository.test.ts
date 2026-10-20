/**
 * DraftSnapshotRepository — 内存 DB 测试（node:sqlite）。
 * 覆盖：创建/列表/全文、auto 保留窗口。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { DraftSnapshotRepository } from './draft-snapshot-repository'

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
      version INTEGER NOT NULL
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
    INSERT INTO drafts (id, chapter_number, version) VALUES (1, 1, 1);
  `)
  ;(db as unknown as { transaction: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown }).transaction = (fn) => (...args) => fn(...args)
  ;(globalThis as unknown as { __testDb: DatabaseSync }).__testDb = db
})

function create(kind: 'auto' | 'manual', label = '') {
  return DraftSnapshotRepository.create({
    chapterNumber: 1,
    draftId: 1,
    label,
    kind,
    content: `content-${label || kind}`,
    contentHash: `hash-${label || kind}`,
    wordCount: 10,
    createdBy: 'user',
  })
}

describe('DraftSnapshotRepository', () => {
  it('创建、列出与读取全文', () => {
    const id = create('manual', '命名快照')
    const list = DraftSnapshotRepository.listByChapter(1)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id, label: '命名快照', kind: 'manual', wordCount: 10 })
    expect(DraftSnapshotRepository.getFull(id)?.content).toBe('content-命名快照')
  })

  it('pruneAuto 只清理超出的 auto，保留 manual', () => {
    create('manual', 'm1')
    const ids = [create('auto', 'a1'), create('auto', 'a2'), create('auto', 'a3')]
    const removed = DraftSnapshotRepository.pruneAuto(1, 1)
    expect(removed).toBe(2)
    const list = DraftSnapshotRepository.listByChapter(1)
    expect(list.filter(s => s.kind === 'manual')).toHaveLength(1)
    expect(list.filter(s => s.kind === 'auto')).toHaveLength(1)
    expect(list.some(s => s.id === ids[2])).toBe(true)
  })
})
