import { beforeEach, expect, test, vi } from 'vitest'
import { inferFileImport, inferFileImportBlueprints } from './file-import-inference'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  events: new Map<string, (event: { requestId: string; fullText?: string }) => void>(),
}))
vi.mock('../ipc-client', () => ({ ipc: { invoke: h.invoke, on: (channel: string, callback: never) => {
  h.events.set(channel, callback)
  return () => h.events.delete(channel)
} } }))
vi.mock('../../stores/llm-store', () => ({ useLLMStore: { getState: () => ({ getModelForPurpose: () => 'model' }) } }))

const chapters = [{ title: 'World', content: 'published $& text' }]
const revisions = [{ chapterId: 'chapter', revision: 'published' }]
const input = { projectId: 'candidate', revisions, samples: [{ ...chapters[0], number: 4 }], excerpts: [],
  settingsOffer: { id: 'offer', available: ['worldSetting'], occupied: [] } }
let requestId: string

beforeEach(() => {
  h.events.clear()
  h.invoke.mockReset().mockImplementation(async (channel: string, ...args: unknown[]) => {
    if (channel === 'project:file-editor-import-inference') return input
    if (channel === 'project:file-editor-import-source') return { projectId: input.projectId, chapters: revisions }
    if (channel === 'llm:generate-stream') {
      requestId = args[0] as string
      return { started: true, requestId }
    }
  })
})

test.each(['published', 'changed'])('checks the source again before showing model output (%s)', async revision => {
  const run = inferFileImport('session', 4, chapters, new AbortController().signal)
  await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledWith('llm:generate-stream', expect.any(String),
    expect.objectContaining({ modelId: 'model', responseFormat: { type: 'json_object' }, messages: expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: expect.stringContaining(chapters[0].content) }),
    ]) })))
  if (revision === 'changed') h.invoke.mockResolvedValueOnce({ projectId: input.projectId, chapters: [{ ...revisions[0], revision }] })
  const assertion = revision === 'published'
    ? expect(run).resolves.toEqual({ values: { worldSetting: 'Flooded cities' }, settingsOffer: input.settingsOffer })
    : expect(run).rejects.toThrow()
  h.events.get('llm:stream-done')!({ requestId, fullText: '{"worldSetting":"Flooded cities","unrelated":"unused"}' })
  await assertion
  expect(h.invoke).toHaveBeenLastCalledWith('project:file-editor-import-source', 'session', 4, chapters)
  expect(h.events.size).toBe(0)
})

test('cancels the stream if the user leaves before startup is acknowledged', async () => {
  const controller = new AbortController()
  let acknowledge!: (value: { started: boolean }) => void
  const startup = new Promise<{ started: boolean }>(resolve => { acknowledge = resolve })
  h.invoke.mockResolvedValueOnce(input).mockReturnValueOnce(startup)
  const run = inferFileImport('session', 4, chapters, controller.signal)
  await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2))
  const id = h.invoke.mock.calls[1][1]
  const rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await rejected
  expect(h.events.size).toBe(0)
  acknowledge({ started: true })
  await vi.waitFor(() => expect(h.invoke).toHaveBeenLastCalledWith('llm:cancel', id))
})

test('generates one blueprint per eligible source and owns the chapter identity', async () => {
  const controller = new AbortController()
  const progress = vi.fn()
  const second = { chapterId: 'chapter-2', revision: 'published-2' }
  h.invoke.mockResolvedValueOnce({ ...input, revisions: [...revisions, second], offerId: 'blueprints',
    candidates: [{ ...chapters[0], number: 4 }, { title: 'Next', content: 'ending text', number: 6 }], existingChapterNumbers: [5] })
  const run = inferFileImportBlueprints('session', 4, chapters, controller.signal, progress)
  await vi.waitFor(() => expect(h.invoke.mock.calls.filter(([channel]) => channel === 'llm:generate-stream')).toHaveLength(1))
  h.events.get('llm:stream-done')!({ requestId, fullText: '{"chapterNumber":5,"title":"New outline","characters":"A、B"}' })
  await vi.waitFor(() => expect(h.invoke.mock.calls.filter(([channel]) => channel === 'llm:generate-stream')).toHaveLength(2))
  h.invoke.mockResolvedValueOnce({ projectId: input.projectId, chapters: [...revisions, second] })
  h.events.get('llm:stream-done')!({ requestId, fullText: '{"purpose":"Wrap up"}' })
  await expect(run).resolves.toMatchObject({ offerId: 'blueprints', existingChapterNumbers: [5], items: [
    { chapterNumber: 4, title: 'New outline', characters: ['A', 'B'] }, { chapterNumber: 6, title: 'Next', purpose: 'Wrap up' },
  ] })
  expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]])
})

test('makes no model request when the whole batch already has blueprints', async () => {
  h.invoke.mockResolvedValueOnce({ ...input, candidates: [], existingChapterNumbers: [4] })
  await expect(inferFileImportBlueprints('session', 4, chapters, new AbortController().signal, vi.fn()))
    .resolves.toMatchObject({ items: [], existingChapterNumbers: [4] })
  expect(h.invoke).toHaveBeenCalledExactlyOnceWith('project:file-editor-import-blueprints', 'session', 4, chapters)
})
