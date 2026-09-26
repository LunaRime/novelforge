import { estimateTokens } from './token-budget'
import type { LLMMessage } from './agent-engine' // LLMMessage 定义于 agent-engine.ts:71

export interface ContextUsage {
  base: number
  memory: number
  history: number
  current: number
  modelMax: number
  total: number
  /** B 档第二轮 B6：逐段明细（每段带来源与字节数） */
  segments?: ContextSegment[]
  /** 面板展示用的历史估算值（= 当前 messages 全量） */
  historyPanelTokens?: number
  /** **实发**的历史 token（发送前裁剪后的真实值；与面板值不同时两者都给出） */
  historySentTokens?: number
  /** B 档第二轮 B4：前缀记账（system 段是否变化 + 与上轮的共享字符数） */
  prefix?: { changed: boolean; sharedChars: number }
}

/**
 * 上下文分段明细（B 档第二轮 B6）。
 * `key` 供 UI 映射 i18n 标签；`source` 描述该段的来源（如具体的 memory 文件、预取路径）。
 */
export interface ContextSegment {
  key: string
  tokens: number
  /** 字符数（与 token 并列展示 —— "来源与字节"是明细面板的核心诉求） */
  chars: number
  source?: string
  /** 该段发生过截断（预算裁剪） */
  truncated?: boolean
  /** C 档第一轮：需在明细面板告警的原因（常驻接近上限 / 超上限未注入） */
  warning?: string
}

/** 预算条分段计算：基础段（身份+L0+L1+Tool）+ 记忆段（M1）+ 历史 + 当前，无双计 */
export function computeContextUsage(opts: {
  base: string
  memory: string
  historyMessages: LLMMessage[]
  currentContent: string
  modelMax: number
  /** B6：逐段明细（由 buildAgentSystemSegments 产出） */
  segments?: ContextSegment[]
  /** B6：实发历史 token（发送前裁剪后的真实值）；不传则面板值与实发值视为一致 */
  historySentTokens?: number
  /** B4：前缀记账 */
  prefix?: { changed: boolean; sharedChars: number }
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
    segments: opts.segments,
    // 面板值 = 当前 messages 全量；实发值由调用方在发送处回填
    historyPanelTokens: history,
    historySentTokens: opts.historySentTokens,
    prefix: opts.prefix,
  }
}
