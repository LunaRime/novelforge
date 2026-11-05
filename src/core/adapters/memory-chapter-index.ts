import type { ChapterMeta } from '../domain/chapter'
import type { ChapterIndex } from '../ports/chapter-index'

export class MemoryChapterIndex implements ChapterIndex {
  private entries: ChapterMeta[] = []
  async list(): Promise<ChapterMeta[]> {
    return this.entries.map(e => ({ ...e })).sort((a, b) => a.number - b.number)
  }
  async replace(entries: ChapterMeta[]): Promise<void> {
    this.entries = entries.map(e => ({ ...e }))
  }
}
