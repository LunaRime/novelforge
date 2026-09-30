// @vitest-environment jsdom
/**
 * 引用检查（T9 从**已删**的 `ProviderAccountsSection` 迁到 `model-references.ts`）—— 行为**零变化**，
 * 迁移后必须仍能拦住「删掉还被引用的模型」：默认模型 / 默认向量模型 / LLM 向量化 / 三层路由 / 会话。
 *
 * 三个 store 在本用例里直接打桩（判据是「谁在引用」的汇集，不是 store 本身）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  llm: {
    defaultModelId: null as string | null,
    defaultEmbeddingModelId: null as string | null,
    modelRoutes: { elite: [] as string[], standard: [] as string[], budget: [] as string[], strategy: 'static' },
  },
  agent: { conversations: [] as Array<{ id: string; title?: string | null; modelId?: string | null }> },
  vector: { llmEmbeddingSettings: { modelId: null as string | null } },
}))

vi.mock('../../stores/llm-store', () => ({ useLLMStore: { getState: () => h.llm } }))
vi.mock('../../stores/agent-store', () => ({ useAgentStore: { getState: () => h.agent } }))
vi.mock('../../stores/vector-config-store', () => ({ useVectorConfigStore: { getState: () => h.vector } }))

import { blockingReferences } from './model-references'

beforeEach(() => {
  h.llm.defaultModelId = null
  h.llm.defaultEmbeddingModelId = null
  h.llm.modelRoutes = { elite: [], standard: [], budget: [], strategy: 'static' }
  h.agent.conversations = []
  h.vector.llmEmbeddingSettings.modelId = null
})

describe('blockingReferences', () => {
  it('无引用 → null（放行删除）', () => {
    expect(blockingReferences(['m1'])).toBeNull()
  })

  it('默认生成模型 / 默认向量模型 / LLM 向量化配置 → 逐个报出可读位置', () => {
    h.llm.defaultModelId = 'm1'
    h.llm.defaultEmbeddingModelId = 'm2'
    h.vector.llmEmbeddingSettings.modelId = 'm3'
    expect(blockingReferences(['m1'])).toBe('默认生成模型')
    expect(blockingReferences(['m2'])).toBe('默认向量模型')
    expect(blockingReferences(['m3'])).toBe('LLM 向量化配置')
  })

  it('三层路由与会话命中 → 位置点名到层/会话标题；多命中一次列全', () => {
    h.llm.modelRoutes = { elite: ['m1'], standard: ['m1'], budget: [], strategy: 'static' }
    h.agent.conversations = [{ id: 'c1', title: '第一章', modelId: 'm1' }]
    expect(blockingReferences(['m1'])).toBe('三层路由 · elite、三层路由 · standard、会话 · 第一章')
  })
})
