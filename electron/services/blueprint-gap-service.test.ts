import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../database', () => ({ getProjectDb: vi.fn(), getCurrentProjectPath: vi.fn() }))
import { getCurrentProjectPath, getProjectDb } from '../database'
import { captureBlueprintWriteScope, insertDatabaseMissingBlueprints } from './blueprint-gap-service'
import type { BlueprintData } from '../repositories/blueprint-repository'

let db: DatabaseSync
let serial = 0
function connection(database: DatabaseSync) {
  return Object.assign(database, { transaction: <T>(work: () => T) => () => {
    const name = `gap_tx_${++serial}`; database.exec(`SAVEPOINT ${name}`)
    try { const result = work(); database.exec(`RELEASE ${name}`); return result }
    catch (error) { database.exec(`ROLLBACK TO ${name}`); database.exec(`RELEASE ${name}`); throw error }
  } }) as unknown as NonNullable<ReturnType<typeof getProjectDb>>
}
const schema = `CREATE TABLE blueprints (chapter_number INTEGER PRIMARY KEY, title TEXT, role TEXT, purpose TEXT,
  key_events TEXT, characters TEXT, suspense_hook TEXT, user_guidance TEXT, notes TEXT, notes_updated_at INTEGER,
  sort_order INTEGER, priority INTEGER, volume_number INTEGER, created_at INTEGER DEFAULT 10, updated_at INTEGER DEFAULT 20)`
const row = (chapterNumber: number): BlueprintData => ({ chapterNumber, title: 'Generated', role: '发展', purpose: '', keyEvents: 'Event', characters: ['Hero'], suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: 0, sortOrder: chapterNumber, priority: 0, volumeNumber: null })
const snapshot = () => db.prepare('SELECT * FROM blueprints ORDER BY chapter_number').all()
beforeEach(() => {
  db = new DatabaseSync(':memory:'); db.exec(schema)
  vi.mocked(getProjectDb).mockReturnValue(connection(db)); vi.mocked(getCurrentProjectPath).mockReturnValue('/a')
})
afterEach(() => { vi.restoreAllMocks(); db.close() })
test('never changes occupied rows or their user fields and is safe to replay', () => {
  db.exec(`INSERT INTO blueprints VALUES (1,'Manual','高潮','Purpose','Events','["Alice"]','Hook','Guidance','Notes',1234,70,2,3,10,20)`)
  const original = snapshot()[0]
  const input = { scope: captureBlueprintWriteScope(), targetChapterNumbers: [1, 2], items: [row(1), row(2)] }
  expect(insertDatabaseMissingBlueprints(input)).toEqual({ success: true, insertedChapterNumbers: [2], skippedChapterNumbers: [1] })
  expect(snapshot()[0]).toEqual(original)
  expect(insertDatabaseMissingBlueprints(input)).toEqual({ success: true, insertedChapterNumbers: [], skippedChapterNumbers: [1, 2] })
  expect(snapshot()[0]).toEqual(original)
})
test('preserves a blueprint inserted after the generation scope was captured', () => {
  const scope = captureBlueprintWriteScope()
  db.exec(`INSERT INTO blueprints (chapter_number,title) VALUES (2,'Concurrent')`)
  expect(insertDatabaseMissingBlueprints({ scope, targetChapterNumbers: [2], items: [row(2)] })).toMatchObject({ success: true, skippedChapterNumbers: [2] })
  expect(snapshot()[0].title).toBe('Concurrent')
})
test('rolls back all inserted rows when the second item fails', () => {
  db.exec(`CREATE TRIGGER abort_second BEFORE INSERT ON blueprints WHEN NEW.chapter_number=2 BEGIN SELECT RAISE(ABORT,'second failed'); END`)
  expect(insertDatabaseMissingBlueprints({ scope: captureBlueprintWriteScope(), targetChapterNumbers: [1, 2], items: [row(1), row(2)] })).toMatchObject({ success: false })
  expect(snapshot()).toEqual([])
})
test('rejects an old connection token even when a replacement opens the same path', () => {
  const scope = captureBlueprintWriteScope()
  const other = new DatabaseSync(':memory:'); other.exec(schema)
  vi.mocked(getProjectDb).mockReturnValue(connection(other))
  try {
    expect(captureBlueprintWriteScope()).not.toEqual(scope)
    expect(insertDatabaseMissingBlueprints({ scope, targetChapterNumbers: [1], items: [row(1)] })).toMatchObject({ success: false })
    expect(other.prepare('SELECT * FROM blueprints').all()).toEqual([])
  } finally { other.close() }
})
test('no database and invalid or out-of-target inputs cannot return a false success', () => {
  const scope = captureBlueprintWriteScope()
  expect(insertDatabaseMissingBlueprints({ scope, targetChapterNumbers: [1], items: [row(2)] })).toMatchObject({ success: false })
  expect(snapshot()).toEqual([])
  vi.mocked(getProjectDb).mockReturnValue(null)
  expect(() => captureBlueprintWriteScope()).toThrow()
  expect(insertDatabaseMissingBlueprints({ scope, targetChapterNumbers: [1], items: [row(1)] })).toMatchObject({ success: false })
})
