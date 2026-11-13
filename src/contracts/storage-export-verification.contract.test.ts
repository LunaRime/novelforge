import { fork, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { afterEach, expect, test, vi } from 'vitest'
import { FileChapterStore, MemoryChapterIndex, SQLiteChapterIndex, openEditorDocument } from '../core'
import { parseChapter } from '../core/adapters/chapter-format'
import { createFileEditorOpenPort } from '../core/adapters/file-editor-open'
import { exportLegacyProject, listExportFiles } from '../core/migration/export-legacy-project'

const roots: string[] = []
const projectId = 'e3-synthetic'
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nf-e3 #'))
  roots.push(root)
  const source = join(root, 'offline.db')
  const db = new DatabaseSync(source)
  try {
    db.exec(`
      PRAGMA user_version = 23;
      CREATE TABLE contents (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE blueprints (chapter_number INTEGER PRIMARY KEY, title TEXT);
      CREATE TABLE drafts (id INTEGER PRIMARY KEY, chapter_number INTEGER, version INTEGER, branch_id INTEGER,
        status TEXT, content_id INTEGER REFERENCES contents(id), content_hash TEXT, created_at, updated_at);
      CREATE TABLE draft_branches (id INTEGER PRIMARY KEY, chapter_number INTEGER, base_snapshot_id INTEGER, head_draft_id INTEGER);
      CREATE TABLE draft_snapshots (id INTEGER PRIMARY KEY, chapter_number INTEGER, draft_id INTEGER REFERENCES drafts(id),
        branch_id INTEGER, content_id INTEGER REFERENCES contents(id), content_hash TEXT, kind TEXT);
      CREATE TABLE revisions (id INTEGER PRIMARY KEY, base_draft_id INTEGER REFERENCES drafts(id), review_source_id INTEGER,
        merged_to_draft_id INTEGER, content_id INTEGER REFERENCES contents(id));
      CREATE TABLE reviews (id INTEGER PRIMARY KEY, base_draft_id INTEGER REFERENCES drafts(id), content_id INTEGER REFERENCES contents(id));
      CREATE TABLE scene_cards (id INTEGER PRIMARY KEY, chapter_number INTEGER, content_id INTEGER REFERENCES contents(id));
      CREATE TABLE workflow_checkpoints (id INTEGER PRIMARY KEY, state_json TEXT);
      INSERT INTO blueprints VALUES (1, '雨夜'), (3, '归档章');
      INSERT INTO contents VALUES (1, ''), (2, '合成当前稿'), (3, '分支稿'), (4, '归档稿'),
        (6, '审稿正文'), (7, '修稿正文'), (8, '场景正文'), (9, '');
      INSERT INTO drafts VALUES (1, 1, 1, NULL, 'finalized', 1, '', '2001-02-03 04:05:06', '1234567890000'),
        (2, 1, 2, NULL, 'draft', 2, '', 2, 3), (3, 1, 1, 1, 'draft', 3, '', 3, 4),
        (4, 3, 1, NULL, 'archived', 4, '', 4, 5), (5, 2, 1, NULL, 'draft', 9, '', 5, 6);
      INSERT INTO draft_branches VALUES (1, 1, 1, 3);
      INSERT INTO draft_snapshots VALUES (1, 1, 1, 1, 1, '${sha('')}', 'branch-base');
      INSERT INTO reviews VALUES (1, 1, 6);
      INSERT INTO revisions VALUES (1, 1, 1, 2, 7);
      INSERT INTO scene_cards VALUES (1, 1, 8), (2, 2, NULL);
      INSERT INTO workflow_checkpoints VALUES (1, '{"draftId":2}');
    `)
  } finally { db.close() }
  return { root, source, output: join(root, 'export'), other: join(root, 'other') }
}

function command(script: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [`scripts/${script}.mjs`, ...args], { encoding: 'utf8' })
  expect(result.error).toBeUndefined()
  return result
}

