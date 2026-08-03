/**
 * VolumeRepository 单元测试 — mock getProjectDb 用内存 DB 验证 SQL 逻辑
 *
 * 覆盖：upsert ON CONFLICT(volume_number) 合并、getByChapter 含边界、delete。
 * 注：better-sqlite3 为 Electron 内置 Node 编译（ABI 不兼容系统 Node），
 * 测试用 Node 内置 node:sqlite（DatabaseSync，SQL 语法同源）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { VolumeRepository } from './volume-repository'

// mock database 模块（避免加载 electron 依赖与原生模块 ABI 冲突）
vi.mock('../database', () => ({
  getProjectDb: () => (globalThis as unknown as { __testDb: DatabaseSync }).__testDb,
}))

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE volumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      volume_number INTEGER NOT NULL UNIQUE,
      title TEXT DEFAULT '',
      description TEXT DEFAULT '',
      chapter_start INTEGER NOT NULL DEFAULT 0,
      chapter_end INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
  `)
  ;(globalThis as unknown as { __testDb: DatabaseSync }).__testDb = db
})

describe('VolumeRepository.upsert', () => {
  it('插入新分卷并按卷号升序返回', () => {
    VolumeRepository.upsert({ volumeNumber: 2, title: '卷二', description: '', chapterStart: 21, chapterEnd: 40 })
    VolumeRepository.upsert({ volumeNumber: 1, title: '卷一', description: '', chapterStart: 1, chapterEnd: 20 })
    const all = VolumeRepository.getAll()
    expect(all.map(v => v.volumeNumber)).toEqual([1, 2])
    expect(all[0].title).toBe('卷一')
    expect(all[0].chapterStart).toBe(1)
    expect(all[0].chapterEnd).toBe(20)
  })

  it('同卷号 upsert 按卷号覆盖（不产生重复行）', () => {
    VolumeRepository.upsert({ volumeNumber: 1, title: '旧标题', description: '', chapterStart: 1, chapterEnd: 10 })
    VolumeRepository.upsert({ volumeNumber: 1, title: '新标题', description: '', chapterStart: 1, chapterEnd: 30 })
    const all = VolumeRepository.getAll()
    expect(all.length).toBe(1)
    expect(all[0].title).toBe('新标题')
    expect(all[0].chapterEnd).toBe(30)
  })
})

describe('VolumeRepository.getByChapter', () => {
  it('含边界匹配（start ≤ n ≤ end）', () => {
    VolumeRepository.upsert({ volumeNumber: 1, title: '卷一', description: '', chapterStart: 1, chapterEnd: 20 })
    VolumeRepository.upsert({ volumeNumber: 2, title: '卷二', description: '', chapterStart: 21, chapterEnd: 40 })
    expect(VolumeRepository.getByChapter(1)?.volumeNumber).toBe(1)
    expect(VolumeRepository.getByChapter(20)?.volumeNumber).toBe(1)
    expect(VolumeRepository.getByChapter(21)?.volumeNumber).toBe(2)
    expect(VolumeRepository.getByChapter(41)).toBeNull()
  })

  it('进行中卷（end=0）覆盖 start 之后所有章节', () => {
    VolumeRepository.upsert({ volumeNumber: 1, title: '进行中', description: '', chapterStart: 1, chapterEnd: 0 })
    expect(VolumeRepository.getByChapter(50)?.volumeNumber).toBe(1)
  })
})

describe('VolumeRepository.delete', () => {
  it('删除指定卷号，其余保留', () => {
    VolumeRepository.upsert({ volumeNumber: 1, title: '卷一', description: '', chapterStart: 1, chapterEnd: 10 })
    VolumeRepository.upsert({ volumeNumber: 2, title: '卷二', description: '', chapterStart: 11, chapterEnd: 20 })
    VolumeRepository.delete(1)
    const all = VolumeRepository.getAll()
    expect(all.length).toBe(1)
    expect(all[0].volumeNumber).toBe(2)
  })
})
