import { expect, test, vi } from 'vitest'
import { OpenAIProvider } from './openai-provider'
import { GeminiProvider } from './gemini-provider'
import { proxyFetch } from '../net/proxy-fetch'
import type { ResolvedModelProfile } from './provider.interface'
vi.mock('../net/proxy-fetch', () => ({ proxyFetch: vi.fn() }))
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
const model = { modelName: 'test', baseUrl: 'https://example.test', apiKey: 'fixture', maxTokens: 100 } as ResolvedModelProfile
test('OpenAI tool call following reasoning stays outside the thinking display block', async () => {
  const events = [{ choices: [{ delta: { reasoning_content: 'Plan tool' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"path":"a.md"}' } }] } }] },
    { choices: [{ finish_reason: 'tool_calls' }] }]
  vi.mocked(proxyFetch).mockResolvedValue(new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('')))
  const onChunk = vi.fn(), onDone = vi.fn(), onError = vi.fn()
  await new OpenAIProvider().generateStream(model, [], {
    temperature: 0, maxTokens: 100, signal: new AbortController().signal, onChunk, onDone, onError,
  })
  const tool = '<tool_call>{"name":"read_file","arguments":{"path":"a.md"}}</tool_call>'
  expect(onError).not.toHaveBeenCalled()
  expect(onChunk.mock.calls.map(([text]) => text).join('')).toBe('<think>Plan tool</think>' + tool)
  expect(onDone.mock.calls[0][0]).toBe(tool)
})
test.each(['openai', 'gemini'] as const)('%s nonstream keeps only final parts and rejects reasoning-only replies', async protocol => {
  const provider = protocol === 'openai' ? new OpenAIProvider() : new GeminiProvider()
  for (const hasFinal of [true, false]) {
    const data = protocol === 'openai' ? { choices: [{ message: { content: hasFinal ? 'Final 林晚.' : null, reasoning_content: 'Thinking 三幕' } }] }
      : { candidates: [{ content: { parts: [{ thought: true, text: 'Thinking 三幕' },
        ...(hasFinal ? [{ text: 'Final ' }, { text: '林晚.' }] : [])] } }] }
    vi.mocked(proxyFetch).mockResolvedValue(Response.json(data))
    const result = await provider.generate(model, [], { temperature: 0, maxTokens: 100 })
    expect(result.success).toBe(hasFinal)
    expect(result.content).toBe(hasFinal ? 'Final 林晚.' : '')
    if (!hasFinal) expect(result.error).toBeTruthy()
  }
})
test.each(['openai', 'gemini'] as const)('%s keeps reasoning visible but saves only final text', async protocol => {
  const chunks = protocol === 'openai'
    ? [{ choices: [{ delta: { reasoning_content: 'We need English. 三幕结构' } }] }, { choices: [{ delta: { content: 'Final outline about 林晚.' } }] }]
    : [{ candidates: [{ content: { parts: [{ thought: true, text: 'We need English. 三幕结构' }, { text: 'Final outline about 林晚.' }] } }] }]
  vi.mocked(proxyFetch).mockResolvedValue(new Response(chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('')))
  const onChunk = vi.fn(), onDone = vi.fn(), onError = vi.fn()
  await (protocol === 'openai' ? new OpenAIProvider() : new GeminiProvider()).generateStream(model, [], {
    temperature: 0, maxTokens: 100, signal: new AbortController().signal, onChunk, onDone, onError,
  })
  expect(onError).not.toHaveBeenCalled()
  expect(onDone.mock.calls[0][0]).toBe('Final outline about 林晚.')
  expect(onChunk.mock.calls.map(([text]) => text).join('')).toContain('<think>We need English. 三幕结构</think>')
})
test.each(['openai', 'gemini'] as const)('%s reasoning without final content fails rather than saving thoughts', async protocol => {
  const data = protocol === 'openai' ? { choices: [{ delta: { reasoning_content: 'Only thinking' } }] }
    : { candidates: [{ content: { parts: [{ thought: true, text: 'Only thinking' }] } }] }
  vi.mocked(proxyFetch).mockResolvedValue(new Response('data: ' + JSON.stringify(data) + '\n\n'))
  const onDone = vi.fn(), onError = vi.fn()
  await (protocol === 'openai' ? new OpenAIProvider() : new GeminiProvider()).generateStream(model, [], {
    temperature: 0, maxTokens: 100, signal: new AbortController().signal, onChunk: vi.fn(), onDone, onError,
  })
  expect(onDone).not.toHaveBeenCalled()
  expect(onError).toHaveBeenCalledOnce()
})
