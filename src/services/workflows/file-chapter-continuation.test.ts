import { expect, test, vi } from 'vitest'
import { generateFileChapterContinuation } from './file-chapter-continuation'

const { request, model } = vi.hoisted(() => ({ request: vi.fn(), model: vi.fn() }))
vi.mock('../llm/request-stream-text', () => ({ requestStreamText: request }))
vi.mock('../../stores/llm-store', () => ({ useLLMStore: { getState: () => ({ getModelForPurpose: model }) } }))

test('sends only the preceding manuscript ending and rejects a cancelled continuation', async () => {
  const run = new AbortController()
  model.mockReturnValue('writer')
  request.mockImplementationOnce(async () => { run.abort(); return 'Late draft' })
  const ending = 'x'.repeat(3998) + '$&'
  await expect(generateFileChapterContinuation({ number: 7, title: 'A title', previous: `Omitted${ending}`, guidance: 'Follow the river' }, run.signal))
    .rejects.toMatchObject({ name: 'AbortError' })
  expect(model).toHaveBeenCalledExactlyOnceWith('draft_chapter')
  const [payload, signal] = request.mock.lastCall!
  expect(payload.modelId).toBe('writer')
  expect(signal).toBe(run.signal)
  expect(JSON.parse(payload.messages[1].content)).toEqual({ number: 7, title: 'A title', previous: ending, guidance: 'Follow the river' })
})
