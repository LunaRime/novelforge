/**
 * ProjectCoreRepository 单元测试 — mock getProjectDb 用内存 DB 验证 SQL 逻辑
 *
 * 覆盖（#27 v13 解耦）：配置字段写独立列而非架构列、旧库共享数据回退读取、
 * 架构字段仍走 project_archives。
 * 注：better-sqlite3 为 Electron 内置 Node 编译（ABI 不兼容系统 Node），
 * 测试用 Node 内置 node:sqlite（DatabaseSync，SQL 语法同源）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { ProjectCoreRepository } from './project-core-repository'

// mock database 模块（避免加载 electron 依赖与原生模块 ABI 冲突）
vi.mock('../database', () => ({
  getProjectDb: () => (globalThis as unknown as { __testDb: DatabaseSync }).__testDb,
}))

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  // v13 结构：project_core 含小说配置独立列；大文本在 project_archives
  db.exec(`
    CREATE TABLE project_core (
      id TEXT PRIMARY KEY DEFAULT 'main',
      project_name TEXT NOT NULL DEFAULT '',
      genre TEXT DEFAULT '',
      sub_genre TEXT DEFAULT '',
      target_audience TEXT DEFAULT '',
      total_chapters INTEGER DEFAULT 100,
      words_per_chapter INTEGER DEFAULT 3000,
      plot_structure TEXT DEFAULT 'three_act',
      narrative_pov TEXT DEFAULT 'third_limited',
      writing_style TEXT DEFAULT '',
      reference_works TEXT DEFAULT '',
      global_guidance TEXT DEFAULT '',
      golden_finger TEXT DEFAULT '',
      core_outline TEXT DEFAULT '',
      world_setting TEXT DEFAULT '',
      protagonist_profile TEXT DEFAULT '',
      character_states TEXT DEFAULT '',
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE project_archives (
      id TEXT PRIMARY KEY,
      project_id TEXT DEFAULT 'main',
      field_key TEXT,
      body TEXT,
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
  `)
  // 模拟 better-sqlite3 的 db.transaction()（node:sqlite 无此 API，用 BEGIN/COMMIT/ROLLBACK 等价实现）
  ;(db as unknown as Record<string, unknown>).transaction = (fn: () => void) => {
    return (...args: unknown[]) => {
      db.exec('BEGIN')
      try {
        const result = (fn as (...a: unknown[]) => unknown)(...args)
        db.exec('COMMIT')
        return result
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    }
  }
  ;(globalThis as unknown as { __testDb: DatabaseSync }).__testDb = db
  ProjectCoreRepository.init('测试项目')
})

describe('ProjectCoreRepository 配置/架构解耦（v13）', () => {
  it('config 字段写入独立列，不污染架构 archives', () => {
    ProjectCoreRepository.update({ coreOutline: '配置核心大纲', worldSetting: '配置世界观', protagonistProfile: '配置主角档案' })

    const col = db.prepare('SELECT core_outline, world_setting, protagonist_profile FROM project_core WHERE id = ?').get('main') as Record<string, string>
    expect(col.core_outline).toBe('配置核心大纲')
    expect(col.world_setting).toBe('配置世界观')
    expect(col.protagonist_profile).toBe('配置主角档案')

    const archiveCount = db.prepare('SELECT COUNT(*) AS c FROM project_archives').get() as { c: number }
    expect(archiveCount.c).toBe(0)
  })

  it('get() 读取独立列', () => {
    ProjectCoreRepository.update({ coreOutline: '配置核心大纲' })
    const data = ProjectCoreRepository.get()
    expect(data?.coreOutline).toBe('配置核心大纲')
    expect(data?.worldSetting).toBe('')
  })

  it('旧库兼容：迁移快照把共享列数据复制到独立列（模拟 v13 迁移 SQL）', () => {
    // v13 前：config 与架构共享 archives（synopsis 等键），先写入旧数据
    ProjectCoreRepository.setArchiveField('synopsis', '架构情节大纲')
    ProjectCoreRepository.setArchiveField('worldbuilding', '架构世界观')
    // 模拟 database.ts v13 迁移段的快照 SQL（独立列为空时复制）
    db.exec(`
      UPDATE project_core SET core_outline = COALESCE(
        (SELECT body FROM project_archives WHERE project_id = 'main' AND field_key = 'synopsis'), '')
        WHERE core_outline IS NULL OR core_outline = '';
      UPDATE project_core SET world_setting = COALESCE(
        (SELECT body FROM project_archives WHERE project_id = 'main' AND field_key = 'worldbuilding'), '')
        WHERE world_setting IS NULL OR world_setting = '';
    `)
    const data = ProjectCoreRepository.get()
    expect(data?.coreOutline).toBe('架构情节大纲')
    expect(data?.worldSetting).toBe('架构世界观')
  })

  it('迁移后解耦：快照后新生成架构不再回显到配置', () => {
    ProjectCoreRepository.setArchiveField('synopsis', '架构情节大纲')
    const data = ProjectCoreRepository.get()
    expect(data?.coreOutline).toBe('') // 新列无快照值时不回退显示架构内容
    expect(data?.synopsis).toBe('架构情节大纲')
  })

  it('架构字段仍写 project_archives（不受解耦影响）', () => {
    ProjectCoreRepository.update({ synopsis: '架构情节大纲' })
    const data = ProjectCoreRepository.get()
    expect(data?.synopsis).toBe('架构情节大纲')
    expect(data?.coreOutline).toBe('') // 不反向污染配置
  })
})
