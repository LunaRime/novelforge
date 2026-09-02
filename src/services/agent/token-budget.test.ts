// C1：两段式 token 估算——粗估（内容类型系数表）→ 预算闸门 → 精确编码
// 本文件覆盖无 encoder 环境（gptEncoder 未加载 = 默认测试态）：
// 阶段 2 精确编码路径的触发见 token-budget.encoder.test.ts（vi.mock gpt-tokenizer + initTokenEngine）
import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  estimateTokensHeuristic,
  estimateTokensWithBudget,
  roughEstimateTokens,
} from './token-budget'

describe('roughEstimateTokens（阶段 1 粗估：内容类型系数表）', () => {
  it('空文本 → 0 / mixed', () => {
    expect(roughEstimateTokens('')).toEqual({ kind: 'mixed', tokens: 0 })
  })

  it('CJK 为主 → kind=cjk，tokens 与 CJK 启发式同值（纯中文无窗格差）', () => {
    // 100 个中文字符：cjk×1.5 = 150；与 estimateTokensHeuristic 完全一致
    const text = '中'.repeat(100)
    const rough = roughEstimateTokens(text)
    expect(rough.kind).toBe('cjk')
    expect(rough.tokens).toBe(150)
    expect(rough.tokens).toBe(estimateTokensHeuristic(text))
  })

  it('拉丁词为主 → kind=latin（词 ×1.4 + 非词字符 ×1，保守偏大）', () => {
    // 'hello world foo bar baz'：5 词 wordChars=19 len=23 → ceil(5×1.4)=7 + (23-19)=4 → 11
    const text = 'hello world foo bar baz'
    const rough = roughEstimateTokens(text)
    expect(rough.kind).toBe('latin')
    expect(rough.tokens).toBe(11)
  })

  it('CJK 与拉丁词都不主导（各占一部分）→ kind=mixed（全字符 ×1.25）', () => {
    // '中文 测试 abc def'：cjk=4/13≈0.31 <0.35；wordChars=6/13≈0.46 <0.5 → mixed
    const text = '中文 测试 abc def'
    const rough = roughEstimateTokens(text)
    expect(rough.kind).toBe('mixed')
    expect(rough.tokens).toBe(Math.ceil(13 * 1.25)) // = 17
  })

  it('CJK 占比优先判定（阈值 0.35），拉丁词密度次之（阈值 0.5）', () => {
    const text = '中文测试abc' // cjk=4/9≈0.44 → cjk；wordChars=3 → 0.33
    expect(roughEstimateTokens(text).kind).toBe('cjk')
    const latinText = 'abc def ghi' // cjk=0；wordChars=9/11≈0.82 → latin
    expect(roughEstimateTokens(latinText).kind).toBe('latin')
  })

  it('CJK 占比优先判定（阈值 0.35），拉丁词密度次之（阈值 0.5）', () => {
    const text = '中文测试abc' // cjk=4/9≈0.44 → cjk；wordChars=3 → 0.33
    expect(roughEstimateTokens(text).kind).toBe('cjk')
    const latinText = 'abc def ghi' // cjk=0；wordChars=9/11≈0.82 → latin
    expect(roughEstimateTokens(latinText).kind).toBe('latin')
  })

  it('tokens 永不为 0（非空文本下限 1）', () => {
    // 纯空格：无 cjk 无词 → mixed = ceil(len×1.25) ≥ 1
    expect(roughEstimateTokens('   ').tokens).toBeGreaterThanOrEqual(1)
  })
})

describe('estimateTokensWithBudget（两段式：粗估 ≤ maxTokens/4 短路，否则启发式）', () => {
  // 无 encoder 环境：阶段 2 回退 estimateTokensHeuristic（既有启发式，行为兼容）
  it('粗估 ≤ maxTokens/4 → 直接返回粗估值（不跑全量启发式）', () => {
    const latinText = 'a b c d e f g' // rough(latin) = ceil(7×1.4)=10 + (13-7)=6 → 16；heuristic = ceil(7×1.2)=9
    const maxTokens = 400 // gate = 100 ≥ 16 → 粗估段短路
    expect(estimateTokensWithBudget(latinText, maxTokens)).toBe(16)
    expect(roughEstimateTokens(latinText).tokens).toBeLessThanOrEqual(Math.floor(maxTokens / 4))
  })

  it('粗估 > maxTokens/4 → 走阶段 2（无 encoder 回退启发式，值 ≠ 粗估可区分）', () => {
    const latinText = 'a b c d e f g'
    const maxTokens = 40 // gate = 10 < 16 → 阶段 2 → heuristic 9
    expect(estimateTokensWithBudget(latinText, maxTokens)).toBe(9)
    expect(estimateTokensHeuristic(latinText)).toBe(9)
  })

  it('边界：粗估 == maxTokens/4 → 短路（≤ 阈值）', () => {
    // 纯中文 100 字 → rough = heuristic = 150；gate = 150 → 短路返回 150
    const cjk = '中'.repeat(100)
    expect(estimateTokensWithBudget(cjk, 600)).toBe(150)
  })

  it('maxTokens < 4（gate=0）→ 直接阶段 2', () => {
    const cjk = '中'.repeat(100)
    expect(estimateTokensWithBudget(cjk, 2)).toBe(estimateTokensHeuristic(cjk))
  })

  it('空文本 → 0（不触发 gate）', () => {
    expect(estimateTokensWithBudget('', 1000)).toBe(0)
  })

  it('纯中文时与既有 estimateTokens 一致（行为兼容锚点）', () => {
    const cjk = '中'.repeat(100)
    expect(estimateTokensWithBudget(cjk, 10_000)).toBe(estimateTokens(cjk))
  })
})
