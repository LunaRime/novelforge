import { beforeEach, expect, it, vi } from 'vitest'
import { GenerateDirectoryCommand } from './directory.command'

const h = vi.hoisted(() => ({
  llm: vi.fn(), parse: vi.fn(), parseRepaired: vi.fn(), repair: vi.fn(), save: vi.fn(), refresh: vi.fn(), chapterList: vi.fn(),
}))
vi.mock('./base-command', () => ({ BaseWorkflowCommand: class { protected callLLM = h.llm } }))
vi.mock('../../../stores/project-store', () => ({ useProjectStore: { getState: () => ({
  currentProject: { id: 'a', path: '/a', novelConfig: { totalChapters: 4 } },
  projectSession: 1, refreshFileTree: h.refresh,
}) } }))
vi.mock('../../../stores/llm-store', () => ({ useLLMStore: { getState: () => ({ models: [] }) } }))
vi.mock('../directory-workflow', () => ({
  parseTextBlueprints: h.parse, parseTextBlueprintsFromParsed: h.parseRepaired, saveAllBlueprints: h.save,
}))
vi.mock('../workflow-utils', () => ({ stripThinkingTags: (text: string) => text, extractAndRepairJSON: h.repair }))
vi.mock('../../prompt-templates', () => ({ getPromptTemplate: () => ({ systemRole: 'Role' }) }))
vi.mock('../../prompts/prompt-builder', () => ({ DirectoryPromptBuilder: class {
  withNovelArchitecture() { return this }
  withChapterList(value: string) { h.chapterList(value); return this }
  withNumberOfChapters() { return this }
  withN() { return this }
  withM() { return this }
  withGlobalGuidance() { return this }
  withGenre() { return this }
  withPacingGuidance() { return this }
  build() { return 'Prompt' }
} }))

const scope = { id: 'a', path: '/a', session: 1 }
const range = { mode: 'replace-all', first: 1, last: 4, totalChapters: 4 } as const
const request = () => ({ step: {}, context: { data: { architecture: 'Architecture' }, cancelled: false }, callbacks: { log: vi.fn(), setProgress: vi.fn(), appendText: vi.fn() } })
const row = (chapterNumber: number, title = 'First') => ({ chapterNumber, title, role: '发展', purpose: '', keyEvents: '', characters: [], suspenseHook: '' })
beforeEach(() => {
  vi.resetAllMocks()
  h.llm.mockResolvedValue('Generated')
  h.parse.mockReturnValue([])
  h.parseRepaired.mockReturnValue([])
  h.repair.mockReturnValue({ parsed: null })
  h.save.mockResolvedValue(undefined)
})

it('rechecks repaired output for head and middle gaps and keeps the first accepted row', async () => {
  h.repair.mockReturnValueOnce({ parsed: {} })
  h.parseRepaired.mockReturnValueOnce([row(2), row(4)])
  h.parse.mockReturnValueOnce([]).mockReturnValueOnce([row(1), row(2, 'Later'), row(3)])
  const params = request()
  const rows = await new GenerateDirectoryCommand({ mode: 'full' }, scope, range).execute(params)
  expect(rows.map(row => row.chapterNumber)).toEqual([1, 2, 3, 4])
  expect(rows[1].title).toBe('First')
  expect(h.parse.mock.calls[1][1]).toBe(1)
  expect(h.save).not.toHaveBeenCalled()
  expect(h.refresh).not.toHaveBeenCalled()
})

it('stops after bounded retries if the model keeps returning the same chapter past a gap', async () => {
  h.parse.mockReturnValue([row(4)])
  const params = request()
  await expect(new GenerateDirectoryCommand({ mode: 'full' }, scope, range).execute(params)).rejects.toThrow()
  expect(h.llm).toHaveBeenCalledTimes(6)
  expect(params.context.data).not.toHaveProperty('newBlueprints')
  expect(h.save).not.toHaveBeenCalled()
})

it('enforces the selected batch boundary on repaired as well as ordinary output', async () => {
  h.repair.mockReturnValueOnce({ parsed: {} })
  h.parseRepaired.mockReturnValueOnce([row(1), row(2), row(3, 'Outside first batch')])
  h.parse.mockReturnValueOnce([]).mockReturnValueOnce([row(3), row(4)])
  const rows = await new GenerateDirectoryCommand({ mode: 'full', generationMode: 'batch', batchChapterCount: 2 }, scope, range).execute(request())
  expect(h.parseRepaired).toHaveBeenCalledWith({}, 1, 2)
  expect(rows[2].title).toBe('First')
  expect(h.save).not.toHaveBeenCalled()
})

it('includes preceding generated chapters instead of future chapters in an early range', async () => {
  const params = request()
  Object.assign(params.context.data, { existingBlueprints: [
    row(1, 'Preceding chapter'), ...Array.from({ length: 30 }, (_, index) => row(index + 5, 'Future chapter')),
  ] })
  h.parse.mockReturnValueOnce([row(2, 'Fresh chapter')]).mockReturnValueOnce([row(3)])
  await new GenerateDirectoryCommand(
    { mode: 'append', generationMode: 'batch', batchChapterCount: 1 },
    scope, { mode: 'replace-range', first: 2, last: 3, totalChapters: 40 },
  ).execute(params)
  expect(h.chapterList.mock.calls[0][0]).toContain('Preceding chapter')
  expect(h.chapterList.mock.calls[1][0]).toContain('Fresh chapter')
  expect(h.chapterList.mock.calls[1][0]).not.toContain('Future chapter')
})
