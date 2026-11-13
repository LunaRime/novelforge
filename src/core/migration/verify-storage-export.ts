import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { parseChapter } from '../adapters/chapter-format'
import { inspectLegacyDatabase } from '../adapters/legacy-database-inspection'
import { legacyDraftDate, listExportFiles, type LegacyDraft } from './export-legacy-project'
import type { MigratedDraftIdentityMap } from '../ports/migrated-draft-identity'

const manifestName = 'migration-manifest.json'
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

function parseJson(text: string, name: string) {
  try { return JSON.parse(text) }
  catch { throw new Error(`Invalid JSON: ${name}`) }
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function assertNoSidecars(path: string) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { await lstat(path + suffix) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    throw new Error(`SQLite sidecar present: ${suffix}`)
  }
}

async function openOffline(path: string): Promise<DatabaseSync> {
  await assertNoSidecars(path)
  const uri = pathToFileURL(path)
  uri.searchParams.set('immutable', '1')
  return new DatabaseSync(uri.href, { readOnly: true })
}

function checkDatabase(db: DatabaseSync, label: string) {
  const integrity = db.prepare('PRAGMA integrity_check').all()
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error(`${label}: SQLite integrity check failed`)
  if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error(`${label}: foreign key violation`)
}

function databaseInventory(db: DatabaseSync) {
  const schema = db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name').all()
  const schemaVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version)
  const tables = new Map<string, { count: number; hash: string }>()
  for (const entry of schema) {
    if (entry.type !== 'table') continue
    const name = String(entry.name)
    const table = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
    table.setReadBigInts(true)
    const rows: string[] = []
    for (const row of table.iterate()) {
      const values = Object.entries(row).map(([column, value]) => {
        if (typeof value === 'bigint') return [column, 'integer', value.toString()]
        if (typeof value === 'number') return [column, 'real', Object.is(value, -0) ? '-0' : value.toString()]
        if (value instanceof Uint8Array) return [column, 'blob', Buffer.from(value).toString('base64')]
        return [column, typeof value, value]
      })
      rows.push(digest(JSON.stringify(values)))
    }
    tables.set(name, { count: rows.length, hash: digest(rows.sort().join('')) })
  }
  return { schemaVersion, schemaHash: digest(JSON.stringify(schema)), tables }
}

function draftRows(db: DatabaseSync): LegacyDraft[] {
  return db.prepare(`
    SELECT d.id, d.chapter_number AS chapterNumber, d.version, d.branch_id AS branchId,
      d.status, c.body AS content, COALESCE(b.title, '') AS title, COALESCE(d.content_hash, '') AS contentHash,
      d.created_at AS createdAt, d.updated_at AS updatedAt
    FROM drafts d LEFT JOIN contents c ON c.id = d.content_id
    LEFT JOIN blueprints b ON b.chapter_number = d.chapter_number ORDER BY d.id
  `).all() as unknown as LegacyDraft[]
}

function expectedPaths(db: DatabaseSync, rows: LegacyDraft[], projectId: string) {
  const current = new Map<number, number>()
  const currentRows = db.prepare(`
    SELECT id, chapter_number, version,
      MAX(version) OVER (PARTITION BY chapter_number) AS latest
    FROM drafts WHERE branch_id IS NULL AND status <> 'archived'
  `).all()
  for (const row of currentRows) {
    if (row.version !== row.latest) continue
    const number = Number(row.chapter_number)
    if (current.has(number)) throw new Error(`ambiguous main draft: chapter ${number}`)
    current.set(number, Number(row.id))
  }
  // Rows are ordered by legacy ID. A chapter without a current file keeps its first exported ID as the anchor.
  const firstDraftByChapter = new Map<number, number>()
  for (const row of rows) {
    if (!firstDraftByChapter.has(row.chapterNumber)) firstDraftByChapter.set(row.chapterNumber, row.id)
  }
  const idFor = (draftId: number) => `ch_${digest(JSON.stringify([projectId, draftId])).slice(0, 32)}`
  return rows.map(row => {
    const selected = current.get(row.chapterNumber)
    const chapterId = idFor(selected ?? row.id)
    const isCurrent = row.id === selected
    const path = isCurrent ? `chapters/${String(row.chapterNumber).padStart(4, '0')}.md` :
      `history/${chapterId}/${row.id}.md`
    const identity = {
      draftId: row.id, chapterId: idFor(selected ?? firstDraftByChapter.get(row.chapterNumber) ?? row.id),
      version: row.version, branchId: row.branchId,
      target: isCurrent ? { kind: 'current' as const, locator: `doc://chapter/${chapterId}` } :
        { kind: 'history' as const, path, fileChapterId: chapterId },
    }
    return { row, chapterId, path, identity }
  })
}

