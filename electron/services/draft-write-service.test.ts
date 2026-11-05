import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'

vi.mock('../database', () => ({ getProjectDb: vi.fn() }))
vi.mock('./draft-snapshot-service', () => ({ maybeCreateAutoSnapshot: vi.fn() }))
vi.mock('../utils/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
import { getProjectDb } from '../database'
import { maybeCreateAutoSnapshot } from './draft-snapshot-service'
import { commitDatabaseDraft } from './draft-write-service'
import { DraftRepository } from '../repositories/draft-repository'

let db: DatabaseSync
let savepoint = 0
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
beforeEach(() => {
  vi.clearAllMocks()
  db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE contents (id INTEGER PRIMARY KEY, body TEXT, updated_at INTEGER);
    CREATE TABLE drafts (id INTEGER PRIMARY KEY, chapter_number INTEGER, version INTEGER,
    status TEXT, source TEXT, content_id INTEGER, word_count INTEGER, created_at INTEGER,
    updated_at INTEGER, content_hash TEXT, last_auto_snapshot_at INTEGER, branch_id INTEGER);
    CREATE TABLE draft_snapshots (id INTEGER PRIMARY KEY, chapter_number INTEGER, draft_id INTEGER,
    branch_id INTEGER, label TEXT, kind TEXT, content_id INTEGER, content_hash TEXT, word_count INTEGER, created_by TEXT);
    INSERT INTO contents VALUES (1, 'old', 100);
    INSERT INTO drafts VALUES (1, 1, 1, 'draft', 'write', 1, 3, 100, 100, '${hash('old')}', 0, NULL);`)
  const connection = Object.assign(db, { transaction: <T>(work: () => T) => () => {
    const name = `test_tx_${++savepoint}`
    db.exec(`SAVEPOINT ${name}`)
    try { const result = work(); db.exec(`RELEASE ${name}`); return result }
    catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error }
  } })
  vi.mocked(getProjectDb).mockReturnValue(connection as unknown as NonNullable<ReturnType<typeof getProjectDb>>)
})
afterEach(() => { db.close() })

test('agent writes snapshot and正文 in one transaction', () => {
  const result = commitDatabaseDraft({ draftId: 1, content: 'new', wordCount: 3, actor: 'agent', expectedHash: hash('old'), expectedUpdatedAt: 100 })
  expect(result.success).toBe(true)
  expect(db.prepare('SELECT body FROM contents WHERE id=1').get()?.body).toBe('new')
  expect(db.prepare('SELECT c.body FROM draft_snapshots s JOIN contents c ON c.id=s.content_id').get()?.body).toBe('old')
})
test('stale CAS and finalized agent edits do not create snapshots or mutate content', () => {
  expect(commitDatabaseDraft({ draftId: 1, content: 'new', wordCount: 3, actor: 'agent', expectedHash: 'stale', expectedUpdatedAt: 100 }).conflict).toBe(true)
  db.exec("UPDATE drafts SET status='finalized'")
  expect(commitDatabaseDraft({ draftId: 1, content: 'new', wordCount: 3, actor: 'agent', expectedHash: hash('old'), expectedUpdatedAt: 100 }).error).toBe('draft-finalized-readonly')
  expect(db.prepare('SELECT COUNT(*) n FROM draft_snapshots').get()?.n).toBe(0)
  expect(db.prepare('SELECT body FROM contents WHERE id=1').get()?.body).toBe('old')
})
test('content update failure rolls back the pre-agent snapshot too', () => {
  db.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON drafts BEGIN SELECT RAISE(ABORT, 'disk error'); END")
  expect(() => commitDatabaseDraft({ draftId: 1, content: 'new', wordCount: 3, actor: 'agent', expectedHash: hash('old'), expectedUpdatedAt: 100 })).toThrow('disk error')
  expect(db.prepare('SELECT COUNT(*) n FROM draft_snapshots').get()?.n).toBe(0)
  expect(db.prepare('SELECT COUNT(*) n FROM contents').get()?.n).toBe(1)
  expect(db.prepare('SELECT body FROM contents WHERE id=1').get()?.body).toBe('old')
})
test('late CAS rejection rolls back its pre-agent snapshot', () => {
  const apply = vi.spyOn(DraftRepository, 'applyContentIfUnchanged').mockReturnValue({ ok: false, conflict: true, currentHash: 'newer', currentUpdatedAt: 200 })
  try {
    expect(commitDatabaseDraft({ draftId: 1, content: 'new', wordCount: 3, actor: 'agent', expectedHash: hash('old'), expectedUpdatedAt: 100 })).toMatchObject({ success: false, conflict: true, currentHash: 'newer' })
    expect(db.prepare('SELECT COUNT(*) n FROM draft_snapshots').get()?.n).toBe(0)
  } finally { apply.mockRestore() }
})
test('user writes keep auto-snapshot failure nonblocking and missing drafts fail', () => {
  vi.mocked(maybeCreateAutoSnapshot).mockImplementation(() => { throw new Error('snapshot unavailable') })
  expect(commitDatabaseDraft({ draftId: 1, content: 'new', wordCount: 3, actor: 'user' }).success).toBe(true)
  expect(commitDatabaseDraft({ draftId: 99, content: 'new', wordCount: 3, actor: 'user' }).error).toBe('draft-not-found')
  expect(db.prepare('SELECT body FROM contents WHERE id=1').get()?.body).toBe('new')
})
test('malformed writes never alter draft content', () => {
  expect(commitDatabaseDraft({ draftId: 1, content: 'new', wordCount: -1, actor: 'user' })).toEqual({ success: false, error: 'invalid-draft-write' })
  expect(commitDatabaseDraft({ draftId: 1, content: 'new', wordCount: 3, actor: 'agent' })).toEqual({ success: false, error: 'invalid-draft-write' })
  expect(db.prepare('SELECT body FROM contents WHERE id=1').get()?.body).toBe('old')
})
test('disconnected writes never report success', () => {
  vi.mocked(getProjectDb).mockReturnValue(null)
  expect(commitDatabaseDraft({ draftId: 1, content: 'new', wordCount: 3, actor: 'user' }).success).toBe(false)
})
