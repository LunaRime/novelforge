import { assertChapter, type Chapter, type StoredChapter } from '../domain/chapter'
import type { ChapterRepo, SaveChapterOptions } from '../ports/chapter-repo'

/** Shared write entry for future IPC and agent composition roots. */
export async function writeChapter(repo: ChapterRepo, chapter: Chapter, options: SaveChapterOptions): Promise<StoredChapter> {
  assertChapter(chapter)
  return repo.save(chapter, options)
}
