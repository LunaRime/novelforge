import * as fs from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assertChapter, assertChapterId, ChapterError, type Chapter, type ChapterMeta, type StoredChapter } from '../domain/chapter'
import type { ChapterIndex } from '../ports/chapter-index'
import type { ChapterRepo, LockedFileChapterRepo, SaveChapterOptions } from '../ports/chapter-repo'
import { fileRevision, parseChapter, serializeChapter } from './chapter-format'

interface StoreOptions {
  projectPath: string
  projectId: string
  index: ChapterIndex
  onIndexError?: (error: unknown) => void
}
interface ScannedChapter {
  chapter: Chapter
  text: string
  meta: ChapterMeta
}
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

/**
 * File chapter repository used by offline tools and the isolated editor. Cooperating writers take a project lock because
 * chapter numbers share a namespace. A stale lock is reported, never auto-deleted.
 * External editors may ignore this lock. Check the file revision before publishing a change.
 */
export class FileChapterStore implements ChapterRepo {
  private constructor(private readonly options: StoreOptions, private readonly root: string) {}

  static async open(options: StoreOptions): Promise<FileChapterStore> {
    if (!options.projectId) throw new ChapterError('project-mismatch', 'Project id is required')
    await fs.mkdir(resolve(options.projectPath), { recursive: true })
    const root = await fs.realpath(resolve(options.projectPath))
    const store = new FileChapterStore(options, root)
    const manifest = join(root, 'novel.json')
    try {
      const handle = await fs.open(manifest, 'wx')
      try { await handle.writeFile(JSON.stringify({ id: options.projectId, schemaVersion: 1 })); await handle.sync() }
      finally { await handle.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    await store.assertProject()
    for (const parts of [['chapters'], ['history'], ['.novelforge'], ['.novelforge', 'locks']]) await store.directory(parts)
    await store.rescan()
    return store
  }

  private async assertProject(): Promise<void> {
    if (await fs.realpath(resolve(this.options.projectPath)) !== this.root) {
      throw new ChapterError('project-mismatch', 'Project path changed')
    }
    const manifest = join(this.root, 'novel.json')
    await this.assertRegular(manifest)
    const data: unknown = JSON.parse(await fs.readFile(manifest, 'utf8'))
    if (!data || typeof data !== 'object' || !('id' in data) || data.id !== this.options.projectId) {
      throw new ChapterError('project-mismatch', 'Project identity changed')
    }
  }

  private async assertRegular(path: string): Promise<void> {
    const stat = await fs.lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ChapterError('unsafe-path', 'Expected a regular file')
  }

  private async directory(parts: string[], createIfMissing = true): Promise<string> {
    let current = this.root
    for (const part of parts) {
      current = join(current, part)
      if (createIfMissing) {
        try { await fs.mkdir(current) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      }
      const stat = await fs.lstat(current)
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(current) !== current) {
        throw new ChapterError('unsafe-path', 'Project subdirectory is a link or not a directory')
      }
    }
    return current
  }

  private async scan(createIfMissing = true): Promise<ScannedChapter[]> {
    await this.assertProject()
    const dir = await this.directory(['chapters'], createIfMissing)
    const scanned: ScannedChapter[] = []
    const ids = new Set<string>()
    const numbers = new Set<number>()
    for (const name of (await fs.readdir(dir)).sort()) {
      if (!name.endsWith('.md')) continue
      const path = join(dir, name)
      await this.assertRegular(path)
      const text = await fs.readFile(path, 'utf8')
      const chapter = parseChapter(text)
      if (chapter.projectId !== this.options.projectId) throw new ChapterError('project-mismatch', `Foreign chapter: ${name}`)
      if (ids.has(chapter.id)) throw new ChapterError('duplicate-id', `Duplicate chapter identity: ${chapter.id}`)
      if (numbers.has(chapter.number)) throw new ChapterError('number-conflict', `Duplicate chapter number: ${chapter.number}`)
      ids.add(chapter.id)
      numbers.add(chapter.number)
      scanned.push({ chapter, text, meta: { id: chapter.id, number: chapter.number, title: chapter.title,
        status: chapter.status, path: `chapters/${name}`, revision: fileRevision(text),
        wordCount: chapter.content.replace(/\s/gu, '').length } })
    }
    return scanned
  }

  private async updateIndex(scanned: ScannedChapter[]): Promise<boolean> {
    try { await this.options.index.replace(scanned.map(s => s.meta)); return true }
    catch (error) {
      // A reporting callback must not turn an already committed save into failure.
      try { this.options.onIndexError?.(error) } catch { /* caller receives indexed=false */ }
      return false
    }
  }

  async rescan(): Promise<ChapterMeta[]> {
    const scanned = await this.scan()
    // Explicit repair must surface an unavailable index rather than claim success.
    await this.options.index.replace(scanned.map(s => s.meta))
    return scanned.map(s => s.meta)
  }

  async list(): Promise<ChapterMeta[]> {
    await this.assertProject()
    return this.options.index.list()
  }

  async byId(id: string): Promise<StoredChapter | null> {
    assertChapterId(id)
    const scanned = await this.scan()
    const indexed = await this.updateIndex(scanned)
    const match = scanned.find(s => s.chapter.id === id)
    return match ? { chapter: match.chapter, revision: match.meta.revision, indexed } : null
  }

  /** 一次读取本批所需正文和对应 revision。只读取现有文件，不创建目录或更新索引。 */
  async readByIds(ids: readonly string[]): Promise<Map<string, Pick<StoredChapter, 'chapter' | 'revision'>>> {
    const requested = new Set(ids)
    requested.forEach(assertChapterId)
    const result = new Map<string, Pick<StoredChapter, 'chapter' | 'revision'>>()
    if (!requested.size) return result
    for (const { chapter, meta } of await this.scan(false)) {
      if (requested.has(chapter.id)) result.set(chapter.id, { chapter, revision: meta.revision })
    }
    return result
  }

  private async locked<T>(work: () => Promise<T>): Promise<T> {
    await this.assertProject()
    const dir = await this.directory(['.novelforge', 'locks'])
    const path = join(dir, 'chapter-write.lock')
    let handle
    try { handle = await fs.open(path, 'wx') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ChapterError('locked', 'Project chapter writer is active or requires lock recovery')
      throw error
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
      return await work()
    } finally {
      await handle.close()
      await fs.unlink(path)
    }
  }

  private checkRevision(current: ScannedChapter | undefined, options: SaveChapterOptions): void {
    if (!options || (current?.meta.revision ?? null) !== options.expectedRevision) {
      throw new ChapterError('conflict', 'Chapter changed since it was read')
    }
  }

  private async snapshot(current: ScannedChapter): Promise<void> {
    const dir = await this.directory(['history', current.chapter.id])
    await this.atomicWrite(join(dir, `${Date.now()}-${randomUUID()}.md`), current.text, false)
  }

  private async atomicWrite(path: string, text: string, replace: boolean): Promise<void> {
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
    const handle = await fs.open(tmp, 'wx')
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally { await handle.close() }
    try {
      if (replace) await fs.rename(tmp, path)
      else await fs.link(tmp, path) // Exclusive publication; never overwrite an occupied filename.
    } finally { await fs.unlink(tmp).catch(error => { if (!isMissing(error)) throw error }) }
  }

  async save(input: Chapter, inputOptions: SaveChapterOptions): Promise<StoredChapter> {
    // Capture caller-owned inputs before waiting for the lock.
    const chapter = structuredClone(input)
    const options = { ...inputOptions }
    return this.locked(() => this.saveLocked(chapter, options))
  }

  /** Holds the same writer lock from intent preparation through the retained DB receipt. */
  async withCommitLock<T>(work: (repo: LockedFileChapterRepo) => Promise<T>): Promise<T> {
    return this.locked(async () => {
      let active = true
      try {
        return await work({
          byId: id => this.byId(id),
          canCreate: chapter => {
            if (!active) throw new ChapterError('locked', 'File commit lock has been released')
            return this.canCreateLocked(chapter)
          },
          save: (chapter, options) => {
            if (!active) throw new ChapterError('locked', 'File commit lock has been released')
            return this.saveLocked(chapter, options)
          },
        })
      } finally { active = false }
    })
  }

  private chapterFileName(number: number): string {
    return `${String(number).padStart(4, '0')}.md`
  }

  private async pathIsVacant(path: string): Promise<boolean> {
    try { await fs.lstat(path); return false }
    catch (error) { if (isMissing(error)) return true; throw error }
  }

  private async canCreateLocked(chapter: Chapter): Promise<boolean> {
    assertChapter(chapter)
    if (chapter.projectId !== this.options.projectId) throw new ChapterError('project-mismatch', 'Cannot write a foreign chapter')
    const scanned = await this.scan()
    return !scanned.some(s => s.chapter.id === chapter.id || s.chapter.number === chapter.number) &&
      await this.pathIsVacant(join(this.root, 'chapters', this.chapterFileName(chapter.number)))
  }

  private async saveLocked(input: Chapter, inputOptions: SaveChapterOptions): Promise<StoredChapter> {
    const chapter = structuredClone(input)
    const options = { ...inputOptions }
    assertChapter(chapter)
    if (chapter.projectId !== this.options.projectId) throw new ChapterError('project-mismatch', 'Cannot write a foreign chapter')
    const scanned = await this.scan()
    const current = scanned.find(s => s.chapter.id === chapter.id)
    this.checkRevision(current, options)
    if (scanned.some(s => s.chapter.number === chapter.number && s.chapter.id !== chapter.id)) {
      throw new ChapterError('number-conflict', 'Chapter number already belongs to another identity')
    }
    const name = this.chapterFileName(chapter.number)
    const path = join(this.root, 'chapters', name)
    const oldPath = current ? join(this.root, current.meta.path) : null
    if (oldPath !== path && !(await this.pathIsVacant(path))) {
      throw new ChapterError('number-conflict', 'Destination is occupied')
    }
    const text = serializeChapter(chapter)
    if (current && current.text === text && oldPath === path) {
      return { chapter, revision: current.meta.revision, indexed: await this.updateIndex(scanned) }
    }
    if (current) await this.snapshot(current)
    // Check again after snapshot IO so an intervening external edit is not lost.
    if (current && fileRevision(await fs.readFile(oldPath!, 'utf8')) !== current.meta.revision) {
      throw new ChapterError('conflict', 'Chapter was externally edited during save')
    }
    await this.assertProject()
    if (oldPath && oldPath !== path) {
      // Persist metadata first, then link to an unoccupied new name. A crash can
      // leave two copies with the same id; scan refuses ambiguity instead of losing data.
      await this.atomicWrite(oldPath, text, true)
      await fs.link(oldPath, path)
      await fs.unlink(oldPath)
    } else await this.atomicWrite(path, text, !!current)
    // Do not re-read unrelated files after commit: an external malformed file
    // must not make a completed save appear to have failed.
    const after = scanned.filter(s => s.chapter.id !== chapter.id)
    after.push({ chapter, text, meta: { id: chapter.id, number: chapter.number,
      title: chapter.title, status: chapter.status, path: `chapters/${name}`,
      revision: fileRevision(text), wordCount: chapter.content.replace(/\s/gu, '').length } })
    return { chapter, revision: fileRevision(text), indexed: await this.updateIndex(after) }
  }

  async remove(id: string, options: SaveChapterOptions): Promise<void> {
    assertChapterId(id)
    await this.locked(async () => {
      const scanned = await this.scan()
      const current = scanned.find(s => s.chapter.id === id)
      this.checkRevision(current, options)
      if (!current) return
      await this.snapshot(current)
      const path = join(this.root, current.meta.path)
      if (fileRevision(await fs.readFile(path, 'utf8')) !== current.meta.revision) throw new ChapterError('conflict', 'Chapter changed during removal')
      await this.assertProject()
      await fs.unlink(path)
      await this.updateIndex(scanned.filter(s => s.chapter.id !== id))
    })
  }
}
