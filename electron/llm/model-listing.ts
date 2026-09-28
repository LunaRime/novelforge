import type { LLMModelCandidate } from '../../src/shared/ipc-channels'

/**
 * 拉取候选的解析工具（2026-09-28，对齐 deepseek-harness 的 readListing）：
 * 各家端点的容量字段拼写不一，统一从多拼写里取正值整数；无 id 行跳过；按 id 去重；保持端点顺序。
 */

/** 单条的容量字段多拼写解析；无效值（0/负数/NaN/非数字）一律丢弃 */
export function pickCapacity(entry: Record<string, unknown>): Pick<LLMModelCandidate, 'contextWindow' | 'maxTokens'> {
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
  const limit = entry.limit as { context?: unknown; output?: unknown } | undefined
  const contextWindow = num(
    entry.context_length ?? entry.context_window ?? entry.max_input_tokens ?? entry.inputTokenLimit ?? limit?.context,
  )
  const maxTokens = num(entry.max_tokens ?? entry.max_output_tokens ?? entry.outputTokenLimit ?? limit?.output)
  return {
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  }
}

/** 组装候选列表：无 id 跳过、按 id 去重（保留首个）、保持端点顺序 */
export function toCandidates(
  entries: Array<Record<string, unknown>>,
  idOf: (e: Record<string, unknown>) => string | undefined,
): LLMModelCandidate[] {
  const seen = new Set<string>()
  const out: LLMModelCandidate[] = []
  for (const e of entries) {
    const id = idOf(e)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, ...pickCapacity(e) })
  }
  return out
}
