import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'
import { serializeChapter } from '../core/adapters/chapter-format'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'nf doctor #'))
  roots.push(root)
  await mkdir(join(root, 'chapters'))
  await writeFile(join(root, 'novel.json'), JSON.stringify({ id: 'fixture', schemaVersion: 1 }))
  return root
}

function chapter(number: number, id = 'ch_12345678', content = '') {
  return serializeChapter({ id, number, projectId: 'fixture', title: '', status: 'draft',
    createdAt: '2026-11-13T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z', content })
}

async function inventory(directory: string): Promise<unknown[]> {
  return Promise.all((await readdir(directory, { withFileTypes: true })).map(async entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? [entry.name, await inventory(path)] :
      [entry.name, (await stat(path)).mtimeMs, await readFile(path)]
  }))
}

function doctor(root: string) {
  const result = spawnSync(process.execPath, ['scripts/doctor.mjs', root], { encoding: 'utf8' })
  expect(result.error).toBeUndefined()
  expect(result.stdout, result.stderr).not.toBe('')
  return { status: result.status, report: JSON.parse(result.stdout) }
}

test('doctor accepts an empty chapter body without initializing storage', async () => {
  const root = await project()
  await writeFile(join(root, 'chapters/0001.md'), chapter(1))
  const before = await inventory(root)
  const result = doctor(root)
  expect(result).toEqual({ status: 0, report: { projectId: 'fixture', ok: true, legacyDatabase: 'absent', issues: [] } })
  expect(await inventory(root)).toEqual(before)
})

test('doctor collects concurrent findings and leaves files, locks and temporary files intact', async () => {
  const root = await project()
  await mkdir(join(root, '.novelforge/locks'), { recursive: true })
  await mkdir(join(root, 'history/ch_12345678'), { recursive: true })
  await writeFile(join(root, 'chapters/0001.md'), chapter(1, 'ch_12345678', 'private manuscript'))
  await writeFile(join(root, 'chapters/0002.md'), chapter(1))
  await writeFile(join(root, 'chapters/0003.md'), 'invalid markdown')
  await writeFile(join(root, '.novelforge/locks/chapter-write.lock'), '{"pid":1}')
  await writeFile(join(root, 'history/ch_12345678/interrupted.tmp'), 'recoverable data')
  await writeFile(join(root, 'migration-manifest.json'), JSON.stringify({ format: 1, projectId: 'fixture', files: {
    'chapters/0004.md': '0'.repeat(64),
  } }))
  const before = await inventory(root)
  const { status, report } = doctor(root)
  expect(status).toBe(1)
  expect(report.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'duplicate-id', path: 'chapters/0002.md', relatedPath: 'chapters/0001.md' }),
    expect.objectContaining({ code: 'number-conflict', path: 'chapters/0002.md' }),
    expect.objectContaining({ code: 'name-mismatch', path: 'chapters/0002.md' }),
    expect.objectContaining({ code: 'invalid-chapter', path: 'chapters/0003.md' }),
    expect.objectContaining({ code: 'missing-body', path: 'chapters/0004.md' }),
    expect.objectContaining({ code: 'lock-present', path: '.novelforge/locks/chapter-write.lock' }),
    expect.objectContaining({ code: 'temporary-file', path: 'history/ch_12345678/interrupted.tmp' }),
  ]))
  expect(JSON.stringify(report)).not.toContain('private manuscript')
  expect(await inventory(root)).toEqual(before)
})

