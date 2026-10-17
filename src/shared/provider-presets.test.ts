import { describe, it, expect } from 'vitest'
import { BUILTIN_PRESETS, DEFAULT_CONTEXT_WINDOW_TOKENS, presetModelDefaults } from './provider-presets'
import { PI_AI_MODEL_SPECS, PI_AI_PROVIDER_PRESETS } from './model-specs.generated'
import { LLM_PROTOCOLS } from './llm-protocols'

describe('pi-ai 目录移植（2026-09-28，MIT 数据）', () => {
  it('生成表覆盖现有家（deepseek 可查）', () => {
    const deepseek = PI_AI_MODEL_SPECS['deepseek']
    expect(deepseek).toBeTruthy()
    expect(Object.keys(deepseek).length).toBeGreaterThan(0)
  })

  it('presetModelDefaults 在 NF 字面量缺省时从生成表补全规格（字面量优先）', () => {
    // 在任意 provider 的生成表里找「NF 字面量未收录」的模型来验证补全路径
    // （不能用在两处都有的 id——那走的是字面量优先分支，另一条语义）
    let found: { provider: string; id: string; spec: { contextWindow?: number; maxTokens?: number } } | undefined
    for (const [provider, models] of Object.entries(PI_AI_MODEL_SPECS)) {
      const nfModels = new Set(
        (BUILTIN_PRESETS.find(p => p.provider === provider)?.models ?? []).map(m => m.name),
      )
      const entry = Object.entries(models).find(([id, s]) => !nfModels.has(id) && s.maxTokens !== undefined)
      if (entry) {
        found = { provider, id: entry[0], spec: entry[1] }
        break
      }
    }
    expect(found, '生成表里应存在 NF 未收录的模型规格项').toBeTruthy()
    const { provider, id, spec } = found!
    const out = presetModelDefaults(provider, id)
    expect(out.maxTokens).toBe(spec.maxTokens)
    if (spec.contextWindow !== undefined) expect(out.contextWindow).toBe(spec.contextWindow)
  })

  // 2026-10-17 内置模型刷新：DeepSeek 手写目录对齐 DSH 官方目录（llm-deepseek/src/models.ts）
  it('DeepSeek 内置目录含官方 V4.1 模型，且窗口按真实 1M（不被 maxTokens 兜底成 131k）', () => {
    const preset = BUILTIN_PRESETS.find(p => p.provider === 'deepseek')!
    const names = preset.models.map(m => m.name)
    expect(names).toContain('deepseek-flash') // DSH 默认模型（V4.1-Flash）
    expect(names).toContain('deepseek-v4-pro')
    for (const name of ['deepseek-flash', 'deepseek-v4-pro']) {
      const defaults = presetModelDefaults('deepseek', name)
      expect(defaults.contextWindow, name).toBe(1_000_000)
      // NF 全局输出上限（MAX_TOKENS_CAP）——窗口与输出拆字段后两者不再相等
      expect(defaults.maxTokens, name).toBe(131_072)
    }
  })

  it('新增供应商已并入 BUILTIN_PRESETS（含 MiniMax 等 ≥8 家，模型非空）', () => {
    expect(PI_AI_PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(8)
    const ids = new Set(BUILTIN_PRESETS.map(p => p.provider))
    for (const p of PI_AI_PROVIDER_PRESETS) {
      expect(ids.has(p.provider), `${p.provider} 未并入`).toBe(true)
      expect(p.models.length, `${p.provider} 模型为空`).toBeGreaterThan(0)
    }
  })

  it('全部内置预设的 protocol ∈ LLM_PROTOCOLS（单源不漂移）', () => {
    const valid = new Set(LLM_PROTOCOLS.map(p => p.id))
    for (const p of BUILTIN_PRESETS) {
      expect(valid.has(p.protocol), `${p.provider}: ${p.protocol}`).toBe(true)
    }
  })
})

// 2026-10-17 百万上下文时代：新增模型默认窗口 1M，不再回落 maxTokens（131k 输出上限）
describe('新增模型默认窗口（DEFAULT_CONTEXT_WINDOW_TOKENS）', () => {
  it('常量锁定 1,000,000', () => {
    expect(DEFAULT_CONTEXT_WINDOW_TOKENS).toBe(1_000_000)
  })

  it('未知 provider / 未知生成模型 → 窗口 1M；输出上限仍回落 131072（两者各管各的）', () => {
    const out = presetModelDefaults('no-such-provider', 'no-such-model')
    expect(out.purposes).toEqual(['generation'])
    expect(out.contextWindow).toBe(1_000_000)
    expect(out.maxTokens).toBe(131_072)
    expect(out.contextWindow).not.toBe(out.maxTokens) // 旧行为的回归标志：曾拿输出上限当窗口
  })

  it('未知 provider 下疑似向量模型仍按 maxTokens 回落（不给向量模型套 1M 窗口）', () => {
    const out = presetModelDefaults('no-such-provider', 'text-embedding-3-small')
    expect(out.purposes).toEqual(['embedding'])
    expect(out.contextWindow).toBe(out.maxTokens) // 向量模型保持旧行为
    expect(out.maxTokens).toBe(131_072)
  })

  it('优先级不回归：手写字面量 > pi-ai 生成表 > 1M 默认', () => {
    // ① 手写优先：deepseek-flash 的 maxTokens 手写为 131072，pi-ai 表里是 384000 → 取手写
    const literal = presetModelDefaults('deepseek', 'deepseek-flash')
    expect(literal.maxTokens).toBe(131_072)
    expect(literal.contextWindow).toBe(1_000_000)

    // ② 生成表补缺：找「NF 手写未收录、但 pi-ai 给了 contextWindow」的模型 → 取生成表值
    let found: { provider: string; id: string; contextWindow: number } | undefined
    for (const [provider, models] of Object.entries(PI_AI_MODEL_SPECS)) {
      const nfModels = new Set(
        (BUILTIN_PRESETS.find(p => p.provider === provider)?.models ?? []).map(m => m.name),
      )
      const entry = Object.entries(models)
        .find(([id, s]) => !nfModels.has(id) && s.contextWindow !== undefined)
      if (entry) { found = { provider, id: entry[0], contextWindow: entry[1].contextWindow! }; break }
    }
    expect(found, '生成表里应存在 NF 未收录但带窗口的规格项').toBeTruthy()
    expect(presetModelDefaults(found!.provider, found!.id).contextWindow).toBe(found!.contextWindow)
  })
})

