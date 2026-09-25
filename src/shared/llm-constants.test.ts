import { describe, it, expect } from 'vitest'
import { MAX_TOKENS_CAP, clampMaxTokens, normalizeModelProfile } from './llm-constants'
import type { ModelProfile } from './ipc-channels'

/** 磁盘 / IPC 形态的模型配置（旧配置缺 contextWindow） */
type StoredModelProfile = Omit<ModelProfile, 'contextWindow'> & { contextWindow?: number }

/** 造一个最小可用的模型配置；用例只覆盖 token 两个字段，故入参收窄到它们 */
function mk(over: Partial<Pick<ModelProfile, 'maxTokens' | 'contextWindow'>> = {}): StoredModelProfile {
  return {
    id: 'm1',
    name: 'M',
    provider: 'openai',
    protocol: 'openai',
    modelName: 'gpt-4o',
    apiKey: '',
    baseUrl: 'https://api.openai.com',
    temperature: 0.7,
    maxTokens: 4096,
    purposes: [],
    ...over,
  }
}

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

/**
 * normalizeModelProfile — 2026-09-25 拆出 contextWindow 时的迁移归一化。
 *
 * 背景：此前 `ModelProfile` 没有「上下文窗口」字段，同一个 `maxTokens` 被当成两种语义用
 * （上下文占用条分母 / 压缩预算当**窗口**，两个 provider 当 `max_tokens` 发出去）。
 * 拆开后旧配置缺新字段，兜底取 **`maxTokens`** —— 因为今天那两个消费点读的就是它，
 * **取到的值一模一样 ⇒ 零行为变化**。这是「忠实搬运」，**不代表它是真实窗口**。
 */
describe('normalizeModelProfile', () => {
  it('旧配置缺 contextWindow → 回落 maxTokens', () => {
    expect(normalizeModelProfile(mk({ maxTokens: 65536 })).contextWindow).toBe(65536)
  })

  it('已带 contextWindow → 原值保留，不被 maxTokens 覆盖', () => {
    expect(normalizeModelProfile(mk({ maxTokens: 65536, contextWindow: 200000 })).contextWindow).toBe(200000)
  })

  it('两者相互独立：maxTokens 与 contextWindow 可各是各的', () => {
    const out = normalizeModelProfile(mk({ maxTokens: 4096, contextWindow: 200000 }))
    expect(out.maxTokens).toBe(4096)
    expect(out.contextWindow).toBe(200000)
  })

  it('maxTokens 本身不被改写（输出路径 / 发给 API 的值不受影响）', () => {
    expect(normalizeModelProfile(mk({ maxTokens: 8192 })).maxTokens).toBe(8192)
  })

  it('maxTokens 也缺失/非法 → 回落 MAX_TOKENS_CAP（与旧消费点的 `?? 131072` 等价）', () => {
    expect(normalizeModelProfile(mk({ maxTokens: NaN })).contextWindow).toBe(MAX_TOKENS_CAP)
    expect(normalizeModelProfile(mk({ maxTokens: 0 })).contextWindow).toBe(MAX_TOKENS_CAP)
    expect(normalizeModelProfile(mk({ maxTokens: -1 })).contextWindow).toBe(MAX_TOKENS_CAP)
  })

  it('不改动其它字段，也不 mutate 入参', () => {
    const input = mk({ maxTokens: 4096 })
    const out = normalizeModelProfile(input)
    expect(out.name).toBe('M')
    expect(out.modelName).toBe('gpt-4o')
    expect(input).not.toHaveProperty('contextWindow')
  })
})
