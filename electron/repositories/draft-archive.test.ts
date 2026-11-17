import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getCurrentProjectPath, getProjectDb } from '../database'
import { DraftRepository } from './draft-repository'

vi.mock('electron', () => ({}))
vi.mock('../database', () => ({ getCurrentProjectPath: vi.fn(), getProjectDb: vi.fn() }))

let db: DatabaseSync
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE drafts (id INTEGER PRIMARY KEY, chapter_number INTEGER, version INTEGER, status TEXT, updated_at INTEGER);
    INSERT INTO drafts VALUES (1, 4, 3, 'draft', 10), (2, 4, 3, 'revised', 20), (3, 5, 1, 'finalized', 30);
  `)
  vi.mocked(getProjectDb).mockReturnValue(db as unknown as NonNullable<ReturnType<typeof getProjectDb>>)
  vi.mocked(getCurrentProjectPath).mockReturnValue('/book')
})
afterEach(() => db.close())

const statuses = () => db.prepare('SELECT status FROM drafts ORDER BY id').all().map(row => row.status)

it('archives only the selected real ID when two drafts share chapter and version', () => {
  const result = DraftRepository.archive('/book', 2, 4)
  expect(result?.updatedAt).toBeGreaterThan(20)
  expect(statuses()).toEqual(['draft', 'archived', 'finalized'])
  expect(DraftRepository.archive('/book', 2, 4)).toBeNull()
})

it('refuses finalization during confirmation, missing rows, mismatched chapters, and other projects', () => {
  db.exec("UPDATE drafts SET status = 'finalized' WHERE id = 1")
  expect(DraftRepository.archive('/book', 1, 4)).toBeNull()
  expect(DraftRepository.archive('/book', 999, 4)).toBeNull()
  expect(DraftRepository.archive('/book', 2, 5)).toBeNull()
  expect(DraftRepository.archive('/different', 2, 4)).toBeNull()
  expect(statuses()).toEqual(['finalized', 'revised', 'finalized'])
})

it('leaves the row unchanged when SQLite rejects the write', () => {
  db.exec("CREATE TRIGGER reject_archive BEFORE UPDATE ON drafts BEGIN SELECT RAISE(ABORT, 'write failed'); END")
  expect(() => DraftRepository.archive('/book', 1, 4)).toThrow('write failed')
  expect(statuses()).toEqual(['draft', 'revised', 'finalized'])
})
