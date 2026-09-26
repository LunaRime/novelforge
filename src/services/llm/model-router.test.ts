import { describe, it, expect } from 'vitest'
import { ModelRouter, agentModeToTier } from './model-router'
import type { ModelProfile } from '../../shared/ipc-channels'

const models = [
  { id: 'e1', name: 'E', modelName: 'elite-model' },
  { id: 's1', name: 'S', modelName: 'std-model' },
  { id: 'b1', name: 'B', modelName: 'budget-model' },
] as unknown as ModelProfile[]

describe('route 可选 tier 覆盖（动态策略）', () => {
  const router = new ModelRouter({ elite: ['e1'], standard: ['s1'], budget: ['b1'] }, models)

  it('不传 override 时行为与现状一致（静态 purpose→tier）', () => {
    expect(router.route('draft_chapter')).toBe('e1')
    expect(router.route('summarize')).toBe('b1')
  })

  it('override 生效：summarize 也可被拉到 elite 层', () => {
    expect(router.route('summarize', 'elite')).toBe('e1')
  })

  it('override 的层为空时走既有 fallback 链（不返回意外值）', () => {
    const empty = new ModelRouter({ elite: [], standard: ['s1'], budget: ['b1'] }, models)
    expect(empty.route('draft_chapter', 'elite')).toBe('s1')
  })

  it('override 层与其 fallback 全空 → null（调用方回退默认模型）', () => {
    const bare = new ModelRouter({ elite: [], standard: [], budget: [] }, models)
    expect(bare.route('draft_chapter', 'elite')).toBeNull()
  })
})

describe('agentModeToTier 映射（零 LLM 成本：复用对话现成的投入档位）', () => {
  it('6 档映射到三层', () => {
    expect(agentModeToTier('quick')).toBe('budget')
    expect(agentModeToTier('swift')).toBe('budget')
    expect(agentModeToTier('balanced')).toBe('standard')
    expect(agentModeToTier('reflective')).toBe('standard')
    expect(agentModeToTier('deep')).toBe('elite')
    expect(agentModeToTier('max')).toBe('elite')
  })
})
