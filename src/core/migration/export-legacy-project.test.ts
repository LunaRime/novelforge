import { afterEach, expect, test } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { parseChapter } from '../adapters/chapter-format'
import { exportLegacyProject, type LegacyDraft } from './export-legacy-project'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nf-export-')); roots.push(root)
  const rows: LegacyDraft[] = [
    { id: 1, chapterNumber: 1, version: 1, branchId: null, status: 'archived', content: '旧稿', title: '标题', createdAt: 1, updatedAt: 1, contentHash: '' },
    { id: 2, chapterNumber: 1, version: 2, branchId: null, status: 'draft', content: '新稿\n', title: '标题', createdAt: 2, updatedAt: 2, contentHash: '' },
    { id: 3, chapterNumber: 1, version: 3, branchId: 4, status: 'draft', content: '分支', title: '标题', createdAt: 3, updatedAt: 3, contentHash: '' },
  ]
  const source = { listDrafts: async () => rows, backup: async (p: string) => { await writeFile(p, 'complete database backup') } }
  return { root, rows, source, destination: join(root, 'export'), projectId: 'project-1' }
}
test('exports every version and branch, verifies idempotently, refuses changed outputs', async () => {
  const f = await fixture()
  const report = await exportLegacyProject(f)
  expect(report.drafts).toBe(3); expect(report.chapters).toBe(1)
  expect(await readFile(join(f.destination, 'chapters/0001.md'), 'utf8')).toContain('新稿\n')
  expect(parseChapter(await readFile(join(f.destination, 'chapters/0001.md'), 'utf8')).content).toBe('新稿\n')
  expect((await exportLegacyProject(f)).alreadyExported).toBe(true)
  await writeFile(join(f.destination, 'chapters/0001.md'), 'external edit')
  await expect(exportLegacyProject(f)).rejects.toThrow('modified')
})
test('rejects source hash corruption and never publishes partial destination', async () => {
  const f = await fixture(); f.rows[0].contentHash = 'bad'
  await expect(exportLegacyProject(f)).rejects.toThrow('hash')
  await expect(readFile(join(f.destination, 'novel.json'))).rejects.toThrow()
})
test('refuses existing user directory without deleting contents', async () => {
  const f = await fixture(); await mkdir(f.destination); await writeFile(join(f.destination, 'keep'), 'keep')
  await expect(exportLegacyProject(f)).rejects.toThrow()
  expect(await readFile(join(f.destination, 'keep'), 'utf8')).toBe('keep')
})
test('rejects source changes on repeat export', async () => {
  const f = await fixture(); await exportLegacyProject(f); f.rows[0].content = 'changed'
  await expect(exportLegacyProject(f)).rejects.toThrow('source changed')
})
test('backup failure leaves source and destination untouched', async () => {
  const f = await fixture()
  f.source.backup = async () => { throw new Error('disk full') }
  await expect(exportLegacyProject(f)).rejects.toThrow('disk full')
  await expect(readFile(join(f.destination, 'novel.json'))).rejects.toThrow()
  expect(f.rows).toHaveLength(3)
})
test('refuses unknown files in an existing export', async () => {
  const f = await fixture(); await exportLegacyProject(f)
  await writeFile(join(f.destination, 'unexpected'), 'keep')
  await expect(exportLegacyProject(f)).rejects.toThrow('modified')
  expect(await readFile(join(f.destination, 'unexpected'), 'utf8')).toBe('keep')
})
test('CLI exports a real SQLite snapshot with branches, linked tables and orphan drafts intact', async () => {
  const f = await fixture()
  const sourcePath = join(f.root, 'source.db')
  const db = new DatabaseSync(sourcePath)
  db.exec(`CREATE TABLE contents(id INTEGER PRIMARY KEY, body TEXT);
    CREATE TABLE blueprints(chapter_number INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE drafts(id INTEGER PRIMARY KEY, chapter_number INTEGER, version INTEGER, branch_id INTEGER,
      status TEXT, content_id INTEGER, content_hash TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE reviews(id INTEGER PRIMARY KEY, content_id INTEGER NOT NULL);
    INSERT INTO contents VALUES(1, 'orphan chapter');
    INSERT INTO drafts VALUES(1, 2, 1, NULL, 'draft', 1, '', 1, 1);
    INSERT INTO contents VALUES(2, 'review survives backup');
    INSERT INTO reviews VALUES(1, 2);`)
  db.close()
  const command = () => execFileSync(process.execPath, ['scripts/migrate-to-files.mjs', sourcePath, f.destination, f.projectId], { encoding: 'utf8' })
  expect(command()).toContain('"drafts": 1')
  expect(command()).toContain('"alreadyExported": true')
  const backupDb = new DatabaseSync(join(f.destination, 'legacy.db'), { readOnly: true })
  try { expect(backupDb.prepare('SELECT c.body FROM reviews r JOIN contents c ON c.id = r.content_id').get()?.body).toBe('review survives backup') }
  finally { backupDb.close() }
  const changed = new DatabaseSync(sourcePath)
  changed.exec("UPDATE contents SET body = 'changed review' WHERE id = 2")
  changed.close()
  expect(command).toThrow()
})
test.each([
  ['draft_snapshots', "CREATE TABLE draft_snapshots(id INTEGER PRIMARY KEY, content_id INTEGER, content_hash TEXT); INSERT INTO draft_snapshots VALUES(1, 1, 'bad-hash');", 'hash'],
  ['revisions', 'CREATE TABLE revisions(id INTEGER PRIMARY KEY, content_id INTEGER); INSERT INTO revisions VALUES(1, 999);', 'missing'],
  ['reviews', 'CREATE TABLE reviews(id INTEGER PRIMARY KEY, content_id INTEGER); INSERT INTO reviews VALUES(1, 999);', 'missing'],
  ['scene_cards', 'CREATE TABLE scene_cards(id INTEGER PRIMARY KEY, content_id INTEGER); INSERT INTO scene_cards VALUES(1, 999);', 'missing'],
])('CLI rejects corrupt associated content in %s without publishing', async (_table, sql, reason) => {
  const f = await fixture(); const sourcePath = join(f.root, 'source.db')
  const db = new DatabaseSync(sourcePath)
  db.exec(`CREATE TABLE contents(id INTEGER PRIMARY KEY, body TEXT);
    CREATE TABLE blueprints(chapter_number INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE drafts(id INTEGER PRIMARY KEY, chapter_number INTEGER, version INTEGER, branch_id INTEGER,
      status TEXT, content_id INTEGER, content_hash TEXT, created_at INTEGER, updated_at INTEGER);
    INSERT INTO contents VALUES(1, 'valid draft');
    INSERT INTO drafts VALUES(1, 1, 1, NULL, 'draft', 1, '', 1, 1); ${sql}`)
  db.close()
  expect(() => execFileSync(process.execPath, ['scripts/migrate-to-files.mjs', sourcePath, f.destination, f.projectId], { encoding: 'utf8', stdio: 'pipe' })).toThrow(reason)
  await expect(readFile(join(f.destination, 'novel.json'))).rejects.toThrow()
})
