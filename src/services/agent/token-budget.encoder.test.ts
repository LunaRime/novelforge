// C1：两段式估算的「阶段 2 精确编码」触发验证（encoder 已加载态）
// 独立文件：vi.mock gpt-tokenizer + initTokenEngine 会污染 token-budget 模块级 gptEncoder，
// vitest 文件级模块隔离保证不影响其他测试文件。
import { describe, it, expect, vi, beforeAll } from 'vitest'

// mock 编码器：encode 返回「非空白字符数」长度的数组（每字符 1 token 的简化精确器）——
// 与 CJK 启发式(×1.5) / latin 粗估(×1.4) 数值均可区分，便于断言阶段选择
vi.mock('gpt-tokenizer', () => ({
  encode: vi.fn(),
  decode: vi.fn(() => ''),
}))

import { estimateTokens, estimateTokensWithBudget, initTokenEngine } from './token-budget'
import { encode as mockEncode } from 'gpt-tokenizer'

const encodeSpy = vi.mocked(mockEncode)

function nonSpaceChars(s: string): number {
  let n = 0
  for (const ch of s) {
    if (!/\s/.test(ch)) n++
  }
  return n
}

beforeAll(async () => {
  encodeSpy.mockImplementation((s: string) => Array.from({ length: nonSpaceChars(s) }, () => 0))
  encodeSpy.mockClear()
  await initTokenEngine()
})

describe('两段式估算：阶段 2 精确编码触发（encoder 已加载）', () => {
  it('estimateTokens 在 encoder 加载后走精确编码（encode 结果）', () => {
    encodeSpy.mockClear()
    // 纯中文 100 字：精确编码器 = 100 tokens（启发式 ×1.5 会高估到 150）
    expect(estimateTokens('中'.repeat(100))).toBe(100)
    expect(encodeSpy).toHaveBeenCalledTimes(1)
  })

  it('粗估 ≤ maxTokens/4 → 粗估短路，encode 不被调用', () => {
    encodeSpy.mockClear()
    // 'a b c d e f g'：latin 粗估 16 ≤ gate(400/4=100) → 返回 16，不触发精确编码（精确=7）
    const result = estimateTokensWithBudget('a b c d e f g', 400)
    expect(result).toBe(16)
    expect(encodeSpy).not.toHaveBeenCalled()
  })

  it('粗估 > maxTokens/4 → 触发精确编码（返回 encode 结果）', () => {
    encodeSpy.mockClear()
    // 纯中文 100 字：粗估 150 > gate(400/4=100) → 精确编码 = 100
    const result = estimateTokensWithBudget('中'.repeat(100), 400)
    expect(result).toBe(100)
    expect(encodeSpy).toHaveBeenCalledTimes(1)
  })

  it('粗估 > maxTokens/4 且编码失败 → 回退启发式（与 estimateTokens 同路径）', () => {
    encodeSpy.mockClear()
    encodeSpy.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    // 纯中文 100 字 → 启发式 150
    expect(estimateTokensWithBudget('中'.repeat(100), 400)).toBe(150)
  })
})
