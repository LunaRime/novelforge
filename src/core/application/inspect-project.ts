import { parseChapter } from '../adapters/chapter-format'
import type { ProjectInspectionReader, ProjectInspectionReport, ProjectIssue } from '../ports/project-inspection'

const migrationBody = /^(?:chapters\/[0-9]{4,}\.md|history\/ch_[a-f0-9]{8,64}\/[1-9][0-9]*\.md)$/
const legacyBody = /^history\/[^/]+\/[1-9][0-9]*\.md$/
const lockPath = '.novelforge/locks/chapter-write.lock'
const manifestPath = 'migration-manifest.json'
const databasePath = 'legacy.db'

export async function inspectProject(reader: ProjectInspectionReader): Promise<ProjectInspectionReport> {
  const issues: ProjectIssue[] = []
  const add = (code: ProjectIssue['code'], path: string, relatedPath?: string) =>
    issues.push({ code, path, ...(relatedPath ? { relatedPath } : {}) })

  async function kind(path: string) {
    try { return await reader.kind(path) }
    catch { add('unreadable-path', path); return 'unknown' }
  }

  async function list(path: string) {
    const type = await kind(path)
    if (type === 'missing' || type === 'unknown') return []
    if (type !== 'directory') { add('unsafe-path', path); return [] }
    try { return (await reader.list(path)).sort().map(name => `${path}/${name}`) }
    catch { add('unreadable-path', path); return [] }
  }

  async function read(path: string, missing?: ProjectIssue['code']) {
    const type = await kind(path)
    if (type === 'missing') { if (missing) add(missing, path); return }
    if (type === 'unknown') return
    if (type !== 'file') { add('unsafe-path', path); return }
    try { return await reader.readText(path) }
    catch { add('unreadable-path', path) }
  }

  async function json(path: string, invalid: ProjectIssue['code'], required = false) {
    const text = await read(path, required ? invalid : undefined)
    if (text === undefined) return
    try {
      const data: unknown = JSON.parse(text)
      if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>
    } catch { /* Invalid JSON is reported without file content. */ }
    add(invalid, path)
  }

  const project = await json('novel.json', 'invalid-project', true)
  const projectId = typeof project?.id === 'string' && project.id.trim() && project.schemaVersion === 1 ? project.id : null
  if (project && projectId === null) add('invalid-project', 'novel.json')
  const currentIds = new Map<string, string>()
  const currentNumbers = new Map<number, string>()
  const legacyIds = new Map<number, string>()
  const observed = new Set<string>()

  function track<K>(map: Map<K, string>, key: K, path: string, code: 'duplicate-id' | 'number-conflict') {
    const first = map.get(key)
    if (first) add(code, path, first)
    else map.set(key, path)
  }

  async function inspectBody(path: string, current: boolean) {
    observed.add(path)
    const text = await read(path, 'missing-body')
    if (text === undefined) return
    let chapter
    try { chapter = parseChapter(text) }
    catch { add('invalid-chapter', path); return }
    if (projectId !== null && chapter.projectId !== projectId) add('project-mismatch', path)
    if (current) {
      const canonical = `chapters/${String(chapter.number).padStart(4, '0')}.md`
      if (path !== canonical) add('name-mismatch', path, canonical)
      track(currentIds, chapter.id, path, 'duplicate-id')
      track(currentNumbers, chapter.number, path, 'number-conflict')
    } else if (path.split('/')[1] !== chapter.id) {
      add('name-mismatch', path)
    }
    const legacyId = chapter.metadata?.legacyDraftId
    const isLegacyHistory = !current && legacyBody.test(path)
    if (isLegacyHistory && path.split('/').at(-1) !== `${legacyId}.md`) add('name-mismatch', path)
    if ((current || isLegacyHistory) && typeof legacyId === 'number' && Number.isSafeInteger(legacyId) && legacyId > 0) {
      track(legacyIds, legacyId, path, 'duplicate-id')
    }
  }

  async function inspectEntries(paths: string[], current: boolean) {
    for (const path of paths) {
      if (path.endsWith('.tmp')) add('temporary-file', path)
      else if (/\.md$/i.test(path)) await inspectBody(path, current)
    }
  }

  await inspectEntries(await list('chapters'), true)
  for (const path of await list('history')) {
    if (path.endsWith('.tmp')) add('temporary-file', path)
    else await inspectEntries(await list(path), false)
  }
  for (const path of await list('.novelforge')) {
    if (path.endsWith('.tmp')) add('temporary-file', path)
    else if (path === '.novelforge/locks') {
      for (const lock of await list(path)) {
        if (lock.endsWith('.tmp')) add('temporary-file', lock)
        else if (lock === lockPath) {
          if (await kind(lock) === 'file') add('lock-present', lock)
          else add('unsafe-path', lock)
        }
      }
    }
  }

  const manifest = await json(manifestPath, 'invalid-manifest')
  if (manifest) {
    const files = manifest.files
    if (manifest.format !== 1 || typeof manifest.projectId !== 'string' || manifest.projectId !== projectId ||
        !files || typeof files !== 'object' || Array.isArray(files)) {
      add('invalid-manifest', manifestPath)
    } else {
      const paths = Object.keys(files).sort()
      if (paths.some(path => path !== 'novel.json' && path !== databasePath && !migrationBody.test(path))) {
        add('invalid-manifest', manifestPath)
      }
      for (const path of paths) {
        if (migrationBody.test(path) && !observed.has(path)) add('missing-body', path)
      }
    }
  }

  let legacyDatabase: ProjectInspectionReport['legacyDatabase'] = 'absent'
  const database = await kind(databasePath)
  if (database === 'missing' && manifest) add('unreadable-database', databasePath)
  let offline = true
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const path = databasePath + suffix
    const type = await kind(path)
    if (type !== 'missing') {
      offline = false
      if (type !== 'unknown') add('database-sidecar', path)
    }
  }
  if (database !== 'missing' || !offline) {
    legacyDatabase = 'skipped'
    if (database === 'file' && offline) {
      try {
        issues.push(...await reader.inspectLegacyDatabase())
        legacyDatabase = 'checked'
      } catch { add('unreadable-database', databasePath) }
    } else if (database === 'directory' || database === 'unsafe') add('unsafe-path', databasePath)
  }
  return { projectId, ok: issues.length === 0, legacyDatabase, issues }
}
