import type { AgentMessage, AgentConversation } from '../../stores/agent-store'
import { estimateTokens } from './token-budget'

export interface CompressedBatch {
  batch: number
  original: AgentMessage[]
  summary: string
  compressedAt: number
  originalTokens: number
}

/**
 * CCR 压缩批次选择：从最旧消息累积进 batch，rest 保留最新消息直到预算。
 * 保证：非 system 消息顺序不变（batch 在前 rest 在后拼接 = 原序）；rest 至少 1 条；
 * system 消息永不进入 batch（预算耗尽未及遍历时从 batch 移回 rest 头部）。
 */
export function selectCompressionBatch(
  messages: AgentMessage[],
  budgetTokens: number,
): { batch: AgentMessage[]; rest: AgentMessage[] } {
  const rest: AgentMessage[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'system') {
      rest.unshift(m)
      continue
    }
    const t = estimateTokens(m.content)
    if (rest.length > 0 && used + t > budgetTokens) break
    rest.unshift(m)
    used += t
  }
  const batch = messages.slice(0, messages.length - rest.length)
  // system 永不进入 batch：预算耗尽提前 break 时，把 batch 中的 system 移回 rest 头部
  const sysFromBatch = batch.filter(m => m.role === 'system')
  if (sysFromBatch.length > 0) {
    rest.unshift(...sysFromBatch)
    return { batch: batch.filter(m => m.role !== 'system'), rest }
  }
  return { batch, rest }
}

/** 序列化为 JSON 字符串（UTF-8 写盘由调用方保证） */
export function serializeArchive(conv: AgentConversation): string {
  return JSON.stringify(conv, null, 2)
}

/** 解析 archive 文件；损坏 JSON 返回 null；缺字段降级默认 */
export function parseArchive(raw: string): AgentConversation | null {
  try {
    const data = JSON.parse(raw) as Partial<AgentConversation>
    if (!data || typeof data.id !== 'string' || typeof data.title !== 'string') return null
    return {
      ...data,
      messages: Array.isArray(data.messages) ? data.messages : [],
      compressed: Array.isArray(data.compressed) ? data.compressed : [],
    } as AgentConversation
  } catch {
    return null
  }
}
