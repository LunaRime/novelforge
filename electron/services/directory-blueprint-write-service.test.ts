import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getCurrentProjectPath, getProjectDb } from '../database'
import { commitDirectoryBlueprints, readDirectoryBlueprintSnapshot } from './directory-blueprint-write-service'

vi.mock('electron', () => ({}))
vi.mock('../database', () => ({ getCurrentProjectPath: vi.fn(), getProjectDb: vi.fn() }))

function openDatabase() {
  const database = new DatabaseSync(':memory:')
  database.exec(`
    CREATE TABLE project_core (id TEXT PRIMARY KEY, total_chapters INTEGER);
    INSERT INTO project_core VALUES ('main', 2);
    CREATE TABLE blueprints (
      chapter_number INTEGER PRIMARY KEY, title TEXT NOT NULL DEFAULT '', role TEXT DEFAULT '',
      purpose TEXT DEFAULT '', key_events TEXT DEFAULT '', characters TEXT DEFAULT '[]', suspense_hook TEXT DEFAULT '',
      user_guidance TEXT DEFAULT '', notes TEXT DEFAULT '', notes_updated_at INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0, priority INTEGER DEFAULT 0, volume_number INTEGER,
      character_uids TEXT DEFAULT '[]', created_at INTEGER DEFAULT 10, updated_at INTEGER DEFAULT 20
    );
  `)
  const transaction = <T>(work: () => T) => () => {
    database.exec('BEGIN')
    try {
      const result = work()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  vi.mocked(getProjectDb).mockReturnValue(Object.assign(database, { transaction }) as unknown as NonNullable<ReturnType<typeof getProjectDb>>)
  return database
}

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase()
  vi.mocked(getCurrentProjectPath).mockReturnValue('/book')
})
afterEach(() => db.close())

const item = (chapterNumber: number) => ({
  chapterNumber, title: 'Generated', role: '发展', purpose: '', keyEvents: 'Events', characters: ['Hero'], suspenseHook: '',
})
const rows = () => db.prepare('SELECT * FROM blueprints ORDER BY chapter_number').all()

test('whole-book replacement updates generated fields, preserves user fields and removes obsolete rows', () => {
  db.exec(`
    INSERT INTO blueprints (chapter_number,user_guidance,notes,notes_updated_at,sort_order,priority,volume_number,character_uids)
      VALUES (1,'Guidance','Notes','legacy-time',70,2,3,'["stable-id"]');
    INSERT INTO blueprints (chapter_number,title) VALUES (6,'Obsolete');
  `)
  const { snapshot, existingBlueprints } = readDirectoryBlueprintSnapshot({ mode: 'full' })
  expect(existingBlueprints.map(row => row.chapterNumber)).toEqual([1, 6])
  expect(commitDirectoryBlueprints({ snapshot, items: [item(2), item(1)] }))
    .toEqual({ success: true, writtenChapterNumbers: [1, 2], deletedChapterNumbers: [6] })
  expect(rows()[0]).toMatchObject({
    title: 'Generated', user_guidance: 'Guidance', notes: 'Notes', notes_updated_at: 'legacy-time',
    sort_order: 70, priority: 2, volume_number: 3, character_uids: '["stable-id"]', created_at: 10,
  })
})

test('range regeneration tolerates concurrent edits outside the target and preserves those rows', () => {
  db.exec("INSERT INTO blueprints (chapter_number,title) VALUES (1,'One'),(2,'Two'),(9,'Nine')")
  const { snapshot } = readDirectoryBlueprintSnapshot({ mode: 'append', startChapter: 2, count: 1 })
  db.exec("UPDATE blueprints SET title = 'Concurrent' WHERE chapter_number = 1")
  expect(commitDirectoryBlueprints({ snapshot, items: [item(2)] }))
    .toEqual({ success: true, writtenChapterNumbers: [2], deletedChapterNumbers: [] })
  expect(rows().map(row => row.title)).toEqual(['Concurrent', 'Generated', 'Nine'])
})

