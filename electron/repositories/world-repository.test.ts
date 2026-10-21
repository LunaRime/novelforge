import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { WorldRepository } from './world-repository'

vi.mock('../database', () => ({
  getProjectDb: () => (globalThis as unknown as { __testDb: DatabaseSync }).__testDb,
}))

let db: DatabaseSync
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE world_entities (uid TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, aliases TEXT DEFAULT '[]', description TEXT DEFAULT '', metadata TEXT DEFAULT '{}', created_at INTEGER DEFAULT (unixepoch()*1000), updated_at INTEGER DEFAULT (unixepoch()*1000), UNIQUE(kind,name));
    CREATE TABLE entity_relations (id INTEGER PRIMARY KEY AUTOINCREMENT, from_uid TEXT NOT NULL, to_uid TEXT NOT NULL, type TEXT NOT NULL, label TEXT DEFAULT '', created_at INTEGER DEFAULT (unixepoch()*1000), UNIQUE(from_uid,to_uid,type));
    CREATE TABLE timeline_events (uid TEXT PRIMARY KEY, title TEXT NOT NULL, lane TEXT DEFAULT 'main', time_value INTEGER DEFAULT 0, time_label TEXT DEFAULT '', chapter_number INTEGER, description TEXT DEFAULT '', entity_uids TEXT DEFAULT '[]', location_uid TEXT, created_at INTEGER DEFAULT (unixepoch()*1000), updated_at INTEGER DEFAULT (unixepoch()*1000));
  `)
  ;(globalThis as unknown as { __testDb: DatabaseSync }).__testDb = db
})

describe('WorldRepository', () => {
  it('实体 upsert/改名保 uid、删除', () => {
    const uid = WorldRepository.upsertEntity({ kind: 'place', name: '青石镇', description: '起点' })
    WorldRepository.upsertEntity({ uid, kind: 'place', name: '青石城', description: '改名' })
    const list = WorldRepository.listEntities('place')
    expect(list).toHaveLength(1)
    expect(list[0].uid).toBe(uid)
    expect(list[0].name).toBe('青石城')
    WorldRepository.deleteEntity(uid)
    expect(WorldRepository.listEntities()).toHaveLength(0)
  })

  it('关系与时间线事件按 uid 关联', () => {
    const a = WorldRepository.upsertEntity({ kind: 'place', name: 'A' })
    const b = WorldRepository.upsertEntity({ kind: 'faction', name: 'B' })
    WorldRepository.upsertRelation({ fromUid: a, toUid: b, type: 'controls', label: '控制' })
    expect(WorldRepository.listRelations(a)[0]).toMatchObject({ fromUid: a, toUid: b, type: 'controls' })
    const eventUid = WorldRepository.upsertEvent({ title: '大战', lane: '主线', timeLabel: '第一年', chapterNumber: 3, entityUids: [a, b] })
    expect(WorldRepository.listEvents()[0]).toMatchObject({ uid: eventUid, lane: '主线', chapterNumber: 3, entityUids: [a, b] })
  })
})
