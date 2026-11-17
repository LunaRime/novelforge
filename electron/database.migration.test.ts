import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) } }))
vi.mock('./utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./vector-store', () => ({ closeConnection: vi.fn() }))
vi.mock('better-sqlite3', () => ({
  default: class TestDatabase extends DatabaseSync {
    pragma(statement: string, options?: { simple?: boolean }) {
      const rows = this.prepare(`PRAGMA ${statement}`).all()
      return options?.simple ? Object.values(rows[0] ?? {})[0] : rows
    }

    transaction<T>(work: () => T) {
      return () => {
        this.exec('SAVEPOINT migration_test')
        try {
          const result = work()
          this.exec('RELEASE migration_test')
          return result
        } catch (error) {
          this.exec('ROLLBACK TO migration_test; RELEASE migration_test')
          throw error
        }
      }
    }
  },
}))

import { closeProjectDatabase, getProjectDb, initProjectDatabase } from './database'

const roots: string[] = []
afterEach(async () => {
  closeProjectDatabase()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

test('the SQLite entry rejects a file project before creating a database or closing the current project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-file-activation-'))
  roots.push(root)
  const candidate = join(root, 'candidate')
  const internal = join(candidate, '.novelforge')
  await mkdir(internal, { recursive: true })
  await writeFile(join(internal, 'file-editor.json'), '{invalid')
  initProjectDatabase(join(root, 'original'))
  const original = getProjectDb()
  expect(() => initProjectDatabase(candidate)).toThrow()
  expect(getProjectDb()).toBe(original)
  expect(await readdir(internal)).toEqual(['file-editor.json'])
})

test('opening a v19 project adds the branch column before indexing and preserves draft contents on reopen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-v19-migration-'))
  roots.push(root)
  const dir = join(root, '.novelforge')
  await mkdir(dir)
  const legacy = new DatabaseSync(join(dir, 'vela.db'))
  try {
    legacy.exec(`
      PRAGMA user_version = 19;
      CREATE TABLE contents (id INTEGER PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE drafts (id INTEGER PRIMARY KEY, chapter_number INTEGER NOT NULL, version INTEGER NOT NULL,
        status TEXT, source TEXT, content_id INTEGER NOT NULL REFERENCES contents(id), word_count INTEGER,
        created_at INTEGER, updated_at INTEGER);
      INSERT INTO contents VALUES (1, '旧项目正文', 1, 1);
      INSERT INTO drafts VALUES (2, 1, 1, 'draft', 'write', 1, 5, 1, 1);
    `)
  } finally { legacy.close() }

  for (let pass = 0; pass < 2; pass++) {
    initProjectDatabase(root)
    const db = getProjectDb()!
    expect(db.pragma('user_version', { simple: true })).toBe(23)
    expect(db.pragma('index_info(idx_drafts_chapter_branch)')).toEqual([
      expect.objectContaining({ name: 'chapter_number' }),
      expect.objectContaining({ name: 'branch_id' }),
      expect.objectContaining({ name: 'version' }),
    ])
    expect(db.prepare('SELECT d.id, d.branch_id, d.content_hash, c.body FROM drafts d JOIN contents c ON c.id = d.content_id').get()).toEqual({
      id: 2, branch_id: null, content_hash: createHash('sha256').update('旧项目正文').digest('hex'), body: '旧项目正文',
    })
    closeProjectDatabase()
  }
})
