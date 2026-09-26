/**
 * 子 agent 的 scoped 系统提示词装配（C 档第二轮）。
 *
 * 与父的差别（刻意）：只给**身份 + 任务 + L0 + 记忆两段 + 白名单工具**——
 * 不含技能目录（子任务不需要）、不含 M1 会话摘要（子 agent 没有父的对话上下文）、
 * 不含 L1 编辑器上下文（与子任务无关）、不含 RAG 自动检索（父轮次语义）。
 * 记忆两段复用父的 `collectMemoryLayers`（唯一真源，避免两处漂移）。
 */
import { t } from '../../../shared/locale'
import { toolRegistry } from '../tool-registry'
import { estimateTokens, truncateToTokenBudget } from '../token-budget'
import { buildL0ProjectContext, collectMemoryLayers } from '../context-builder'
import { SUBAGENT_PROMPT_BUDGET_TOKENS, type SubAgentTask } from './types'

/** 子 agent 身份（不是父的 buildIdentityPrompt，也不走 mode 六档——它的角色是执行者） */
function buildSubAgentIdentity(description: string): string {
  return `${t('subagent.identity')}\n\n${t('subagent.taskHeader').replace('{description}', description)}`
}

export async function buildSubAgentPrompt(task: SubAgentTask): Promise<string> {
  const layers = await collectMemoryLayers('') // userMessage='' → 不带 manual（@ 注入是父轮次语义）
  const tools = task.allowedTools
    .map(n => toolRegistry.get(n))
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
  const identity = buildSubAgentIdentity(task.description)
  const taskBlock = task.prompt.trim()
  const l0 = buildL0ProjectContext() ?? ''
  const toolPrompt = toolRegistry.generateToolPrompt(tools)

  // 降级顺序：常驻 → 目录 → 工具描述（身份与任务说明尽量保底）
  const candidates: string[][] = [
    [identity, taskBlock, l0, layers.resident, layers.catalog, toolPrompt],
    [identity, taskBlock, l0, layers.catalog, toolPrompt],
    [identity, taskBlock, l0, toolPrompt],
    [identity, taskBlock, l0],
  ]
  for (const parts of candidates) {
    const text = parts.filter(Boolean).join('\n\n---\n\n')
    if (estimateTokens(text) <= SUBAGENT_PROMPT_BUDGET_TOKENS) return text
  }
  // 兜底：连「身份 + 任务 + L0」都超预算（派发方给的任务说明本身很长）→
  // 先保身份，再按剩余预算切任务说明与 L0。**截断要留痕**（子 agent 必须知道指令被裁过，
  // 否则会照着半截指令干完还自以为完成）。
  const head = identity
  const remaining = SUBAGENT_PROMPT_BUDGET_TOKENS - estimateTokens(head)
  const taskText = truncateToTokenBudget(taskBlock, Math.max(0, Math.floor(remaining * 0.7)))
  const taskMarked = taskText.length < taskBlock.length ? `\n\n${t('subagent.taskTruncated')}` : ''
  const l0Text = extractBudget(l0, remaining - estimateTokens(taskText) - estimateTokens(taskMarked))
  const text = [head, `${taskText}${taskMarked}`, l0Text].filter(Boolean).join('\n\n---\n\n')
  // 分段 token 数不可加（分隔符与边界效应）→ 整体再兜一道硬截断
  return estimateTokens(text) <= SUBAGENT_PROMPT_BUDGET_TOKENS
    ? text
    : truncateToTokenBudget(text, SUBAGENT_PROMPT_BUDGET_TOKENS)
}

function extractBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0 || !text) return ''
  return truncateToTokenBudget(text, maxTokens)
}
