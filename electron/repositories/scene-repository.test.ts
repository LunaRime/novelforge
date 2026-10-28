import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SceneRepository } from './scene-repository'

vi.mock('../database', () => ({
  getProjectDb: () => (globalThis as unknown as { __sceneDb: DatabaseSync }).__sceneDb,
}))

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE scene_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL,
      title TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      status TEXT DEFAULT 'planned',
      sort_order INTEGER DEFAULT 0,
      word_count INTEGER DEFAULT 0,
      content_id INTEGER,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
  `)
  ;(globalThis as unknown as { __sceneDb: DatabaseSync }).__sceneDb = db
})

describe('SceneRepository', () => {
  it('按 sort_order 升序列出本章场景', () => {
    SceneRepository.upsert({ chapterNumber: 1, title: 'B', summary: '', status: 'planned', sortOrder: 20, wordCount: 0 })
    SceneRepository.upsert({ chapterNumber: 1, title: 'A', summary: '', status: 'done', sortOrder: 10, wordCount: 120 })
    SceneRepository.upsert({ chapterNumber: 2, title: 'other', summary: '', status: 'planned', sortOrder: 0, wordCount: 0 })

    const list = SceneRepository.listByChapter(1)
    expect(list.map(s => s.title)).toEqual(['A', 'B'])
    expect(list[0]).toMatchObject({ status: 'done', wordCount: 120, chapterNumber: 1 })
  })

  it('reorder 按给定顺序重排，步长 10', () => {
    const a = SceneRepository.upsert({ chapterNumber: 1, title: 'A', summary: '', status: 'planned', sortOrder: 10, wordCount: 0 })
    const b = SceneRepository.upsert({ chapterNumber: 1, title: 'B', summary: '', status: 'planned', sortOrder: 20, wordCount: 0 })
    const c = SceneRepository.upsert({ chapterNumber: 1, title: 'C', summary: '', status: 'planned', sortOrder: 30, wordCount: 0 })

    SceneRepository.reorder(1, [c, a, b])

    const list = SceneRepository.listByChapter(1)
    expect(list.map(s => s.id)).toEqual([c, a, b])
    expect(list.map(s => s.sortOrder)).toEqual([10, 20, 30])
  })

  it('reorder 忽略不属于本章的 id，不污染其他章', () => {
    const own = SceneRepository.upsert({ chapterNumber: 1, title: 'own', summary: '', status: 'planned', sortOrder: 10, wordCount: 0 })
    const foreign = SceneRepository.upsert({ chapterNumber: 2, title: 'foreign', summary: '', status: 'planned', sortOrder: 10, wordCount: 0 })

    SceneRepository.reorder(1, [foreign, own])

    expect(SceneRepository.listByChapter(1).map(s => s.id)).toEqual([own])
    expect(SceneRepository.listByChapter(2).map(s => s.id)).toEqual([foreign])
    expect(SceneRepository.listByChapter(2)[0].sortOrder).toBe(10)
  })

  it('upsert 带 id 时更新不新增，delete 移除', () => {
    const id = SceneRepository.upsert({ chapterNumber: 1, title: 'A', summary: '', status: 'planned', sortOrder: 10, wordCount: 0 })
    SceneRepository.upsert({ id, chapterNumber: 1, title: 'A2', summary: '概要', status: 'writing', sortOrder: 10, wordCount: 50 })

    const list = SceneRepository.listByChapter(1)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id, title: 'A2', status: 'writing', wordCount: 50 })

    SceneRepository.delete(id)
    expect(SceneRepository.listByChapter(1)).toHaveLength(0)
  })
})
