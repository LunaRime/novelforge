import type { ChapterMeta } from '../domain/chapter'

/** Disposable projection. replace must publish a complete scan atomically. */
export interface ChapterIndex {
  list(): Promise<ChapterMeta[]>
  replace(entries: ChapterMeta[]): Promise<void>
}