function success(result: ReturnType<typeof command>) {
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

function migrate(source: string, output: string) {
  return command('migrate-to-files', source, output, projectId)
}

const manifestName = 'migration-manifest.json'
const readManifest = async (output: string) => JSON.parse(await readFile(join(output, manifestName), 'utf8'))

test('independently verifies two pristine exports and keeps the source and output files intact', async () => {
  const { root, source, output, other } = await fixture()
  const fingerprint = sha(await readFile(source))
  expect(success(migrate(source, output))).toMatchObject({ chapters: 2, drafts: 5, alreadyExported: false })
  expect(success(migrate(source, other))).toMatchObject({ chapters: 2, drafts: 5, alreadyExported: false })
  const manifest = await readManifest(output)
  const paths = [manifestName, ...Object.keys(manifest.files)]
  const before = await Promise.all(paths.map(async path => (await stat(join(output, path))).mtimeMs))
  expect(success(migrate(source, output)).alreadyExported).toBe(true)
  const first = success(command('verify-storage-export', source, output))
  const second = success(command('verify-storage-export', source, other))
  expect(first).toMatchObject({ ok: true, projectId, manifestFormat: 1, sourceFingerprint: fingerprint, schemaVersion: 23,
    counts: { current: 2, historical: 3, drafts: 5, draft_branches: 1, draft_snapshots: 1, reviews: 1,
      revisions: 1, scene_cards: 2, workflow_checkpoints: 1 } })
  expect(first.chapters).toEqual(second.chapters)
  expect(first.databaseDigest).toBe(second.databaseDigest)
  expect(first.chapters).toEqual(expect.arrayContaining([
    expect.objectContaining({ draftId: 1, path: expect.stringMatching(/^history\//), bodyHash: sha('') }),
    expect.objectContaining({ draftId: 2, path: 'chapters/0001.md', bodyHash: sha('合成当前稿') }),
    expect.objectContaining({ draftId: 5, path: 'chapters/0002.md', bodyHash: sha('') }),
  ]))
  const historic = first.chapters.find((entry: { draftId: number }) => entry.draftId === 1)
  const chapter = parseChapter(await readFile(join(output, historic.path), 'utf8'))
  expect(chapter.createdAt).toBe('2001-02-03T04:05:06.000Z')
  expect(chapter.updatedAt).toBe('2009-02-13T23:31:30.000Z')
  expect(manifest.drafts[0]).toMatchObject({ createdAt: '2001-02-03 04:05:06', updatedAt: '1234567890000' })
  expect(JSON.stringify(first)).not.toContain('合成当前稿')
  expect(await Promise.all(paths.map(async path => (await stat(join(output, path))).mtimeMs))).toEqual(before)
  expect(await readdir(root)).toEqual(['export', 'offline.db', 'other'])
  expect(sha(await readFile(source))).toBe(fingerprint)
})

test('rejects modified manifest counts and a rehashed backup whose associations differ', async () => {
  const { source, output } = await fixture()
  success(migrate(source, output))
  const manifest = await readManifest(output)
  await writeFile(join(output, manifestName), JSON.stringify({ ...manifest, chapters: 9 }))
  expect(migrate(source, output).status).toBe(1)
  expect(command('verify-storage-export', source, output).stderr).toContain('chapter count')
  const alteredHashes = { ...manifest.files, 'chapters/0001.md': '0'.repeat(64) }
  await writeFile(join(output, manifestName), JSON.stringify({ ...manifest, files: alteredHashes }))
  expect(migrate(source, output).stderr).toContain('manifest modified')
  expect(command('verify-storage-export', source, output).stderr).toContain('file hash')
  const backupPath = join(output, 'legacy.db')
  const db = new DatabaseSync(backupPath)
  try { db.exec('UPDATE revisions SET merged_to_draft_id = 3') } finally { db.close() }
  manifest.files['legacy.db'] = sha(await readFile(backupPath))
  await writeFile(join(output, manifestName), JSON.stringify(manifest))
  const result = command('verify-storage-export', source, output)
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('revisions')
  expect(result.stdout).toBe('')
})

test('prepares a separate candidate with a frozen retained database and leaves the export pristine', async () => {
  const { source, output, other } = await fixture()
  success(migrate(source, output))
  const original = await readFile(join(output, 'legacy.db'))
  const prepared = success(command('prepare-file-project', source, output, other))
  expect(prepared).toMatchObject({ projectId, chapters: 2, drafts: 5 })
  expect(JSON.parse(await readFile(join(other, '.novelforge/file-editor.json'), 'utf8'))).toMatchObject({ lifecycle: 1, projectId })
  expect((await stat(join(other, '.novelforge/vela.db'))).isDirectory()).toBe(true)
  const db = new DatabaseSync(join(other, '.novelforge/retained.db'))
  try {
    expect(() => db.exec('DELETE FROM drafts')).toThrow('legacy chapter data is frozen')
    db.exec("UPDATE reviews SET content_id = 6 WHERE id = 1")
  } finally { db.close() }
  expect(await readFile(join(output, 'legacy.db'))).toEqual(original)
  expect(success(command('verify-storage-export', source, output)).ok).toBe(true)
  expect(command('prepare-file-project', source, output, other).status).toBe(1)
  expect(command('prepare-file-project', source, output, join(output, 'nested')).status).toBe(1)
  expect(success(command('verify-storage-export', source, output)).ok).toBe(true)
})

test('projects verified draft identities into exact current and historical targets', async () => {
  const { source, output, other } = await fixture()
  const db = new DatabaseSync(source)
  try {
    db.exec(`
      INSERT INTO contents VALUES (10, 'older archived chapter');
      INSERT INTO drafts VALUES (6, 3, 2, NULL, 'archived', 10, '', 6, 7);
    `)
  } finally { db.close() }
  success(migrate(source, output))
  const report = success(command('verify-storage-export', source, output))
  const map = success(command('verify-storage-export', source, output, '--identity-map'))
  expect(map).toEqual(report.identityMap)
  expect(map).toMatchObject({
    format: 1, projectId, sourceFingerprint: report.sourceFingerprint, manifestHash: report.manifestHash,
  })
  const entries = new Map<number, typeof map.entries[number]>(map.entries.map((entry: { draftId: number }) => [entry.draftId, entry]))
  const current = entries.get(2)!
  const archived = entries.get(4)!
  const otherArchived = entries.get(6)!
  expect(current.target).toEqual({ kind: 'current', locator: `doc://chapter/${current.chapterId}` })
  expect(entries.get(1)).toMatchObject({
    chapterId: current.chapterId, version: 1, branchId: null,
    target: { kind: 'history', path: `history/${current.chapterId}/1.md`, fileChapterId: current.chapterId },
  })
  expect(entries.get(3)).toMatchObject({ chapterId: current.chapterId, version: 1, branchId: 1, target: { kind: 'history' } })
  expect(archived.target).toMatchObject({ kind: 'history', fileChapterId: archived.chapterId })
  expect(otherArchived.chapterId).toBe(archived.chapterId)
  expect(otherArchived.target.fileChapterId).not.toBe(archived.chapterId)
  expect(otherArchived.target.path).toBe(`history/${otherArchived.target.fileChapterId}/6.md`)

  success(command('migrate-to-files', source, other, 'another-project'))
  const otherMap = success(command('verify-storage-export', source, other, '--identity-map'))
  expect(otherMap.projectId).toBe('another-project')
  expect(otherMap.entries.find((entry: { draftId: number }) => entry.draftId === 2).chapterId).not.toBe(current.chapterId)
  const manifest = await readManifest(output)
  await writeFile(join(output, manifestName), JSON.stringify({ ...manifest, projectId: 'another-project' }))
  const invalid = command('verify-storage-export', source, output, '--identity-map')
  expect(invalid.status).toBe(1)
  expect(invalid.stdout).toBe('')
})

test('opens verified file tabs through the editor use case and keeps exact old draft references', async () => {
  const { root, source, output } = await fixture()
  success(migrate(source, output))
  const identity = success(command('verify-storage-export', source, output, '--identity-map'))
  const working = join(root, 'working')
  await cp(output, working, { recursive: true })
  const openRepo = () => FileChapterStore.open({ projectPath: working, projectId, index: new MemoryChapterIndex() })
  let repo = await openRepo()
  let session = 1
  let activeProject = projectId
  const publish = vi.fn()
  const port = await createFileEditorOpenPort({
    projectPath: working, identity,
    scope: () => ({ projectId: activeProject, projectPath: working, session }),
    repo: { byId: id => repo.byId(id) }, publish,
  })
  const current = identity.entries.find((entry: { draftId: number }) => entry.draftId === 2)
  const request = { kind: 'path' as const, documentKind: 'chapter' as const, locator: current.target.locator, name: 'chapter' }
  const first = await openEditorDocument(request, port)
  expect(first).toMatchObject({ status: 'opened', document: { content: '合成当前稿', readOnly: false } })
  const historical = await openEditorDocument({ kind: 'draft', draftId: 1, name: 'old' }, port)
  expect(historical).toMatchObject({ status: 'opened', document: { content: '', readOnly: true } })
  if (first.status !== 'opened' || historical.status !== 'opened') throw new Error('Expected two documents')
  expect(first.document.id).not.toBe(historical.document.id)
  const stored = (await repo.byId(current.chapterId))!
  await repo.save({ ...stored.chapter, number: 4 }, { expectedRevision: stored.revision })
  repo = await openRepo()
  expect(await openEditorDocument(request, port)).toMatchObject({
    status: 'opened', document: { id: first.document.id, locator: first.document.locator, content: first.document.content },
  })
  const reopened = (await repo.byId(current.chapterId))!
  await repo.save({ ...reopened.chapter, content: 'replacement', metadata: {} }, { expectedRevision: reopened.revision })
  expect(await openEditorDocument({ kind: 'draft', draftId: 2, name: 'old' }, port)).toEqual({ status: 'missing' })
  expect(await openEditorDocument(request, port)).toMatchObject({ status: 'opened', document: { content: 'replacement' } })
  const historyPath = join(working, 'history', current.chapterId, '1.md')
  await writeFile(historyPath, Buffer.concat([await readFile(historyPath), Buffer.from('tampered')]))
  expect(await openEditorDocument({ kind: 'draft', draftId: 1, name: 'old' }, port)).toEqual({ status: 'missing' })
  session++
  expect(await openEditorDocument(request, port)).toEqual({ status: 'missing' })
  activeProject = 'another-project'
  expect(await openEditorDocument(request, port)).toEqual({ status: 'missing' })
  expect(publish).toHaveBeenCalledTimes(4)
})

test('refuses source changes, missing contents, WAL and external edits', async () => {
  const { root, source, output, other } = await fixture()
  success(migrate(source, output))
  const chapterPath = join(output, 'chapters/0001.md')
  const pristine = await readFile(chapterPath)
  await writeFile(chapterPath, 'external edit')
  expect(migrate(source, output).stderr).toContain('export modified')
  expect(command('verify-storage-export', source, output).stderr).toContain('file hash mismatch')
  expect(await readFile(chapterPath, 'utf8')).toBe('external edit')
  await writeFile(chapterPath, pristine)

  const db = new DatabaseSync(source, { enableForeignKeyConstraints: false })
  try {
    db.exec("PRAGMA journal_mode = WAL; UPDATE workflow_checkpoints SET state_json = '{}'")
    expect(migrate(source, other).stderr).toContain('sidecar (-wal)')
  } finally { db.close() }
  expect(migrate(source, output).stderr).toContain('source changed')
  expect(command('verify-storage-export', source, output).stderr).toContain('source fingerprint')
  const corrupt = new DatabaseSync(source, { enableForeignKeyConstraints: false })
  try { corrupt.exec('DELETE FROM contents WHERE id = 2') } finally { corrupt.close() }
  const failed = migrate(source, other)
  expect(failed.status).toBe(1)
  expect(failed.stdout).toBe('')
  expect(failed.stderr).toContain('invalid draft 2')
  expect(await readdir(root)).toEqual(['export', 'offline.db'])
})

test('detects a changed source during export and leaves no published destination or staging files', async () => {
  const { root, output } = await fixture()
  let fingerprint = 'initial'
  await expect(exportLegacyProject({ projectId, destination: output, source: {
    listDrafts: async () => [{ id: 1, chapterNumber: 1, version: 1, branchId: null,
      status: 'draft', content: '正文', title: '', contentHash: '', createdAt: 1, updatedAt: 2 }],
    backup: async path => { await writeFile(path, 'staged backup'); fingerprint = 'changed' },
    fingerprint: async () => fingerprint,
  } })).rejects.toThrow('source changed during export')
  expect(await readdir(root)).toEqual(['offline.db'])
})

test('rebuilds a deleted SQLite index on an isolated copy with all current and historical bytes intact', async () => {
  const { root, source, output, other } = await fixture()
  success(migrate(source, output))
  await cp(output, other, { recursive: true })
  const paths = await listExportFiles(other)
  const hashes = () => Promise.all(paths.map(async path => sha(await readFile(join(other, path)))))
  const before = await hashes()
  const indexPath = join(root, 'derived-index.db')
  async function scan() {
    const db = new DatabaseSync(indexPath)
    try {
      const repo = await FileChapterStore.open({ projectPath: other, projectId, index: new SQLiteChapterIndex(db) })
      return await Promise.all((await repo.list()).map(meta => repo.byId(meta.id)))
    } finally { db.close() }
  }
  const first = await scan()
  expect(first.map(stored => stored?.chapter.content)).toEqual(['合成当前稿', ''])
  await rm(indexPath)
  expect(await scan()).toEqual(first)
  expect(await hashes()).toEqual(before)
  expect(success(command('doctor', other)).ok).toBe(true)
  expect(success(command('verify-storage-export', source, output)).ok).toBe(true)
})

test('an interrupted real writer leaves a diagnosable lock and duplicate without losing the original bytes', async () => {
  const { root, source, output } = await fixture()
  success(migrate(source, output))
  const original = join(output, 'chapters/0001.md')
  const before = await readFile(original)
  const chapter = parseChapter(before.toString('utf8'))
  const script = join(root, 'interrupt-writer.mjs')
  const { outputFiles: [module] } = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import fs from 'node:fs/promises'
      import { syncBuiltinESMExports } from 'node:module'
      import { FileChapterStore } from './src/core/adapters/file-chapter-store'
      import { MemoryChapterIndex } from './src/core/adapters/memory-chapter-index'
      const repo = await FileChapterStore.open({ projectPath: process.argv[2], projectId: process.argv[3], index: new MemoryChapterIndex() })
      const [first] = await repo.list()
      const stored = await repo.byId(first.id)
      const originalLink = fs.link
      fs.link = async (from, to) => {
        await originalLink(from, to)
        if (!to.endsWith('0004.md')) return
        process.send('linked-before-unlink')
        await new Promise(() => {})
      }
      syncBuiltinESMExports()
      process.on('message', () => {})
      await repo.save({ ...stored.chapter, number: 4 }, { expectedRevision: stored.revision })
    ` },
    bundle: true, platform: 'node', format: 'esm', write: false,
  })
  await writeFile(script, module.contents)
  const child = fork(script, [output, projectId], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  const exited = once(child, 'exit')
  try {
    const [result] = await Promise.race([
      once(child, 'message', { signal: AbortSignal.timeout(5000) }),
      exited.then(([code]) => [`child exited: ${code}`]),
    ])
    expect(result).toBe('linked-before-unlink')
  } finally {
    child.kill()
    await exited
  }
  const duplicate = join(output, 'chapters/0004.md')
  const lock = join(output, '.novelforge/locks/chapter-write.lock')
  const [oldBytes, newBytes, lockBytes] = await Promise.all([readFile(original), readFile(duplicate), readFile(lock)])
  expect(newBytes).toEqual(oldBytes)
  expect(parseChapter(newBytes.toString('utf8')).content).toBe(chapter.content)
  const history = join(output, 'history', chapter.id)
  const recoverySnapshots = (await readdir(history)).filter(name => /^[0-9]+-[a-f0-9-]+\.md$/.test(name))
  expect(recoverySnapshots).toHaveLength(1)
  expect(await readFile(join(history, recoverySnapshots[0]))).toEqual(before)
  const report = command('doctor', output)
  expect(report.status).toBe(1)
  expect(JSON.parse(report.stdout).issues.map(({ code }: { code: string }) => code)).toEqual(
    expect.arrayContaining(['duplicate-id', 'number-conflict', 'name-mismatch', 'lock-present']))
  expect(await readFile(lock)).toEqual(lockBytes)
  expect(await readFile(original)).toEqual(oldBytes)
  expect(await readFile(duplicate)).toEqual(newBytes)
  await expect(FileChapterStore.open({ projectPath: output, projectId, index: new MemoryChapterIndex() })).rejects.toMatchObject({
    code: 'duplicate-id',
  })
})
