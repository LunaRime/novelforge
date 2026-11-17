import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
// Electron binaries are absent in CI. Database access is an explicit test seam.
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../database', () => ({ getProjectDb: vi.fn() }))
import { getProjectDb } from '../database'
import { reorderChapter } from './binder-service'

let db: DatabaseSync
let serial = 0
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE blueprints (chapter_number INTEGER PRIMARY KEY, title TEXT, volume_number INTEGER, sort_order INTEGER, updated_at INTEGER DEFAULT 20);
    CREATE TABLE volumes (volume_number INTEGER PRIMARY KEY, title TEXT, chapter_start INTEGER, chapter_end INTEGER, updated_at INTEGER DEFAULT 20);
    INSERT INTO volumes VALUES (1,'One',1,3,20),(2,'Two',4,5,20);
    INSERT INTO blueprints VALUES (1,'A',1,10,20),(2,'B',1,20,20),(3,'C',1,30,20),(4,'D',2,10,20),(5,'E',2,20,20),(6,'F',NULL,10,20)`)
  const connection = Object.assign(db, { transaction: <T>(work: () => T) => () => {
    const name = `binder_tx_${++serial}`
    db.exec(`SAVEPOINT ${name}`)
    try { const result = work(); db.exec(`RELEASE ${name}`); return result }
    catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error }
  } })
  vi.mocked(getProjectDb).mockReturnValue(connection as unknown as NonNullable<ReturnType<typeof getProjectDb>>)
})
afterEach(() => { vi.restoreAllMocks(); db.close() })
const members = (volume: number | null) => db.prepare(`SELECT chapter_number, sort_order FROM blueprints WHERE ${volume === null ? 'volume_number IS NULL' : 'volume_number = ?'} ORDER BY sort_order, chapter_number`).all(...(volume === null ? [] : [volume]))
const snapshot = () => ({ blueprints: db.prepare('SELECT * FROM blueprints ORDER BY chapter_number').all(), volumes: db.prepare('SELECT * FROM volumes ORDER BY volume_number').all() })
test('cross-volume reorder preserves chapter identities and reindexes both groups and display ranges', () => {
  expect(reorderChapter(2, 2, 1)).toEqual({ chapterNumber: 2, volumeNumber: 2 })
  expect(members(1)).toEqual([{ chapter_number: 1, sort_order: 10 }, { chapter_number: 3, sort_order: 20 }])
  expect(members(2)).toEqual([{ chapter_number: 4, sort_order: 10 }, { chapter_number: 2, sort_order: 20 }, { chapter_number: 5, sort_order: 30 }])
  expect(db.prepare('SELECT chapter_number, title FROM blueprints ORDER BY chapter_number').all()).toEqual(['A','B','C','D','E','F'].map((title, i) => ({ chapter_number: i + 1, title })))
  expect(db.prepare('SELECT volume_number, chapter_start, chapter_end FROM volumes ORDER BY volume_number').all()).toEqual([{ volume_number: 1, chapter_start: 1, chapter_end: 3 }, { volume_number: 2, chapter_start: 2, chapter_end: 5 }])
})
test('same-volume reorder inserts at requested index and default appends', () => {
  reorderChapter(3, 1, 0)
  expect(members(1).map(row => row.chapter_number)).toEqual([3, 1, 2])
  reorderChapter(3, 1)
  expect(members(1)).toEqual([{ chapter_number: 1, sort_order: 10 }, { chapter_number: 2, sort_order: 20 }, { chapter_number: 3, sort_order: 30 }])
})
test('supports unassigned membership and moving the final chapter empties the old range', () => {
  reorderChapter(4, null); reorderChapter(5, null)
  expect(members(null).map(row => row.chapter_number).sort()).toEqual([4, 5, 6])
  expect(db.prepare('SELECT chapter_start, chapter_end FROM volumes WHERE volume_number=2').get()).toEqual({ chapter_start: 0, chapter_end: 0 })
  reorderChapter(6, 1, 0); expect(members(1).map(row => row.chapter_number)).toEqual([6, 1, 2, 3])
})
test.each(['order', 'range'])('rolls back both full tables when the later %s stage aborts', phase => {
  const before = snapshot()
  db.exec(phase === 'order'
    ? "CREATE TRIGGER abort_order BEFORE UPDATE OF sort_order ON blueprints WHEN NEW.chapter_number=5 BEGIN SELECT RAISE(ABORT,'later stage failed'); END"
    : "CREATE TRIGGER abort_range BEFORE UPDATE ON volumes WHEN NEW.volume_number=2 BEGIN SELECT RAISE(ABORT,'later stage failed'); END")
  expect(() => reorderChapter(2, 2, 0)).toThrow('later stage failed')
  expect(snapshot()).toEqual(before)
})
test('missing chapters fail without changing either table', () => {
  const before = snapshot(); expect(() => reorderChapter(99, 2)).toThrow('chapter-not-found'); expect(snapshot()).toEqual(before)
})
