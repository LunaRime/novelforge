import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export interface LegacyDraft {
  id: number
  chapterNumber: number
  version: number
  branchId: number | null
  status: string
  title: string
  content: string
  contentHash: string
  createdAt: number | string
  updatedAt: number | string
}
export interface LegacySource {
  /** Rows and backup must describe the same offline database snapshot. */
  listDrafts(): Promise<LegacyDraft[]>
  backup(destination: string): Promise<void>
  fingerprint?(): Promise<string>
}
interface Options { source: LegacySource; destination: string; projectId: string }
interface Manifest {
  format: 1
  projectId: string
  sourceHash: string
  sourceFingerprint?: string
  drafts: LegacyDraft[]
  files: Record<string, string>
  chapters: number
}
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const idFor = (project: string, id: number) => `ch_${hash(JSON.stringify([project, id])).slice(0, 32)}`
const fileHash = async (p: string) => hash(await readFile(p))

/** Legacy SQLite TEXT columns can contain both UTC datetime text and millisecond strings. */
export function legacyDraftDate(value: unknown): Date {
  if (typeof value === 'number') return new Date(value)
  if (typeof value !== 'string') return new Date(NaN)
  const text = value.trim()
  if (/^-?\d+$/.test(text)) return new Date(Number(text))
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(text)) {
    return new Date(text.replace(' ', 'T') + 'Z')
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return new Date(text)
  return new Date(NaN)
}

