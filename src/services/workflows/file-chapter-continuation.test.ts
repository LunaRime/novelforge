import { expect, test, vi } from 'vitest'
import { generateFileChapterContinuation } from './file-chapter-continuation'

const { request, model, invoke } = vi.hoisted(() => ({ request: vi.fn(), model: vi.fn(), invoke: vi.fn() }))
vi.mock('../llm/request-stream-text', () => ({ requestStreamText: request }))
vi.mock('../../stores/llm-store', () => ({ useLLMStore: { getState: () => ({ getModelForPurpose: model }) } }))
vi.mock('../ipc-client', () => ({ ipc: { invoke } }))

test('uses scoped manuscript and planning context and rejects a cancelled continuation', async () => {
  const run = new AbortController()
  model.mockReturnValue('writer')
  request.mockImplementationOnce(async () => { run.abort(); return 'Late draft' })
  const source = { chapterId: 'ch_12345678', revision: 'source revision' }
  const context = { previous: 'Ending $&', settings: { worldSetting: 'World' }, blueprint: { keyEvents: 'Cross the river' }, contextRevision: 'hash' }
  invoke.mockResolvedValueOnce(context)
  await expect(generateFileChapterContinuation({ token: 'session', source, number: 7, title: 'A title', guidance: 'Follow the river' }, run.signal))
    .rejects.toMatchObject({ name: 'AbortError' })
  expect(model).toHaveBeenCalledExactlyOnceWith('draft_chapter')
  const [payload, signal] = request.mock.lastCall!
  expect(payload.modelId).toBe('writer')
  expect(signal).toBe(run.signal)
  expect(invoke).toHaveBeenCalledExactlyOnceWith('project:file-editor-continuation-context', 'session', 7, source)
  expect(JSON.parse(payload.messages[1].content)).toEqual({ number: 7, title: 'A title', previous: context.previous,
    settings: context.settings, blueprint: context.blueprint, guidance: 'Follow the river' })
})
