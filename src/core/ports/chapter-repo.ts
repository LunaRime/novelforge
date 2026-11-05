import type { Chapter, ChapterMeta, StoredChapter } from '../domain/chapter'

export interface SaveChapterOptions {
  /** null creates a new identity; updates require the revision the caller read. */
  expectedRevision: string | null
}

export interface ChapterRepo {
  byId(id: string): Promise<StoredChapter | null>
  list(): Promise<ChapterMeta[]>
  save(chapter: Chapter, options: SaveChapterOptions): Promise<StoredChapter>
  remove(id: string, options: SaveChapterOptions): Promise<void>
}
