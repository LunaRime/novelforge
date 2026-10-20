/**
 * Agent 计划步骤解析（纯函数）。
 *
 * 约定：助手用 Markdown 任务清单表达计划（`- [ ] 读大纲` / `- [x] 改第一章`）。
 * 这里只做**展示层**结构化，不改变消息原文，也不写库；因此旧会话、外部导入的
 * Markdown 任务清单都能被识别，不需要 schema 迁移。
 */

export type PlanStepStatus = 'done' | 'active' | 'pending'

export interface PlanStep {
  id: string
  title: string
  status: PlanStepStatus
}

export interface PlanExtraction {
  steps: PlanStep[]
  /** 去掉计划清单行之后的正文（保留其余 Markdown） */
  rest: string
}

const TASK_LINE = /^\s*[-*]\s*\[([ xX~>])\]\s+(.+?)\s*$/

export function extractPlanSteps(content: string, options?: { finalize?: boolean }): PlanExtraction {
  if (!content.includes('[')) return { steps: [], rest: content }

  const lines = content.split(/\r?\n/)
  const blocks: PlanStep[][] = []
  let current: PlanStep[] = []
  const kept: string[] = []
  let removed = false

  for (const line of lines) {
    const match = line.match(TASK_LINE)
    if (!match) {
      if (current.length > 0) {
        blocks.push(current)
        current = []
      }
      kept.push(line)
      continue
    }
    removed = true
    const marker = match[1]
    current.push({
      id: `step-${current.length + 1}`,
      title: match[2].replace(/\s+/g, ' ').trim(),
      status: marker === 'x' || marker === 'X' ? 'done' : marker === '~' || marker === '>' ? 'active' : 'pending',
    })
  }
  if (current.length > 0) blocks.push(current)

  if (!removed) return { steps: [], rest: content }

  // 模型常在工具调用前后重复输出计划清单（原始计划 + 更新后的计划）。
  // 展示层取**最后一个清单块**作为当前计划状态，避免同一计划出现两遍、进度分母翻倍。
  const lastMultiStep = [...blocks].reverse().find((block) => block.length >= 2)
  const chosen = lastMultiStep ?? blocks[blocks.length - 1] ?? []

  // 移除清单后可能留下连续空行；压成最多一个空行，避免消息里出现大段空白
  const rest = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const steps = chosen.map((step, index) => ({
    ...step,
    id: `step-${index + 1}`,
    // 模型有时只在正文里用内联 `[x]` 更新、没有重写清单行；本轮已结束且确有工具执行时，
    // 把仍为 pending/active 的步骤收敛为 done，避免出现「活干完了但计划显示 0/2」。
    status: options?.finalize && step.status !== 'done' ? 'done' as const : step.status,
  }))
  return { steps, rest }
}
