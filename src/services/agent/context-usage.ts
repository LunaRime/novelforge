import { estimateTokens } from './token-budget'
import type { LLMMessage } from './agent-engine' // LLMMessage 定义于 agent-engine.ts:71

export interface ContextUsage {
  base: number
  memory: number
  history: number
  current: number
  modelMax: number
  total: number
}

/** 预算条分段计算：基础段（身份+L0+L1+Tool）+ 记忆段（M1）+ 历史 + 当前，无双计 */
export function computeContextUsage(opts: {
  base: string
  memory: string
  historyMessages: LLMMessage[]
  currentContent: string
  modelMax: number
}): ContextUsage {
  const base = estimateTokens(opts.base)
  const memory = estimateTokens(opts.memory)
  const history = opts.historyMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  const current = estimateTokens(opts.currentContent)
  return {
    base,
    memory,
    history,
    current,
    modelMax: opts.modelMax,
    total: base + memory + history + current,
  }
}
