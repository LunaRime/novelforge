export interface KnowledgeExportPorts {
  scope(): { id: string; path: string; session: number } | null
  title(chapter: number): Promise<string | undefined>
}
export interface KnowledgeExportMetadata {
  chapterNumbers: number[]
  chapterTitles: Record<number, string>
}
