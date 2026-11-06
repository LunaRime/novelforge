import { describe, it, expect, vi } from 'vitest'
import { createKnowledgeExportApplication } from './prepare-knowledge-export'
import type { KnowledgeDocument } from '../ports/knowledge'

const doc = (fileName: string): KnowledgeDocument => ({ id: fileName, fileName, filePath: fileName, importedAt: '', chunkCount: 1 })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function fixture() {
  const source = { id: 'a', path: '/a', session: 1 }
  const ports = { scope: () => source, title: vi.fn(async (chapter: number): Promise<string | undefined> => `Title ${chapter}`) }
  return { source, ports, app: createKnowledgeExportApplication(ports) }
}
describe('knowledge export metadata', () => {
  it('filters invalid chapter numbers and deduplicates while preserving source order', async () => {
    const { app, ports } = fixture()
    const result = await app.prepare(['chapter_2.md', '第1章 开场.md', 'chapter_2.txt', 'notes.md', 'chapter_0.md', 'chapter_999999999999999999999.md'].map(doc))
    expect(result).toEqual({ chapterNumbers: [2, 1], chapterTitles: { 1: 'Title 1', 2: 'Title 2' } })
    expect(ports.title).toHaveBeenCalledTimes(2)
  })
  it('falls back to the source filename on missing or failed title reads', async () => {
    const { app, ports } = fixture()
    ports.title.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'))
    await expect(app.prepare([doc('chapter_1.md'), doc('chapter_2.md')])).resolves.toEqual({
      chapterNumbers: [1, 2], chapterTitles: { 1: 'chapter_1.md', 2: 'chapter_2.md' },
    })
  })
  it('stops after source session changes during a title read', async () => {
    const { app, ports, source } = fixture(); const pending = deferred<string>()
    ports.title.mockReturnValueOnce(pending.promise)
    const request = app.prepare([doc('chapter_1.md'), doc('chapter_2.md')])
    const rejected = expect(request).rejects.toMatchObject({ name: 'KnowledgeRequestCancelled' })
    source.session++; pending.resolve('old')
    await rejected; expect(ports.title).toHaveBeenCalledTimes(1)
  })
  it('copies document input and rejects superseded metadata requests', async () => {
    const { app, ports } = fixture(); const pending = deferred<string>()
    ports.title.mockReturnValueOnce(pending.promise)
    const docs = [doc('chapter_1.md'), doc('chapter_2.md')]
    const request = app.prepare(docs); const rejected = expect(request).rejects.toMatchObject({ name: 'KnowledgeRequestCancelled' })
    docs[1].fileName = 'chapter_3.md'
    await expect(app.prepare([doc('chapter_4.md')])).resolves.toEqual({ chapterNumbers: [4], chapterTitles: { 4: 'Title 4' } })
    pending.resolve('old'); await rejected
    expect(ports.title).not.toHaveBeenCalledWith(3)
  })
  it('disposal prevents new IO', async () => {
    const { app, ports } = fixture(); app.dispose()
    await expect(app.prepare([doc('chapter_1.md')])).rejects.toMatchObject({ name: 'KnowledgeRequestCancelled' })
    expect(ports.title).not.toHaveBeenCalled()
  })
})
