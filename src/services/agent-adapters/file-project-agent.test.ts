import { beforeEach, expect, test, vi } from 'vitest'
import { askFileProjectAgent } from './file-project-agent'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), generate: vi.fn() }))
vi.mock('../ipc-client', () => ({ ipc: { invoke: mocks.invoke } }))
vi.mock('../llm/request-stream-text', () => ({ requestStreamText: mocks.generate }))
vi.mock('../../stores/llm-store', () => ({ useLLMStore: { getState: () => ({ getModelForPurpose: () => 'model' }) } }))

beforeEach(() => { mocks.invoke.mockReset(); mocks.generate.mockReset() })

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
    .resolves.toMatchObject({ answer: expect.stringContaining('The answer from the manuscript') })
  expect(mocks.invoke.mock.calls).toEqual([
    ['project:file-editor-agent-list', 'candidate-session', 0, undefined],
    ['project:file-editor-agent-read', 'candidate-session', locator, 2, 10],
  ])
  expect(JSON.stringify(mocks.generate.mock.calls[2][0].messages)).toContain('verified manuscript')
})

test('an editable Agent uses the revision it actually read and only prepares a proposal', async () => {
  const locator = 'doc://chapter/ch_abcdef12'
  const tool = (name: string, args: object) => `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`
  const proposal = { id: 'proposal', locator, revision: 'read revision', original: 'old text', replacement: 'new text' }
  mocks.invoke.mockResolvedValueOnce({ locator, content: 'old text', nextOffset: null, totalChars: 8, revision: 'read revision' })
    .mockResolvedValueOnce(proposal)
  mocks.generate.mockResolvedValueOnce(tool('propose_edit', { file_path: locator, original: 'old text', replacement: 'wrong' }))
    .mockResolvedValueOnce(tool('read_file', { file_path: locator }))
    .mockResolvedValueOnce(tool('propose_edit', { file_path: locator, original: 'old text', replacement: 'new text', revision: 'invented' }))
    .mockResolvedValueOnce('Review the proposal')
  await expect(askFileProjectAgent('session', locator, 'Revise it', new AbortController().signal, true))
    .resolves.toMatchObject({ proposal })
  expect(mocks.invoke.mock.calls).toEqual([
    ['project:file-editor-agent-read', 'session', locator, 0, undefined],
    ['project:file-editor-agent-propose-edit', 'session', locator, 'read revision', 'old text', 'new text'],
  ])
})
