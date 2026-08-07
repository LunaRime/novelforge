/**
 * CharacterRepository.updateState 单元测试 — mock getProjectDb 用内存 DB 验证 SQL 逻辑
 *
 * 核心验证：哨兵合并下沉后（CASE WHEN 保旧值），并发定稿/慢工作流的旧快照空值
 * 不会覆盖 DB 中较新的真实状态（此前渲染进程内合并存在读快照竞态）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { CharacterRepository, type CharacterData } from './character-repository'

// mock database 模块（避免加载 electron 依赖与原生模块 ABI 冲突）
vi.mock('../database', () => ({
  getProjectDb: () => (globalThis as unknown as { __testDb: DatabaseSync }).__testDb,
}))

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE characters (
      name TEXT PRIMARY KEY,
      role TEXT DEFAULT 'supporting',
      gender TEXT DEFAULT '',
      age TEXT DEFAULT '',
      appearance TEXT DEFAULT '',
      personality TEXT DEFAULT '',
      background TEXT DEFAULT '',
      abilities TEXT DEFAULT '',
      motivation TEXT DEFAULT '',
      relationships TEXT DEFAULT '',
      arc TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      tier INTEGER DEFAULT 2,
      tags TEXT DEFAULT '',
      appear_chapters TEXT DEFAULT '[]',
      relations TEXT DEFAULT '[]',
      cs_location TEXT DEFAULT '',
      cs_power_level TEXT DEFAULT '',
      cs_physical_state TEXT DEFAULT '',
      cs_mental_state TEXT DEFAULT '',
      cs_key_items TEXT DEFAULT '',
      cs_recent_events TEXT DEFAULT '',
      cs_updated_at_chapter INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
  `)
  ;(globalThis as unknown as { __testDb: DatabaseSync }).__testDb = db
})

function makeChar(name: string, overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    name,
    role: 'supporting',
    gender: '', age: '', appearance: '', personality: '',
    background: '', abilities: '', motivation: '',
    relationships: '', arc: '', notes: '',
    tier: 2, tags: '', appearChapters: '[]', relations: '[]',
    ...overrides,
  }
}

function state(location: string, updatedAtChapter = 1) {
  return {
    location,
    powerLevel: '', physicalState: '', mentalState: '',
    keyItems: '', recentEvents: '', updatedAtChapter,
  }
}

describe('CharacterRepository.updateState 哨兵合并（写时刻以 DB 当前值为基准）', () => {
  it('非空值正常覆盖', () => {
    CharacterRepository.upsert(makeChar('张三'))
    CharacterRepository.updateState('张三', state('森林', 3))
    expect(CharacterRepository.getByName('张三')?.currentState?.location).toBe('森林')
    expect(CharacterRepository.getByName('张三')?.currentState?.updatedAtChapter).toBe(3)
  })

  it('空值/哨兵不覆盖已有值（旧快照写入空值 → DB 保留较新状态）', () => {
    CharacterRepository.upsert(makeChar('张三'))
    CharacterRepository.updateState('张三', state('森林', 3))
    // 并发场景：慢工作流基于旧快照（认为无变化）后写入空值——不得清空已有状态；
    // updatedAtChapter 总是更新（重定稿旧章需可回写章节号，故不做单调保护）
    CharacterRepository.updateState('张三', state('', 2))
    const cur = CharacterRepository.getByName('张三')?.currentState
    expect(cur?.location).toBe('森林')
    expect(cur?.updatedAtChapter).toBe(2)
  })

  it('字段级独立保旧：仅空字段保留，非空字段各自覆盖', () => {
    CharacterRepository.upsert(makeChar('张三'))
    CharacterRepository.updateState('张三', { ...state('森林', 3), powerLevel: '金丹期' })
    CharacterRepository.updateState('张三', { ...state('', 4), powerLevel: '元婴期' })
    const cur = CharacterRepository.getByName('张三')?.currentState
    expect(cur?.location).toBe('森林')      // 空 → 保留
    expect(cur?.powerLevel).toBe('元婴期')  // 非空 → 覆盖
  })

  it('tags/motivation COALESCE：null 不覆盖', () => {
    CharacterRepository.upsert(makeChar('张三', { tags: '["主角"]', motivation: '复仇' }))
    CharacterRepository.updateState('张三', state('森林'), { tags: null, motivation: null })
    const char = CharacterRepository.getByName('张三')
    expect(char?.tags).toBe('["主角"]')
    expect(char?.motivation).toBe('复仇')
  })

  it('tags/motivation 有值时覆盖', () => {
    CharacterRepository.upsert(makeChar('张三'))
    CharacterRepository.updateState('张三', state('森林'), { tags: '["新标签"]', motivation: '守护' })
    const char = CharacterRepository.getByName('张三')
    expect(char?.tags).toBe('["新标签"]')
    expect(char?.motivation).toBe('守护')
  })
})
