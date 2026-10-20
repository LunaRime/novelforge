// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../services/ipc-client', () => ({
  ipc: { invoke: invokeMock, isElectron: true, on: vi.fn(() => vi.fn()) },
}))
vi.mock('../services/render-logger', () => ({ renderLog: vi.fn() }))

import { useLLMStore } from './llm-store'
import { useThinkingStore } from './thinking-store'

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue({ success: true, content: '', fullText: '' })
  useLLMStore.setState({
    defaultModelId: 'm1',
    models: [{ id: 'm1', name: 'M1', modelName: 'm1', provider: 'openai', protocol: 'openai', baseUrl: '', maxTokens: 4096, contextWindow: 128000, purposes: ['generation'] }] as never,
  })
  useThinkingStore.setState({ level: 'max' })
})

describe('llm-store 全局温度注入', () => {
  it('未显式传温度时使用全局档位', async () => {
    await useLLMStore.getState().generate([{ role: 'user', content: 'hi' }])
    const call = invokeMock.mock.calls.find(c => c[0] === 'llm:generate')
    expect((call?.[1] as { temperature?: number }).temperature).toBe(1.2)
  })

  it('显式温度优先', async () => {
    await useLLMStore.getState().generate([{ role: 'user', content: 'hi' }], undefined, { temperature: 0.2 })
    const call = invokeMock.mock.calls.find(c => c[0] === 'llm:generate')
    expect((call?.[1] as { temperature?: number }).temperature).toBe(0.2)
  })

  it('流式请求同样注入', async () => {
    await useLLMStore.getState().generateStream([{ role: 'user', content: 'hi' }], {}, 'm1')
    const call = invokeMock.mock.calls.find(c => c[0] === 'llm:generate-stream')
    expect((call?.[2] as { temperature?: number }).temperature).toBe(1.2)
  })

  // 回归：直接调用 llm-store 的 JSON 站点（spawn-reviewers / 多草稿评分 /
  // architecture-workflow / character-archive-workflow）不经过 callLLM，
  // 不能让 Max 档把它们拉到 1.2。
  it('JSON 模式在 Max 档下仍用低温 0.3', async () => {
    await useLLMStore.getState().generate([{ role: 'user', content: 'hi' }], undefined, {
      responseFormat: { type: 'json_object' },
    })
    const call = invokeMock.mock.calls.find(c => c[0] === 'llm:generate')
    expect((call?.[1] as { temperature?: number }).temperature).toBe(0.3)
  })

  it('流式 JSON 模式同样低温 0.3', async () => {
    await useLLMStore.getState().generateStream([{ role: 'user', content: 'hi' }], {}, 'm1', {
      responseFormat: { type: 'json_object' },
    })
    const call = invokeMock.mock.calls.find(c => c[0] === 'llm:generate-stream')
    expect((call?.[2] as { temperature?: number }).temperature).toBe(0.3)
  })

  it('显式温度优先于 JSON 兜底', async () => {
    await useLLMStore.getState().generate([{ role: 'user', content: 'hi' }], undefined, {
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
    })
    const call = invokeMock.mock.calls.find(c => c[0] === 'llm:generate')
    expect((call?.[1] as { temperature?: number }).temperature).toBe(0.2)
  })
})