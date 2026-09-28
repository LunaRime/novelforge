import { describe, it, expect } from 'vitest'
import { pickCapacity, toCandidates } from './model-listing'

describe('pickCapacity —— 容量字段多拼写解析（对齐 dsh readListing）', () => {
  it('OpenAI 系拼写：context_length / max_tokens', () => {
    expect(pickCapacity({ context_length: 128000, max_tokens: 8192 }))
      .toEqual({ contextWindow: 128000, maxTokens: 8192 })
  })
  it('Anthropic 系拼写：max_input_tokens / max_output_tokens', () => {
    expect(pickCapacity({ max_input_tokens: 200000, max_output_tokens: 64000 }))
      .toEqual({ contextWindow: 200000, maxTokens: 64000 })
  })
  it('Gemini 系拼写：inputTokenLimit / outputTokenLimit；limit.context 嵌套形态', () => {
    expect(pickCapacity({ inputTokenLimit: 1048576, outputTokenLimit: 8192 }))
      .toEqual({ contextWindow: 1048576, maxTokens: 8192 })
    expect(pickCapacity({ limit: { context: 32000, output: 4096 } }))
      .toEqual({ contextWindow: 32000, maxTokens: 4096 })
  })
  it('无效值丢弃（0 / 负数 / NaN / 字符串不冒充数字）', () => {
    expect(pickCapacity({ context_length: 0, max_tokens: -5 })).toEqual({})
    expect(pickCapacity({ context_length: 'x', max_tokens: null })).toEqual({})
  })
})

describe('toCandidates —— 组装修整（无 id 跳过 / 按 id 去重 / 保持顺序）', () => {
  it('无 id 行跳过；重复 id 去重；顺序保持端点序', () => {
    const entries = [
      { id: 'b', context_length: 100 },
      { id: '' }, // 空 id 跳过
      { name: '无 id 字段' }, // 跳过
      { id: 'a', max_tokens: 10 },
      { id: 'b', context_length: 200 }, // 重复：保留首个
    ]
    const out = toCandidates(entries, (e) => (typeof e.id === 'string' ? e.id : undefined))
    expect(out).toEqual([
      { id: 'b', contextWindow: 100 },
      { id: 'a', maxTokens: 10 },
    ])
  })

  it('idOf 可做变换（Gemini 的 models/ 前缀剥离）', () => {
    const out = toCandidates(
      [{ name: 'models/gemini-2.5-pro', inputTokenLimit: 1048576 }],
      (e) => (typeof e.name === 'string' ? e.name.replace(/^models\//, '') : undefined),
    )
    expect(out).toEqual([{ id: 'gemini-2.5-pro', contextWindow: 1048576 }])
  })
})