async function exists(p: string) {
  try { await lstat(p); return true } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw e
  }
}
function serialize(projectId: string, id: string, row: LegacyDraft) {
  const metadata = { projectId, id, number: row.chapterNumber, title: row.title,
    status: row.status, createdAt: legacyDraftDate(row.createdAt).toISOString(),
    updatedAt: legacyDraftDate(row.updatedAt).toISOString(), legacyDraftId: row.id }
  return `---\n${Object.entries(metadata).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n${row.content}`
}
function validate(rows: LegacyDraft[]) {
  const ids = new Set<number>()
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id)) throw new Error('invalid or duplicate draft id')
    ids.add(row.id)
    if (!Number.isSafeInteger(row.chapterNumber) || row.chapterNumber < 1 ||
        !Number.isSafeInteger(row.version) || row.version < 1 || typeof row.content !== 'string' ||
        typeof row.title !== 'string' || typeof row.status !== 'string' ||
        !Number.isFinite(legacyDraftDate(row.createdAt).getTime()) || !Number.isFinite(legacyDraftDate(row.updatedAt).getTime()) ||
        !['draft', 'revised', 'reviewed', 'finalized', 'archived'].includes(row.status) ||
        (row.branchId !== null && (!Number.isSafeInteger(row.branchId) || row.branchId < 1))) throw new Error(`invalid draft ${row.id}`)
    if (row.contentHash && row.contentHash !== hash(row.content)) throw new Error(`content hash mismatch: draft ${row.id}`)
  }
}
/** Offline verification export only. Never changes the source or switches application storage. */
export async function exportLegacyProject({ source, destination, projectId }: Options) {
  if (!projectId.trim()) throw new Error('projectId is required')
  const sourceFingerprint = await source.fingerprint?.()
  const rows = [...await source.listDrafts()].sort((a, b) => a.id - b.id)
  validate(rows)
  const sourceHash = hash(JSON.stringify(rows))
  const target = resolve(destination)
  if (await exists(target)) {
    if ((await lstat(target)).isSymbolicLink()) throw new Error('destination must not be a symlink')
    const actualNames = await listExportFiles(target)
    if (!actualNames.includes('migration-manifest.json')) throw new Error('export manifest missing')
    const manifest = JSON.parse(await readFile(join(target, 'migration-manifest.json'), 'utf8')) as Manifest
    if (manifest.format !== 1 || manifest.projectId !== projectId || manifest.sourceHash !== sourceHash ||
        manifest.sourceFingerprint !== sourceFingerprint) throw new Error('source changed or destination belongs to another export')
    // Derive the file list from source rows rather than trusting editable manifest paths.
    const expected = buildFiles(projectId, rows)
    const chapters = [...expected.keys()].filter(k => k.startsWith('chapters/')).length
    expected.set('novel.json', JSON.stringify({ id: projectId, schemaVersion: 1 }, null, 2))
    const names = [...expected.keys(), 'legacy.db', 'migration-manifest.json'].sort()
    const manifestNames = [...Object.keys(manifest.files ?? {}), 'migration-manifest.json'].sort()
    if (manifest.chapters !== chapters || JSON.stringify(manifestNames) !== JSON.stringify(names) ||
        JSON.stringify(manifest.drafts) !== JSON.stringify(rows)) throw new Error('manifest modified')
    if (JSON.stringify(actualNames) !== JSON.stringify(names)) throw new Error('export modified: unexpected or missing files')
    for (const [name, content] of expected) {
      const p = join(target, name)
      const expectedHash = hash(content)
      if (manifest.files[name] !== expectedHash) throw new Error(`manifest modified: ${name}`)
      if (!(await lstat(p)).isFile() || await fileHash(p) !== expectedHash) throw new Error(`export modified: ${name}`)
    }
    if (await fileHash(join(target, 'legacy.db')) !== manifest.files['legacy.db']) throw new Error('backup modified')
    return { chapters, drafts: rows.length, alreadyExported: true }
  }
  await mkdir(dirname(target), { recursive: true })
  const staging = await mkdtemp(join(dirname(target), '.nf-export-'))
  try {
    const contents = buildFiles(projectId, rows)
    contents.set('novel.json', JSON.stringify({ id: projectId, schemaVersion: 1 }, null, 2))
    const files: Record<string, string> = {}
    for (const [name, body] of contents) {
      const p = join(staging, name)
      await mkdir(dirname(p), { recursive: true }); await writeFile(p, body, { encoding: 'utf8', flag: 'wx' })
      files[name] = hash(body)
      if (await fileHash(p) !== files[name]) throw new Error(`export verification failed: ${name}`)
    }
    await source.backup(join(staging, 'legacy.db'))
    files['legacy.db'] = await fileHash(join(staging, 'legacy.db'))
    // Re-read source to detect changes during extraction/backup; callers must export an offline snapshot.
    const after = [...await source.listDrafts()].sort((a, b) => a.id - b.id)
    if (hash(JSON.stringify(after)) !== sourceHash || await source.fingerprint?.() !== sourceFingerprint) throw new Error('source changed during export')
    const chapters = [...contents.keys()].filter(k => k.startsWith('chapters/')).length
    const manifest: Manifest = { format: 1, projectId, sourceHash, sourceFingerprint, drafts: rows, files, chapters }
    await writeFile(join(staging, 'migration-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
    // The destination must remain absent. Never merge into a user's existing project.
    if (await exists(target)) throw new Error('destination appeared during export')
    await rename(staging, target)
    return { chapters, drafts: rows.length, alreadyExported: false }
  } finally {
    // staging is created by mkdtemp in this function, never supplied by the caller.
    await rm(staging, { recursive: true, force: true })
  }
}
function buildFiles(projectId: string, rows: LegacyDraft[]) {
  const current = new Map<number, LegacyDraft>()
  for (const row of rows) {
    if (row.branchId !== null || row.status === 'archived') continue
    const previous = current.get(row.chapterNumber)
    if (!previous || row.version > previous.version) current.set(row.chapterNumber, row)
    else if (row.version === previous.version) throw new Error(`ambiguous main draft: chapter ${row.chapterNumber}`)
  }
  const files = new Map<string, string>()
  for (const row of rows) {
    const selected = current.get(row.chapterNumber)
    const id = idFor(projectId, selected?.id ?? row.id)
    const name = selected?.id === row.id ? `chapters/${String(row.chapterNumber).padStart(4, '0')}.md` : `history/${id}/${row.id}.md`
    files.set(name, serialize(projectId, id, row))
  }
  return files
}

/** List files without following directory links, useful for external validation tooling. */
export async function listExportFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('export contains symlink')
    if (entry.isDirectory()) result.push(...(await listExportFiles(join(directory, entry.name))).map(p => `${entry.name}/${p}`))
    else if (entry.isFile()) result.push(entry.name)
    else throw new Error('export contains a non-regular file')
  }
  return result.sort()
}
