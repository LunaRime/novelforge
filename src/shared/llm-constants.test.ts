import { describe, it, expect } from 'vitest'
import { MAX_TOKENS_CAP, clampMaxTokens } from './llm-constants'

/**
 * maxTokens 运行时钳制 — 背景：设置页 ModelForm 已钳制 [1, 131072]（保存路径），
 * 但旧配置/直改 models.json 的模型仍可超限 → 请求 max_tokens 超模型上限 → API 400
 * （"This endpoint's max tokens is..."）。此处主进程 llm-controller 收口运行时钳制。
 */
describe('clampMaxTokens', () => {
  it('正常值原样返回', () => {
    expect(clampMaxTokens(1000, 4096)).toBe(1000)
    expect(clampMaxTokens(MAX_TOKENS_CAP, 4096)).toBe(MAX_TOKENS_CAP)
  })

  it('超上限钳制到 MAX_TOKENS_CAP', () => {
    expect(clampMaxTokens(9999999, 4096)).toBe(MAX_TOKENS_CAP)
    expect(clampMaxTokens(MAX_TOKENS_CAP + 1, 4096)).toBe(MAX_TOKENS_CAP)
  })

  it('负值/零/小数钳制到下限 1', () => {
    expect(clampMaxTokens(0, 4096)).toBe(1)
    expect(clampMaxTokens(-5, 4096)).toBe(1)
    expect(clampMaxTokens(0.5, 4096)).toBe(1)
  })

  it('undefined 时回退 fallback（且 fallback 也钳制）', () => {
    expect(clampMaxTokens(undefined, 4096)).toBe(4096)
    expect(clampMaxTokens(undefined, 9999999)).toBe(MAX_TOKENS_CAP)
    expect(clampMaxTokens(undefined, -3)).toBe(1)
  })

  it('非有限值回退 fallback', () => {
    expect(clampMaxTokens(NaN, 4096)).toBe(4096)
    expect(clampMaxTokens(Infinity, 4096)).toBe(4096)
  })
})
