import type { KnowledgeDocument } from '../ports/knowledge'
import type { KnowledgeExportPorts, KnowledgeExportMetadata } from '../ports/knowledge-export'
import { KnowledgeRequestCancelled } from './knowledge'

export function createKnowledgeExportApplication(ports: KnowledgeExportPorts, initial = ports.scope()) {
  const source = initial ? { ...initial } : null
  let disposed = false
  let version = 0
  return {
    async prepare(documents: readonly KnowledgeDocument[]): Promise<KnowledgeExportMetadata> {
      const request = ++version
      const check = () => {
        const current = ports.scope()
        if (disposed || request !== version || !source || !current || source.id !== current.id || source.path !== current.path || source.session !== current.session) throw new KnowledgeRequestCancelled()
      }
      check()
      const captured = documents.map(doc => doc.fileName)
      const chapterNumbers: number[] = []
      const chapterTitles: Record<number, string> = {}
      for (const fileName of captured) {
        check()
        const match = fileName.replace(/\.[^.]+$/, '').match(/^(?:chapter_(\d+)|第(\d+)章)/)
        const chapter = match ? Number(match[1] || match[2]) : 0
        if (!Number.isSafeInteger(chapter) || chapter < 1 || chapterNumbers.includes(chapter)) continue
        chapterNumbers.push(chapter)
        try {
          const title = await ports.title(chapter)
          check(); chapterTitles[chapter] = title?.trim() || fileName
        } catch (error) {
          check()
          if (error instanceof KnowledgeRequestCancelled) throw error
          chapterTitles[chapter] = fileName
        }
      }
      check(); return { chapterNumbers, chapterTitles }
    },
    dispose() { disposed = true; version++ },
  }
}
