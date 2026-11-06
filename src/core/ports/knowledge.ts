export interface KnowledgeDocument { id: string; fileName: string; importedAt: string; chunkCount: number; filePath: string }
export interface KnowledgeSearchResult { text: string; score: number; fileName: string }
export interface KnowledgeStats { documentCount: number; totalChunks: number; vectorDimension: number }
export interface KnowledgeData { documents: KnowledgeDocument[]; stats: KnowledgeStats }
export interface KnowledgePorts {
  scope(): { id: string; path: string; session: number } | null
  load(): Promise<KnowledgeData>
  search(query: string, topK: number): Promise<KnowledgeSearchResult[]>
  read(path: string, assertCurrent: () => void): Promise<string>
  generate(content: string, systemPrompt: string): Promise<string>
  remove(id: string): Promise<void>
}
