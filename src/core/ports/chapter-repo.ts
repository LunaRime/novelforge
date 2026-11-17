import type { Chapter, ChapterMeta, StoredChapter } from '../domain/chapter'

export interface SaveChapterOptions {
  /** null creates a new identity; updates require the revision the caller read. */
  expectedRevision: string | null
  /** 文件正式发布前重新检查调用方会话。 */
  assertCurrent?: () => void
}

export interface ChapterRepo {
  byId(id: string): Promise<StoredChapter | null>
  list(): Promise<ChapterMeta[]>
  save(chapter: Chapter, options: SaveChapterOptions): Promise<StoredChapter>
  remove(id: string, options: SaveChapterOptions): Promise<void>
}

export interface LockedFileChapterRepo extends Pick<ChapterRepo, 'byId' | 'save'> {
  /** Check the live files under the writer lock before recording a first publication. */
  canCreate(chapter: Chapter): Promise<boolean>
}
