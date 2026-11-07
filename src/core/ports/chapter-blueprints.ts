export interface ChapterBlueprintScope { id: string; path: string; session: number }
export interface ChapterBlueprintSort { key: 'chapter_number' | 'priority' | 'role' | 'custom'; direction: 'asc' | 'desc' }
export interface ChapterBlueprintSaveReceipt { refreshError?: string }
export interface ChapterBlueprintPorts<C extends { chapterNumber: number }> {
  scope(): ChapterBlueprintScope | null
  readList(sort?: ChapterBlueprintSort): Promise<C[]>
  readNextWriteChapter(): Promise<number>
  saveOne(item: C): Promise<boolean>
  saveAll(items: C[]): Promise<boolean>
  deleteOne(chapterNumber: number): Promise<boolean>
  refreshFileTree(): Promise<void>
}