test.each([
  "UPDATE blueprints SET notes = 'Concurrent' WHERE chapter_number = 1",
  'DELETE FROM blueprints WHERE chapter_number = 1',
  "UPDATE project_core SET total_chapters = 3 WHERE id = 'main'",
])('rejects changed snapshots without overwriting current state (%s)', change => {
  db.exec("INSERT INTO blueprints (chapter_number,title) VALUES (1,'Manual')")
  const { snapshot } = readDirectoryBlueprintSnapshot({ mode: 'full', count: 1 })
  db.exec(change)
  const current = rows()
  expect(commitDirectoryBlueprints({ snapshot, items: [item(1)] })).toMatchObject({ success: false, reason: 'conflict' })
  expect(rows()).toEqual(current)
})

test('sparse append uses the highest chapter and an occupied target rejects the whole write', () => {
  db.exec("INSERT INTO blueprints (chapter_number,title) VALUES (1,'One'),(5,'Five')")
  const { snapshot } = readDirectoryBlueprintSnapshot({ mode: 'append', count: 2 })
  expect(snapshot.range?.first).toBe(6)
  db.exec("INSERT INTO blueprints (chapter_number,title) VALUES (7,'Concurrent')")
  const current = rows()
  expect(commitDirectoryBlueprints({ snapshot, items: [item(6), item(7)] })).toMatchObject({ success: false, reason: 'conflict' })
  expect(rows()).toEqual(current)
})

test('rejects a whole-book snapshot when the displayed and persisted totals differ', () => {
  db.exec("INSERT INTO blueprints (chapter_number,title) VALUES (3,'Still in the displayed plan')")
  const request = { mode: 'full' as const, expectedTotalChapters: 3 }
  expect(() => readDirectoryBlueprintSnapshot(request)).toThrow()
  expect(rows()[0].title).toBe('Still in the displayed plan')
})

test('a failing whole-book cleanup rolls back preceding updates and inserts', () => {
  db.exec(`
    INSERT INTO blueprints (chapter_number,title) VALUES (1,'Old'),(8,'Obsolete');
    CREATE TRIGGER fail_cleanup BEFORE DELETE ON blueprints BEGIN SELECT RAISE(ABORT, 'cleanup failed'); END;
  `)
  const before = rows()
  const { snapshot } = readDirectoryBlueprintSnapshot({ mode: 'full' })
  expect(commitDirectoryBlueprints({ snapshot, items: [item(1), item(2)] })).toMatchObject({ success: false, reason: 'storage' })
  expect(rows()).toEqual(before)
})

test('a failing append insert rolls back the first insert', () => {
  db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON blueprints WHEN NEW.chapter_number = 2 BEGIN SELECT RAISE(ABORT, 'second failed'); END")
  const { snapshot } = readDirectoryBlueprintSnapshot({ mode: 'append' })
  expect(commitDirectoryBlueprints({ snapshot, items: [item(1), item(2)] })).toMatchObject({ success: false, reason: 'storage' })
  expect(rows()).toEqual([])
})

test('rejects incomplete output, a modified snapshot and a reopened connection', () => {
  const { snapshot } = readDirectoryBlueprintSnapshot({ mode: 'full' })
  expect(commitDirectoryBlueprints({ snapshot, items: [item(1)] })).toMatchObject({ success: false, reason: 'invalid' })
  expect(commitDirectoryBlueprints({ snapshot: { ...snapshot, range: { ...snapshot.range!, mode: 'replace-range' } }, items: [item(1), item(2)] }))
    .toMatchObject({ success: false, reason: 'conflict' })
  const reopened = openDatabase()
  try {
    expect(commitDirectoryBlueprints({ snapshot, items: [item(1), item(2)] })).toMatchObject({ success: false, reason: 'scope' })
    expect(reopened.prepare('SELECT * FROM blueprints').all()).toEqual([])
  } finally {
    reopened.close()
  }
})
