import { DatabaseSync } from 'node:sqlite'
import { expect, test, vi } from 'vitest'
import type { BlueprintData } from '../repositories/blueprint-repository'

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  connection: undefined as DatabaseSync | undefined,
}))
vi.mock('electron', () => ({}))
vi.mock('../database', () => ({ getProjectDb: () => fixture.connection, getCurrentProjectPath: () => '/project' }))
vi.mock('../security/ipc-guard', () => ({ guardedHandle: (key: string, handler: never) => fixture.handlers.set(key, handler) }))

import { registerDatabaseController } from './db-controller'

test('旧连接令牌不能写入同路径重开的项目，普通编辑仍可保存', async () => {
  const originalDb = new DatabaseSync(':memory:')
  const reopenedDb = new DatabaseSync(':memory:')
  registerDatabaseController()
  const capture = fixture.handlers.get('db:blueprint-write-scope')!
  const upsert = fixture.handlers.get('db:blueprint-upsert')!
  const data: BlueprintData = {
    chapterNumber: 4, title: '推演蓝图', role: '发展', purpose: '', keyEvents: '', characters: [],
    suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: 0, sortOrder: 4, priority: 0,
  }

  try {
    reopenedDb.exec(`CREATE TABLE blueprints (chapter_number INTEGER PRIMARY KEY, title TEXT, role TEXT, purpose TEXT,
      key_events TEXT, characters TEXT, suspense_hook TEXT, user_guidance TEXT, notes TEXT, notes_updated_at INTEGER,
      sort_order INTEGER, priority INTEGER, volume_number INTEGER, updated_at INTEGER)`)
    fixture.connection = originalDb
    const original = await capture({})
    fixture.connection = reopenedDb

    const rows = () => reopenedDb.prepare('SELECT chapter_number, title FROM blueprints ORDER BY chapter_number').all()
    await expect(upsert({}, data, original)).resolves.toMatchObject({ success: false })
    expect(rows()).toEqual([])
    await expect(upsert({}, data, await capture({}))).resolves.toEqual({ success: true })
    await expect(upsert({}, { ...data, chapterNumber: 5, title: '手工蓝图' })).resolves.toEqual({ success: true })
    expect(rows()).toEqual([{ chapter_number: 4, title: '推演蓝图' }, { chapter_number: 5, title: '手工蓝图' }])
  } finally {
    fixture.connection = undefined
    reopenedDb.close()
    originalDb.close()
  }
})
