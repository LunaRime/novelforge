import { beforeEach, expect, it, vi } from 'vitest'
import { FillGapsCommand } from './fill-gaps.command'

const h = vi.hoisted(() => ({ llm: vi.fn(), insert: vi.fn(), writer: vi.fn(), save: vi.fn(), state: { currentProject: { id: 'a', path: '/a', novelConfig: { totalChapters: 4, globalGuidance: '' } }, projectSession: 1 }, parsed: [] as Array<{ chapterNumber: number }> }))
vi.mock('./base-command', () => ({ BaseWorkflowCommand: class { protected callLLM = h.llm } }))
vi.mock('../../../stores/project-store', () => ({ useProjectStore: { getState: () => h.state } }))
vi.mock('../../chapters/chapter-blueprint-adapter', () => ({
  captureChapterBlueprintScope: () => ({ id: h.state.currentProject.id, path: h.state.currentProject.path, session: h.state.projectSession }),
  assertChapterBlueprintScope: (source: { id: string; path: string; session: number }) => {
    if (source.path !== h.state.currentProject.path || source.session !== h.state.projectSession) throw new Error('scope changed')
  },
  createMissingBlueprintWriter: h.writer,
}))
vi.mock('../directory-workflow', () => ({ parseTextBlueprints: () => h.parsed, saveAllBlueprints: h.save }))
vi.mock('../../prompt-templates', () => ({ getPromptTemplate: () => ({ systemRole: 'Role' }) }))
vi.mock('../../prompts/prompt-builder', () => ({ DirectoryPromptBuilder: class {
  withNovelArchitecture() { return this }
  withChapterList() { return this }
  withNumberOfChapters() { return this }
  withN() { return this }
  withM() { return this }
  withGlobalGuidance() { return this }
  withPacingGuidance() { return this }
  build() { return 'Prompt' }
} }))
const gap = { missingChapterNumbers: [2, 3], gapSize: 2, context: 'Adjacent', precedingChapter: null, followingChapter: null }
const source = { id: 'a', path: '/a', session: 1 }
const request = () => ({ step: {}, context: { data: { architecture: 'Architecture' }, cancelled: false } as never, callbacks: { log: vi.fn(), setProgress: vi.fn(), appendText: vi.fn() } })
beforeEach(() => {
  vi.clearAllMocks(); h.state.projectSession = 1; h.parsed = [{ chapterNumber: 2 }, { chapterNumber: 3 }]
  h.writer.mockResolvedValue({ insert: h.insert }); h.insert.mockResolvedValue({ insertedChapterNumbers: [3], skippedChapterNumbers: [2] })
  h.llm.mockResolvedValue('Generated'); h.save.mockResolvedValue(undefined)
})
it('captures write scope before LLM and reports only actual insertions without upsert', async () => {
  const params = request()
  const filled = await new FillGapsCommand({ gaps: [gap], source }).execute(params)
  expect(h.writer).toHaveBeenCalledWith(source)
  expect(h.writer.mock.invocationCallOrder[0]).toBeLessThan(h.llm.mock.invocationCallOrder[0])
  expect(h.insert).toHaveBeenCalledWith([2, 3], h.parsed)
  expect(filled).toEqual([{ chapterNumber: 3 }]); expect(h.save).not.toHaveBeenCalled()
  expect(h.llm.mock.calls[0][4]).toBe(params.context)
})
it('does not write after cancellation while the model was pending', async () => {
  const params = request()
  h.llm.mockImplementationOnce(async () => { (params.context as { cancelled: boolean }).cancelled = true; return 'Late' })
  await expect(new FillGapsCommand({ gaps: [gap], source }).execute(params)).rejects.toThrow()
  expect(h.insert).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled()
  expect(params.callbacks.setProgress).not.toHaveBeenCalledWith(100)
})
it('rejects a same-path reopened source before saving or generating', async () => {
  const cmd = new FillGapsCommand({ gaps: [gap], source }); h.state.projectSession = 2
  await expect(cmd.execute(request())).rejects.toThrow()
  expect(h.llm).not.toHaveBeenCalled(); expect(h.insert).not.toHaveBeenCalled()
})
it('a failed write is propagated instead of a successful empty fill', async () => {
  h.insert.mockRejectedValueOnce(new Error('transaction failed'))
  const params = request()
  await expect(new FillGapsCommand({ gaps: [gap], source }).execute(params)).rejects.toThrow('transaction failed')
  expect(params.callbacks.setProgress).not.toHaveBeenCalledWith(100)
})
it('counts a partial model response honestly and records committed versus skipped chapters', async () => {
  h.parsed = [{ chapterNumber: 2 }]
  h.insert.mockResolvedValueOnce({ insertedChapterNumbers: [2], skippedChapterNumbers: [] })
  const params = request()
  expect(await new FillGapsCommand({ gaps: [gap], source }).execute(params)).toEqual([{ chapterNumber: 2 }])
  expect(params.context).toMatchObject({ data: { gapFillReceipt: { insertedChapterNumbers: [2], skippedChapterNumbers: [] } } })
})
it('keeps earlier committed groups visible when a later write fails', async () => {
  const params = request()
  h.parsed = [{ chapterNumber: 2 }]
  h.insert.mockResolvedValueOnce({ insertedChapterNumbers: [2], skippedChapterNumbers: [] }).mockRejectedValueOnce(new Error('later failed'))
  const gaps = [2, 3].map(chapter => ({ ...gap, missingChapterNumbers: [chapter], gapSize: 1 }))
  await expect(new FillGapsCommand({ gaps, source }).execute(params)).rejects.toThrow('later failed')
  expect(params.context).toMatchObject({ data: { gapFillReceipt: { insertedChapterNumbers: [2], skippedChapterNumbers: [] } } })
  expect(params.callbacks.setProgress).not.toHaveBeenCalledWith(100)
})
it('freezes target parameters at command construction before asynchronous work', async () => {
  const mutableGap = { ...gap, missingChapterNumbers: [2, 3] }
  const cmd = new FillGapsCommand({ gaps: [mutableGap], source })
  mutableGap.missingChapterNumbers[0] = 99
  await cmd.execute(request())
  expect(h.insert).toHaveBeenCalledWith([2, 3], h.parsed)
})
it('empty model output cannot claim completion', async () => {
  h.parsed = []
  await expect(new FillGapsCommand({ gaps: [gap], source }).execute(request())).rejects.toThrow()
  expect(h.insert).not.toHaveBeenCalled()
})
