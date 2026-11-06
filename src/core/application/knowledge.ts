import type { KnowledgeDocument, KnowledgePorts, KnowledgeData } from '../ports/knowledge'

export class KnowledgeRequestCancelled extends Error {
  constructor() { super('Knowledge request is no longer current'); this.name = 'KnowledgeRequestCancelled' }
}

/** A panel session owns independent request lanes and one immutable project identity. */
export function createKnowledgeApplication(ports: KnowledgePorts, initial = ports.scope()) {
  const source = initial ? { ...initial } : null
  const versions = { load: 0, search: 0, summary: 0, titles: 0 }
  let disposed = false
  const assertScope = () => {
    const current = ports.scope()
    if (disposed || !source || !current || source.id !== current.id || source.path !== current.path || source.session !== current.session) throw new KnowledgeRequestCancelled()
  }
  const begin = (lane: keyof typeof versions) => {
    const version = ++versions[lane]
    return () => { assertScope(); if (versions[lane] !== version) throw new KnowledgeRequestCancelled() }
  }
  const step = async <T>(check: () => void, operation: () => Promise<T>): Promise<T> => {
    check()
    try { const value = await operation(); check(); return value }
    catch (error) { check(); throw error }
  }
  const invalidate = () => { for (const lane of Object.keys(versions) as Array<keyof typeof versions>) versions[lane]++ }
  return {
    assertCurrent: assertScope,
    cancelSearch: () => { versions.search++ },
    cancelSummary: () => { versions.summary++ },
    dispose: () => { disposed = true; invalidate() },
    load() { return step(begin('load'), () => ports.load()) },
    search(query: string, topK = 10) {
      const check = begin('search')
      return step(check, () => query.trim() ? ports.search(query.trim(), topK) : Promise.resolve([]))
    },
    async summarize(document: KnowledgeDocument, systemPrompt: string): Promise<{ status: 'empty' } | { status: 'ready'; text: string }> {
      const check = begin('summary')
      const path = document.filePath
      const content = await step(check, () => ports.read(path, check))
      if (!content.trim()) return { status: 'empty' }
      const text = await step(check, () => ports.generate(content.slice(0, 30_000), systemPrompt))
      return { status: 'ready', text }
    },
    async titles(documents: readonly KnowledgeDocument[]) {
      const check = begin('titles')
      const captured = documents.map(doc => ({ id: doc.id, fileName: doc.fileName, filePath: doc.filePath }))
      const titles: Record<string, string> = {}
      await Promise.all(captured.map(async doc => {
        try {
          const text = await step(check, () => ports.read(doc.filePath, check))
          titles[doc.id] = text.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim() || doc.fileName
        } catch (error) { check(); if (error instanceof KnowledgeRequestCancelled) throw error; titles[doc.id] = doc.fileName }
      }))
      check(); return titles
    },
    async remove(document: KnowledgeDocument): Promise<{ success: true; data?: KnowledgeData; refreshError?: string }> {
      assertScope()
      const id = document.id
      invalidate()
      // Persistence errors remain errors. Projection errors after the commit do not undo success.
      try { await ports.remove(id) }
      catch (error) { assertScope(); throw error }
      try {
        assertScope(); invalidate()
        const data = await step(begin('load'), () => ports.load())
        return { success: true, data }
      } catch (error) { return { success: true, refreshError: String(error) } }
    },
  }
}
