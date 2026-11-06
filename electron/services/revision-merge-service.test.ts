import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../database', () => ({ getProjectDb: vi.fn(), getCurrentProjectPath: vi.fn() }))
vi.mock('../utils/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
import { getProjectDb, getCurrentProjectPath } from '../database'
import { mergeDatabaseRevision } from './revision-merge-service'
import { DraftRepository } from '../repositories/draft-repository'

let db: DatabaseSync
let serial = 0
const input = { projectPath: '/project', draftId: 1, revisionId: 2, chapterNumber: 3, content: 'merged', wordCount: 6, expectedContent: 'old' }
beforeEach(() => {
  vi.clearAllMocks()
  db = new DatabaseSync(':memory:')
  const hash = createHash('sha256').update('old').digest('hex')
  db.exec(`CREATE TABLE contents (id INTEGER PRIMARY KEY, body TEXT, updated_at INTEGER);
    CREATE TABLE drafts (id INTEGER PRIMARY KEY, chapter_number INTEGER, version INTEGER,
    status TEXT, source TEXT, content_id INTEGER, word_count INTEGER, created_at INTEGER,
    updated_at INTEGER, content_hash TEXT, last_auto_snapshot_at INTEGER, branch_id INTEGER);
    CREATE TABLE revisions (id INTEGER PRIMARY KEY, base_draft_id INTEGER, revision_index INTEGER,
    revision_type TEXT, status TEXT, merged_to_draft_id INTEGER, content_id INTEGER,
    word_count INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE draft_snapshots (id INTEGER PRIMARY KEY, chapter_number INTEGER, draft_id INTEGER,
    branch_id INTEGER, label TEXT, kind TEXT, content_id INTEGER, content_hash TEXT, word_count INTEGER,
    created_by TEXT, created_at INTEGER DEFAULT 0);
    INSERT INTO contents VALUES (1,'old',100),(2,'revision',100);
    INSERT INTO drafts VALUES (1,3,1,'draft','write',1,3,100,100,'${hash}',0,NULL);
    INSERT INTO revisions VALUES (2,1,1,'refine','pending',NULL,2,8,100,100);`)
  const connection = Object.assign(db, { transaction: <T>(work: () => T) => () => {
    const name = `merge_tx_${++serial}`
    db.exec(`SAVEPOINT ${name}`)
    try { const result = work(); db.exec(`RELEASE ${name}`); return result }
    catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error }
  } })
  vi.mocked(getProjectDb).mockReturnValue(connection as unknown as NonNullable<ReturnType<typeof getProjectDb>>)
  vi.mocked(getCurrentProjectPath).mockReturnValue('/project')
})
afterEach(() => { vi.restoreAllMocks(); db.close() })
function unchanged() {
  expect(db.prepare('SELECT body FROM contents WHERE id=1').get()?.body).toBe('old')
  expect(db.prepare('SELECT status FROM drafts WHERE id=1').get()?.status).toBe('draft')
  expect(db.prepare('SELECT word_count,updated_at,last_auto_snapshot_at,content_hash FROM drafts WHERE id=1').get())
    .toMatchObject({ word_count: 3, updated_at: 100, last_auto_snapshot_at: 0,
      content_hash: createHash('sha256').update('old').digest('hex') })
  expect(db.prepare('SELECT status FROM revisions WHERE id=2').get()?.status).toBe('pending')
  expect(db.prepare('SELECT merged_to_draft_id FROM revisions WHERE id=2').get()?.merged_to_draft_id).toBeNull()
  expect(db.prepare('SELECT COUNT(*) n FROM draft_snapshots').get()?.n).toBe(0)
  expect(db.prepare('SELECT COUNT(*) n FROM contents').get()?.n).toBe(2)
}
test('commits content, revised status, revision ownership and auto snapshot together', () => {
  expect(mergeDatabaseRevision(input)).toEqual({ success: true, chapterNumber: 3 })
  expect(db.prepare('SELECT body FROM contents WHERE id=1').get()?.body).toBe('merged')
  expect(db.prepare('SELECT status FROM drafts WHERE id=1').get()?.status).toBe('revised')
  expect(db.prepare('SELECT status,merged_to_draft_id target FROM revisions WHERE id=2').get()).toMatchObject({ status: 'merged', target: 1 })
  expect(db.prepare('SELECT COUNT(*) n FROM draft_snapshots').get()?.n).toBe(1)
})
test.each(['status', 'revision'])('rolls content and auto snapshot back when %s update aborts', stage => {
  db.exec(stage === 'status'
    ? "CREATE TRIGGER abort_merge BEFORE UPDATE OF status ON drafts WHEN NEW.status='revised' BEGIN SELECT RAISE(ABORT,'status failed'); END"
    : "CREATE TRIGGER abort_merge BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT,'revision failed'); END")
  expect(mergeDatabaseRevision(input).success).toBe(false)
  unchanged()
})
test.each(['status', 'revision'])('rolls everything back when %s update affects zero rows', stage => {
  db.exec(stage === 'status'
    ? "CREATE TRIGGER ignore_merge BEFORE UPDATE OF status ON drafts WHEN NEW.status='revised' BEGIN SELECT RAISE(IGNORE); END"
    : "CREATE TRIGGER ignore_merge BEFORE UPDATE ON revisions BEGIN SELECT RAISE(IGNORE); END")
  expect(mergeDatabaseRevision(input).success).toBe(false)
  unchanged()
})
test('stale original content and late CAS reject without mutation', () => {
  expect(mergeDatabaseRevision({ ...input, expectedContent: 'older' }).conflict).toBe(true)
  unchanged()
  vi.spyOn(DraftRepository, 'applyContentIfUnchanged').mockReturnValue({ ok: false, conflict: true })
  expect(mergeDatabaseRevision(input).conflict).toBe(true)
  unchanged()
})
test.each(['finalized','archived'])('rejects %s drafts', status => {
  db.prepare('UPDATE drafts SET status=? WHERE id=1').run(status)
  expect(mergeDatabaseRevision(input)).toMatchObject({ success: false, error: 'draft-finalized-readonly' })
  expect(db.prepare('SELECT body FROM contents WHERE id=1').get()?.body).toBe('old')
  expect(db.prepare('SELECT status FROM revisions WHERE id=2').get()?.status).toBe('pending')
})
test('validates pending revision ownership and chapter identity', () => {
  expect(mergeDatabaseRevision({ ...input, chapterNumber: 4 }).success).toBe(false)
  db.exec('UPDATE revisions SET base_draft_id=99 WHERE id=2')
  expect(mergeDatabaseRevision(input).success).toBe(false)
  db.exec("UPDATE revisions SET base_draft_id=1,status='discarded' WHERE id=2")
  expect(mergeDatabaseRevision(input).success).toBe(false)
  expect(db.prepare('SELECT body FROM contents WHERE id=1').get()?.body).toBe('old')
})
test('rejects cross-project, disconnected and malformed requests', () => {
  expect(mergeDatabaseRevision({ ...input, projectPath: '/other' }).success).toBe(false)
  expect(mergeDatabaseRevision({ ...input, draftId: -1 }).success).toBe(false)
  expect(mergeDatabaseRevision({ ...input, expectedContent: undefined } as unknown as typeof input).success).toBe(false)
  unchanged()
  vi.mocked(getProjectDb).mockReturnValue(null)
  expect(mergeDatabaseRevision(input)).toMatchObject({ success: false, error: 'project-db-not-connected' })
})
