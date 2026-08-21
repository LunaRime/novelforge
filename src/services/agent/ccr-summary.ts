import type { AgentMessage } from '../../stores/agent-store'
import { useLLMStore } from '../../stores/llm-store'
import { t } from '../../shared/locale'
import { ipc } from '../ipc-client'
import { calculateCost } from '../llm/prompt-cache'

/** 组装 CCR 摘要 prompt：第 N 次压缩输入 = 旧 rollingSummary + 新压缩批原文（迭代规则见设计 §4.2） */
export function buildCcrSummaryPrompt(oldSummary: string, batchText: string): string {
  const parts = [t('ccr.summaryPrompt')]
  if (oldSummary) {
    parts.push(`${t('ccr.oldSummaryLabel')}\n${oldSummary}`)
  }
  parts.push(`${t('ccr.batchLabel')}\n${batchText}`)
  return parts.join('\n\n')
}

/** 生成对话摘要（budget 路由 + purpose 'ccr_summary' 落库）；失败 throw 由调用方降级硬截断 */
export async function generateConversationSummary(opts: {
  oldSummary: string
  batch: AgentMessage[]
  modelId: string
}): Promise<string> {
  const batchText = opts.batch
    .map(m => `${m.role === 'user' ? t('ccr.roleUser') : t('ccr.roleAssistant')}: ${m.content}`)
    .join('\n\n')
  const prompt = buildCcrSummaryPrompt(opts.oldSummary, batchText)

  // ⚠️ P0 修复：压缩摘要必须走 budget 路由（summarize→budget，设计 §7/计划 Global
  //    Constraints）——此前直接传 opts.modelId（Agent 的 elite/standard 模型），
  //    摘要成本高且与路由策略冲突。getModelForPurpose 无配置时返回 null，
  //    回退 opts.modelId（调用方语义不变）。
  const mid = useLLMStore.getState().getModelForPurpose('summarize') ?? opts.modelId

  const startTime = Date.now()
  const response = await useLLMStore.getState().generate(
    [{ role: 'user', content: prompt }],
    mid,
    { temperature: 0.2, priority: 12 },
  )
  const duration = Date.now() - startTime
  const model = useLLMStore.getState().models.find(m => m.id === mid)
  const usage = response.usage

  if (!response.success) {
    // 失败落库 success:0（对照 agent-store.ts 失败分支惯例）
    try {
      await ipc.invoke('db:log-llm-call', {
        model_id: mid,
        model_name: model?.name ?? model?.modelName ?? '',
        purpose: 'ccr_summary',
        prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
        duration_ms: duration, success: 0,
        error_message: response.error ?? 'ccr summary failed',
      })
    } catch { /* 日志失败不影响主流程 */ }
    throw new Error(response.error ?? 'ccr summary failed')
  }

  // 落库 purpose 'ccr_summary'（区别于 agent 面板调用，P2 缓存命中/成本统计可区分）
  try {
    const cost = usage && model
      ? calculateCost(model, usage.promptTokens, usage.completionTokens, (usage.cachedTokens ?? 0) > 0).totalCost
      : 0
    await ipc.invoke('db:log-llm-call', {
      model_id: mid,
      model_name: model?.name ?? model?.modelName ?? '',
      purpose: 'ccr_summary',
      prompt_tokens: usage?.promptTokens ?? 0,
      completion_tokens: usage?.completionTokens ?? 0,
      total_tokens: usage?.totalTokens ?? 0,
      duration_ms: duration,
      success: 1,
      error_message: '',
      cost,
    })
  } catch {
    // 日志失败不影响压缩主流程
  }

  return response.content
}
