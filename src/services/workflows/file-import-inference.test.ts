import { beforeEach, expect, test, vi } from 'vitest'
import { inferFileImport } from './file-import-inference'

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
