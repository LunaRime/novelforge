import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../database', () => ({ getProjectDb: vi.fn() }))
import { getProjectDb } from '../database'
import { BlueprintRepository, type BlueprintData } from './blueprint-repository'

let db: DatabaseSync
let serial = 0
const blueprint = (chapterNumber: number): BlueprintData => ({ chapterNumber, title: `Chapter ${chapterNumber}`, role: '发展', purpose: 'purpose', keyEvents: 'events', characters: ['Alice', 'Bob'], suspenseHook: 'hook', userGuidance: 'guidance', notes: 'notes', notesUpdatedAt: 'yesterday', sortOrder: 4, priority: 3, volumeNumber: 2 })
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE blueprints (chapter_number INTEGER PRIMARY KEY, title TEXT, role TEXT,
    purpose TEXT, key_events TEXT, characters TEXT, suspense_hook TEXT, user_guidance TEXT,
    notes TEXT, notes_updated_at TEXT, sort_order INTEGER, priority INTEGER, volume_number INTEGER,
    created_at INTEGER DEFAULT 10, updated_at INTEGER DEFAULT 20)`)
  const connection = Object.assign(db, { transaction: <T>(work: () => T) => () => {
    const name = `blueprint_tx_${++serial}`
    db.exec(`SAVEPOINT ${name}`)
    try { const result = work(); db.exec(`RELEASE ${name}`); return result }
    catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error }
  } })
  vi.mocked(getProjectDb).mockReturnValue(connection as unknown as NonNullable<ReturnType<typeof getProjectDb>>)
})
afterEach(() => { vi.restoreAllMocks(); db.close() })

test('upsertMany persists complete blueprint rows in one transaction', () => {
  const items = [blueprint(1), blueprint(2)]
  BlueprintRepository.upsertMany(items)
  expect(BlueprintRepository.getAll()).toEqual(items)
})
test.each(['update', 'insert'])('rolls back the earlier %s including characters and metadata when the second row aborts', first => {
  if (first === 'update') BlueprintRepository.upsert({ ...blueprint(1), title: 'original', characters: ['Original'], priority: 9, volumeNumber: null })
  const before = db.prepare('SELECT * FROM blueprints ORDER BY chapter_number').all()
  db.exec("CREATE TRIGGER abort_second BEFORE INSERT ON blueprints WHEN NEW.chapter_number=2 BEGIN SELECT RAISE(ABORT,'second row failed'); END")
  expect(() => BlueprintRepository.upsertMany([blueprint(1), blueprint(2), blueprint(3)])).toThrow('second row failed')
  expect(db.prepare('SELECT * FROM blueprints ORDER BY chapter_number').all()).toEqual(before)
})