export async function verifyStorageExport(sourceArg: string, outputArg: string) {
  const [source, output] = await Promise.all([realpath(sourceArg), realpath(outputArg)])
  const sourceWithinOutput = relative(output, source)
  if (!sourceWithinOutput || (!isAbsolute(sourceWithinOutput) && !sourceWithinOutput.startsWith(`..${sep}`))) {
    throw new Error('Source must be outside the export directory')
  }
  if (!(await lstat(source)).isFile() || !(await lstat(outputArg)).isDirectory()) throw new Error('Expected an offline database and export directory')
  const listed = await listExportFiles(output)
  if (!listed.includes(manifestName) || !listed.includes('legacy.db') || !listed.includes('novel.json')) {
    throw new Error('Missing export manifest, project identity or backup')
  }
  const sourceFingerprint = await fileHash(source)
  const manifestText = await readFile(join(output, manifestName), 'utf8')
  const manifest = parseJson(manifestText, manifestName)
  const projectId: unknown = manifest?.projectId
  if (manifest?.format !== 1 || typeof projectId !== 'string' || !projectId.trim() || manifest.sourceFingerprint !== sourceFingerprint) {
    throw new Error('Manifest format, project identity or source fingerprint mismatch')
  }
  const identity = parseJson(await readFile(join(output, 'novel.json'), 'utf8'), 'novel.json')
  if (identity?.id !== projectId || identity.schemaVersion !== 1) throw new Error('Export project identity mismatch')
  const backupPath = join(output, 'legacy.db')
  const sourceDb = await openOffline(source)
  try {
    const backupDb = await openOffline(backupPath)
    try {
      checkDatabase(sourceDb, 'source')
      checkDatabase(backupDb, 'backup')
      const from = databaseInventory(sourceDb)
      const to = databaseInventory(backupDb)
      if (from.schemaVersion !== to.schemaVersion || from.schemaHash !== to.schemaHash) throw new Error('Backup schema differs from source')
      for (const [name, expected] of from.tables) {
        const actual = to.tables.get(name)
        if (actual?.hash !== expected.hash || actual.count !== expected.count) throw new Error(`Backup table differs: ${name}`)
      }
      const issues = inspectLegacyDatabase(backupPath)
      if (issues.length) throw new Error(`Backup association check failed: ${JSON.stringify(issues[0])}`)

      const rows = draftRows(sourceDb)
      const rowText = JSON.stringify(rows)
      if (manifest.sourceHash !== digest(rowText) || JSON.stringify(manifest.drafts) !== rowText) throw new Error('Manifest drafts differ from source')
      const expected = expectedPaths(sourceDb, rows, projectId)
      const files = [...expected.map(entry => entry.path), 'legacy.db', 'novel.json'].sort()
      const current = expected.filter(entry => entry.path.startsWith('chapters/')).length
      if (manifest.chapters !== current || JSON.stringify(listed) !== JSON.stringify([...files, manifestName].sort()) ||
          !manifest.files || JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(files)) {
        throw new Error('Export file list or manifest chapter count mismatch')
      }
      const hashes = new Map<string, string>()
      for (const path of files) {
        const hash = await fileHash(join(output, path))
        if (manifest.files[path] !== hash) throw new Error(`Export file hash mismatch: ${path}`)
        hashes.set(path, hash)
      }
      const chapters = []
      for (const { row, chapterId, path } of expected) {
        const chapter = parseChapter(await readFile(join(output, path), 'utf8'))
        const bodyHash = digest(chapter.content)
        if (chapter.id !== chapterId || chapter.metadata?.legacyDraftId !== row.id || chapter.projectId !== projectId ||
            chapter.number !== row.chapterNumber || chapter.status !== row.status || chapter.title !== row.title ||
            chapter.createdAt !== legacyDraftDate(row.createdAt).toISOString() || chapter.updatedAt !== legacyDraftDate(row.updatedAt).toISOString() ||
            chapter.content !== row.content || (row.contentHash && bodyHash !== row.contentHash)) {
          throw new Error(`Export chapter differs from source: ${path}`)
        }
        chapters.push({ draftId: row.id, chapterId, version: row.version, branchId: row.branchId, path, bodyHash, fileHash: hashes.get(path) })
      }
      if (await fileHash(source) !== sourceFingerprint || await fileHash(backupPath) !== hashes.get('legacy.db') ||
          await fileHash(join(output, manifestName)) !== digest(manifestText)) throw new Error('Source or export changed during verification')
      await assertNoSidecars(source)
      await assertNoSidecars(backupPath)
      const manifestHash = digest(manifestText)
      const identityMap: MigratedDraftIdentityMap = {
        format: 1, projectId, sourceFingerprint, manifestHash,
        entries: expected.map(({ identity, path }) => ({
          ...identity,
          target: identity.target.kind === 'current' ? identity.target : { ...identity.target, fileHash: hashes.get(path)! },
        })),
      }
      return {
        ok: true, source, output, backupPath, projectId, sourceFingerprint, manifestFormat: 1,
        manifestHash, backupHash: hashes.get('legacy.db'), schemaVersion: from.schemaVersion,
        counts: { ...Object.fromEntries([...from.tables].map(([name, info]) => [name, info.count])),
          current, historical: expected.length - current },
        databaseDigest: digest(JSON.stringify([from.schemaHash, from.schemaVersion, [...from.tables]])), chapters,
        identityMap,
      }
    } finally { backupDb.close() }
  } finally { sourceDb.close() }
}
