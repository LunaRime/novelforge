import { describe, it, expect } from 'vitest'
import { BUILTIN_PRESETS, presetModelDefaults } from './provider-presets'
import { PI_AI_MODEL_SPECS, PI_AI_PROVIDER_PRESETS } from './model-specs.generated'
import { LLM_PROTOCOLS } from './llm-protocols'

describe('pi-ai 目录移植（2026-09-28，MIT 数据）', () => {
  it('生成表覆盖现有家（deepseek 可查）', () => {
    const deepseek = PI_AI_MODEL_SPECS['deepseek']
    expect(deepseek).toBeTruthy()
    expect(Object.keys(deepseek).length).toBeGreaterThan(0)
  })

  it('presetModelDefaults 在 NF 字面量缺省时从生成表补全规格（字面量优先）', () => {
    const deepseek = PI_AI_MODEL_SPECS['deepseek']
    // 构造"NF 字面量未收录、生成表有规格"的模型来验证补全路径（不能用在两处都有的 id——
    // 那走的是字面量优先分支，另一条语义）
    const nfModels = new Set(
      (BUILTIN_PRESETS.find(p => p.provider === 'deepseek')?.models ?? []).map(m => m.name),
    )
    const entry = Object.entries(deepseek).find(([id, s]) => !nfModels.has(id) && s.maxTokens !== undefined)
    expect(entry, '生成表里应存在 NF 未收录的 deepseek 模型').toBeTruthy()
    const [id, spec] = entry!
    const out = presetModelDefaults('deepseek', id)
    expect(out.maxTokens).toBe(spec.maxTokens)
    if (spec.contextWindow !== undefined) expect(out.contextWindow).toBe(spec.contextWindow)
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