test('doctor detects dangling backup references while allowing optional scene content and drafts without blueprints', async () => {
  const root = await project()
  const db = new DatabaseSync(join(root, 'legacy.db'))
  try {
    db.exec(`
      CREATE TABLE contents (id INTEGER PRIMARY KEY, body TEXT);
      CREATE TABLE drafts (id INTEGER PRIMARY KEY, chapter_number INTEGER, branch_id INTEGER, content_id INTEGER);
      CREATE TABLE draft_branches (id INTEGER PRIMARY KEY, chapter_number INTEGER, base_snapshot_id INTEGER, head_draft_id INTEGER);
      CREATE TABLE draft_snapshots (id INTEGER PRIMARY KEY, chapter_number INTEGER, draft_id INTEGER, branch_id INTEGER, content_id INTEGER, kind TEXT);
      CREATE TABLE revisions (id INTEGER PRIMARY KEY, base_draft_id INTEGER, review_source_id INTEGER, merged_to_draft_id INTEGER, content_id INTEGER);
      CREATE TABLE reviews (id INTEGER PRIMARY KEY, base_draft_id INTEGER, content_id INTEGER);
      CREATE TABLE scene_cards (id INTEGER PRIMARY KEY, chapter_number INTEGER, content_id INTEGER);
      INSERT INTO contents VALUES (1, '');
      INSERT INTO drafts VALUES (1, 1, NULL, 1), (2, 2, 99, 98);
      INSERT INTO draft_branches VALUES (1, 1, 99, 1);
      INSERT INTO draft_snapshots VALUES (1, 1, 99, NULL, 1, 'manual');
      INSERT INTO revisions VALUES (1, 1, 99, 98, 1);
      INSERT INTO reviews VALUES (1, 99, 1);
      INSERT INTO scene_cards VALUES (1, 1, NULL), (2, 1, 99);
    `)
  } finally { db.close() }
  const before = await inventory(root)
  const { status, report } = doctor(root)
  expect(status).toBe(1)
  expect(report.legacyDatabase).toBe('checked')
  expect(report.issues.map(({ code, table, field, rowId }: Record<string, unknown>) => [code, table, field, rowId])).toEqual([
    ['missing-body', 'drafts', 'content_id', 2],
    ['missing-body', 'scene_cards', 'content_id', 2],
    ['orphan-reference', 'drafts', 'branch_id', 2],
    ['orphan-reference', 'draft_branches', 'head_draft_id', 1],
    ['orphan-reference', 'draft_branches', 'base_snapshot_id', 1],
    ['orphan-reference', 'draft_snapshots', 'draft_id', 1],
    ['orphan-reference', 'revisions', 'review_source_id', 1],
    ['orphan-reference', 'revisions', 'merged_to_draft_id', 1],
    ['orphan-reference', 'reviews', 'base_draft_id', 1],
  ])
  expect(await inventory(root)).toEqual(before)
})

test('doctor skips linked directories and refuses SQLite sidecars without opening the backup', async () => {
  const root = await project()
  const outside = await project()
  await writeFile(join(outside, 'broken.md'), 'unrelated file')
  await symlink(outside, join(root, 'history'), 'junction')
  await writeFile(join(root, 'legacy.db'), 'invalid database')
  await writeFile(join(root, 'legacy.db-wal'), 'active or interrupted backup')
  const { status, report } = doctor(root)
  expect(status).toBe(1)
  expect(report.legacyDatabase).toBe('skipped')
  expect(report.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'unsafe-path', path: 'history' }),
    expect.objectContaining({ code: 'database-sidecar', path: 'legacy.db-wal' }),
  ]))
  expect(report.issues).toHaveLength(2)
  expect(await readFile(join(outside, 'broken.md'), 'utf8')).toBe('unrelated file')
})

test('doctor reads a fresh CLI export with multiple versions and branches sharing one chapter identity', async () => {
  const root = await project()
  const source = join(root, 'offline.db')
  const destination = join(root, 'export')
  const db = new DatabaseSync(source)
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE blueprints (chapter_number INTEGER PRIMARY KEY, title TEXT);
      CREATE TABLE contents (id INTEGER PRIMARY KEY, body TEXT);
      CREATE TABLE drafts (id INTEGER PRIMARY KEY, chapter_number INTEGER, version INTEGER, branch_id INTEGER,
        status TEXT, content_id INTEGER, content_hash TEXT, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE draft_branches (id INTEGER PRIMARY KEY, chapter_number INTEGER, base_snapshot_id INTEGER, head_draft_id INTEGER);
      CREATE TABLE draft_snapshots (id INTEGER PRIMARY KEY, chapter_number INTEGER, draft_id INTEGER, branch_id INTEGER,
        content_id INTEGER, kind TEXT, content_hash TEXT);
      INSERT INTO contents VALUES (1, ''), (2, 'main draft'), (3, 'branch draft');
      INSERT INTO drafts VALUES (1, 1, 1, NULL, 'finalized', 1, '', 1, 2),
        (2, 1, 2, NULL, 'draft', 2, '', 1, 2), (3, 1, 1, 1, 'draft', 3, '', 1, 2);
      INSERT INTO draft_branches VALUES (1, 1, 1, 3);
      INSERT INTO draft_snapshots VALUES (1, 1, 1, 1, 1, 'branch-base',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    `)
  } finally { db.close() }
  execFileSync(process.execPath, ['scripts/migrate-to-files.mjs', source, destination, 'fixture'], { stdio: 'pipe' })
  const before = await inventory(destination)
  expect(doctor(destination)).toEqual({
    status: 0, report: { projectId: 'fixture', ok: true, legacyDatabase: 'checked', issues: [] },
  })
  expect(await inventory(destination)).toEqual(before)
})
