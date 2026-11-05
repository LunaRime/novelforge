import { afterEach, expect, test, vi } from 'vitest'
import { OpenAIProvider } from '../../../../electron/llm/openai-provider'
import type { LLMStreamOptions, ResolvedModelProfile } from '../../../../electron/llm/provider.interface'
import { proxyFetch } from '../../../../electron/net/proxy-fetch'
import { GeneratePlotArchitectureCommand } from './architecture.command'
import { getCurrentLocale, setCurrentLocale } from '../../../shared/locale'
import { ipc } from '../../ipc-client'
import type { CommandExecuteParams } from './base-command'
vi.mock('../../../../electron/net/proxy-fetch', () => ({ proxyFetch: vi.fn() }))
vi.mock('../../render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('../../ipc-client', () => ({ ipc: { invoke: vi.fn(async (channel: string) => channel === 'db:project-core-get'
  ? { premise: 'Premise', charactersArch: 'Characters', worldbuilding: 'World' } : { success: true }) } }))
vi.mock('../../../stores/project-store', () => ({ useProjectStore: { getState: () => ({ currentProject: {
  path: '/fixture', novelConfig: { totalChapters: 151, wordsPerChapter: 3000, genre: 'Fantasy', plotStructure: 'three_act', narrativePOV: 'third_limited' },
} }) } }))
vi.mock('../../../stores/llm-store', () => ({ useLLMStore: { getState: () => ({
  defaultModelId: 'm', models: [{ id: 'm' }], getModelForPurpose: () => 'm',
  generateStream: async (messages: Array<{ role: string; content: string }>, callbacks: Pick<LLMStreamOptions, 'onChunk' | 'onDone' | 'onError'>) => {
    await new OpenAIProvider().generateStream({ baseUrl: 'https://example.test', modelName: 'fixture', apiKey: 'fixture' } as ResolvedModelProfile,
      messages, { ...callbacks, temperature: 0, maxTokens: 100, signal: new AbortController().signal })
    return 'fixture'
  },
}) } }))
const original = getCurrentLocale()
afterEach(() => { setCurrentLocale(original); vi.clearAllMocks() })
test.each([true, false])('Plot Outline stream → command → DB separates thoughts (has final: %s)', async hasFinal => {
  setCurrentLocale('en-US')
  const events = [{ choices: [{ delta: { reasoning_content: 'We need English. 三幕结构' } }] },
    ...(hasFinal ? [{ choices: [{ delta: { content: 'An English outline featuring 林晚.' } }] }] : [])]
  vi.mocked(proxyFetch).mockResolvedValue(new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('')))
  const callbacks = { log: vi.fn(), appendText: vi.fn(), setProgress: vi.fn() }
  const pending = new GeneratePlotArchitectureCommand().execute({ context: { data: {}, cancelled: false }, callbacks } as unknown as CommandExecuteParams)
  if (hasFinal) {
    expect(await pending).toContain('<think>We need English. 三幕结构</think>')
    expect(ipc.invoke).toHaveBeenCalledWith('db:project-core-update', { synopsis: '# Plot Outline\n\nAn English outline featuring 林晚.' })
  } else {
    await expect(pending).rejects.toThrow()
    expect(vi.mocked(ipc.invoke).mock.calls.some(([channel]) => channel === 'db:project-core-update')).toBe(false)
  }
  expect(callbacks.appendText.mock.calls.map(([text]) => text).join('')).toContain('<think>We need English. 三幕结构</think>')
  const request = JSON.parse(String(vi.mocked(proxyFetch).mock.calls[0][1]?.body))
  expect(request.messages.map((message: { content: string }) => message.content).join('\n')).toContain('English')
  expect(request.messages.map((message: { content: string }) => message.content).join('\n')).not.toContain('严格按以下结构')
})
