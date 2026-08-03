/**
 * PreferenceRepository 单元测试 — mock getProjectDb 用内存 DB 验证 SQL 逻辑
 *
 * 覆盖：record 的 UNIQUE 合并 count+1、last_chapter 更新、getTop 排序与近因过滤。
 * 注：better-sqlite3 为 Electron 内置 Node 编译（ABI 不兼容系统 Node），
 * 测试用 Node 内置 node:sqlite（DatabaseSync，SQL 语法同源）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { PreferenceRepository } from './preference-repository'

vi.mock('../database', () => ({
  getProjectDb: () => (globalThis as unknown as { __testDb: DatabaseSync }).__testDb,
}))

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ai_text TEXT NOT NULL,
      user_text TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      last_chapter INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000),
      UNIQUE (ai_text, user_text)
    );
  `)
  ;(globalThis as unknown as { __testDb: DatabaseSync }).__testDb = db
})

describe('PreferenceRepository.record', () => {
  it('首次记录 count=1', () => {
    PreferenceRepository.record('神色一凝', '皱了皱眉', 5)
    const top = PreferenceRepository.getTop(10)
    expect(top.length).toBe(1)
    expect(top[0].aiText).toBe('神色一凝')
    expect(top[0].userText).toBe('皱了皱眉')
    expect(top[0].count).toBe(1)
    expect(top[0].lastChapter).toBe(5)
  })

  it('同替换对重复记录 count 累加，last_chapter 更新', () => {
    PreferenceRepository.record('神色一凝', '皱了皱眉', 5)
    PreferenceRepository.record('神色一凝', '皱了皱眉', 8)
    PreferenceRepository.record('神色一凝', '皱了皱眉', 12)
    const top = PreferenceRepository.getTop(10)
    expect(top.length).toBe(1)
    expect(top[0].count).toBe(3)
    expect(top[0].lastChapter).toBe(12)
  })

  it('不同替换对各自独立计数', () => {
    PreferenceRepository.record('神色一凝', '皱了皱眉', 1)
    PreferenceRepository.record('淡淡说道', '轻声说道', 1)
    const top = PreferenceRepository.getTop(10)
    expect(top.length).toBe(2)
  })

  it('相同文本或空文本不记录', () => {
    PreferenceRepository.record('相同', '相同')
    PreferenceRepository.record('', '非空')
    PreferenceRepository.record('非空', '')
    expect(PreferenceRepository.getTop(10).length).toBe(0)
  })
})

describe('PreferenceRepository.getTop', () => {
  it('按 count 降序返回', () => {
    PreferenceRepository.record('A词', 'a替换', 1)
    PreferenceRepository.record('B词', 'b替换', 1)
    PreferenceRepository.record('B词', 'b替换', 2)
    PreferenceRepository.record('B词', 'b替换', 3)
    const top = PreferenceRepository.getTop(10)
    expect(top[0].aiText).toBe('B词')
    expect(top[0].count).toBe(3)
  })

  it('limit 限制返回数量', () => {
    PreferenceRepository.record('A词', 'a替换', 1)
    PreferenceRepository.record('B词', 'b替换', 1)
    PreferenceRepository.record('C词', 'c替换', 1)
    const top = PreferenceRepository.getTop(2)
    expect(top.length).toBe(2)
  })

  it('recentChapters 过滤：last_chapter=0 或无章节信息的记录被排除', () => {
    PreferenceRepository.record('近因词', '近因替换', 8)
    PreferenceRepository.record('旧词', '旧替换', 1)
    PreferenceRepository.record('无章节', '无章节替换') // last_chapter=0
    const top = PreferenceRepository.getTop(10, 5) // 最近 5 章内
    expect(top.map(p => p.aiText)).toEqual(['近因词'])
  })
})
