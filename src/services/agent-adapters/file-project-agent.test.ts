import { expect, test, vi } from 'vitest'
import { askFileProjectAgent } from './file-project-agent'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), generate: vi.fn() }))
vi.mock('../ipc-client', () => ({ ipc: { invoke: mocks.invoke } }))
vi.mock('../llm/request-stream-text', () => ({ requestStreamText: mocks.generate }))
vi.mock('../../stores/llm-store', () => ({ useLLMStore: { getState: () => ({ getModelForPurpose: () => 'model' }) } }))

test('the candidate agent reads through its own chapter tools and has no write tool', async () => {
  const locator = 'doc://chapter/ch_abcdef12'
  mocks.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'project:file-editor-agent-list') return { chapters: [{ locator, title: 'Chapter', number: 1 }], nextOffset: null }
    if (channel === 'project:file-editor-agent-read') return { locator, content: 'verified manuscript', nextOffset: null, totalChars: 19 }
    throw new Error(`Unexpected IPC ${channel}`)
  })
  mocks.generate.mockResolvedValueOnce('<tool_call>{"name":"list_chapters","arguments":{}}</tool_call>')
    .mockResolvedValueOnce(`<tool_call>{"name":"read_file","arguments":{"file_path":"${locator}","offset":"2","limit":"10"}}</tool_call>`)
    .mockResolvedValueOnce('<tool_call>{"name":"write_file","arguments":{"file_path":"other"}}</tool_call>')
    .mockResolvedValueOnce('The answer from the manuscript')

  await expect(askFileProjectAgent('candidate-session', locator, 'What happens?', new AbortController().signal))
    .resolves.toContain('The answer from the manuscript')
  expect(mocks.invoke.mock.calls).toEqual([
    ['project:file-editor-agent-list', 'candidate-session', 0, undefined],
    ['project:file-editor-agent-read', 'candidate-session', locator, 2, 10],
  ])
  expect(JSON.stringify(mocks.generate.mock.calls[2][0].messages)).toContain('verified manuscript')
})
