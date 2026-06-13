/**
 * Vela API 用量与费用追踪 Store
 *
 * 实时累计会话费用、按模型/tier 分类统计。
 */

import { create } from 'zustand'
import { calculateCost } from '../services/llm/prompt-cache'
import type { ModelProfile } from '../shared/ipc-channels'

interface UsageState {
  /** 本次会话总费用 */
  sessionCost: number
  /** 按 tier 分类费用 */
  costByTier: { elite: number; standard: number; budget: number }
  /** 总 token */
  totalPromptTokens: number
  totalCompletionTokens: number
  /** 调用次数 */
  totalCalls: number
  /** 缓存命中次数 */
  cacheHits: number

  /** 记录一次调用 */
  recordCall: (params: {
    model: ModelProfile
    promptTokens: number
    completionTokens: number
    tier?: 'elite' | 'standard' | 'budget'
    cacheHit?: boolean
  }) => void
  /** 重置会话统计 */
  resetSession: () => void
  /** 获取格式化费用 */
  getFormattedCost: () => string
}

export const useUsageStore = create<UsageState>()((set, get) => ({
  sessionCost: 0,
  costByTier: { elite: 0, standard: 0, budget: 0 },
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalCalls: 0,
  cacheHits: 0,

  recordCall: ({ model, promptTokens, completionTokens, tier, cacheHit }) => {
    const cost = calculateCost(model, promptTokens, completionTokens, cacheHit)
    set(s => ({
      sessionCost: Math.round((s.sessionCost + cost.totalCost) * 10000) / 10000,
      costByTier: tier
        ? { ...s.costByTier, [tier]: Math.round((s.costByTier[tier] + cost.totalCost) * 10000) / 10000 }
        : s.costByTier,
      totalPromptTokens: s.totalPromptTokens + promptTokens,
      totalCompletionTokens: s.totalCompletionTokens + completionTokens,
      totalCalls: s.totalCalls + 1,
      cacheHits: s.cacheHits + (cacheHit ? 1 : 0),
    }))
  },

  resetSession: () => set({
    sessionCost: 0,
    costByTier: { elite: 0, standard: 0, budget: 0 },
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCalls: 0,
    cacheHits: 0,
  }),

  getFormattedCost: () => {
    const s = get()
    if (s.sessionCost < 0.01) return '$0.00'
    if (s.sessionCost < 1) return `$${s.sessionCost.toFixed(2)}`
    return `$${s.sessionCost.toFixed(2)}`
  },
}))
