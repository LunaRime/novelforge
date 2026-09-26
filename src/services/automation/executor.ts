/**
 * 执行层 —— 自动化触发后「实际跑什么」（D 档）
 *
 * 两个目标（用户决策 D1：两者都要）：
 * - `workflow`：按 `targetRef` 的 JSON（`{ type, params }`）经 registry 重建定义，headless 启动
 * - `agent`：起一轮 Agent 会话（per_run 新会话 / per_task 复用 automations.session_id）
 *
 * 依赖全部注入（`ExecutorDeps`）——执行宿主将来搬主进程时只换 `createProductionExecutor`，
 * 调用方（调度器 / 收件箱 store）零改动。设计依据：spec §6。
 */
import { useWorkflowStore } from '../../stores/workflow-store'
import { useAgentStore } from '../../stores/agent-store'
import { rehydrateWorkflow } from '../workflows/workflow-registry'
import type { AutomationTask, TriggerMatch } from './types'

export interface ExecutionHandle {
  /** workflow → runId；agent → conversationId */
  refId: string
  kind: 'workflow' | 'agent'
}

export interface AutomationExecutor {
  /** 启动执行（不等待完成）；返回可追踪引用 */
  start(task: AutomationTask, match: TriggerMatch): Promise<ExecutionHandle>
  /** 查询执行是否仍存活（应用重启后的恢复判定用） */
  isAlive(handle: ExecutionHandle): Promise<boolean>
}

export interface ExecutorDeps {
  /** 按 targetRef（JSON：{type, params}）启动工作流；match 用于参数占位符替换；返回 runId */
  startWorkflow: (targetRef: string, match: TriggerMatch) => Promise<string>
  /** 发起 Agent 任务，返回 conversationId */
  startAgent: (task: AutomationTask, match: TriggerMatch) => Promise<string>
  isWorkflowAlive: (runId: string) => boolean
  isConversationAlive: (conversationId: string) => boolean
}

export function createExecutor(deps: ExecutorDeps): AutomationExecutor {
  return {
    async start(task, match) {
      if (task.targetType === 'workflow') {
        return { refId: await deps.startWorkflow(task.targetRef, match), kind: 'workflow' }
      }
      return { refId: await deps.startAgent(task, match), kind: 'agent' }
    },
    async isAlive(handle) {
      return handle.kind === 'workflow'
        ? deps.isWorkflowAlive(handle.refId)
        : deps.isConversationAlive(handle.refId)
    },
  }
}

/**
 * 组装注入给 Agent 的用户消息：任务提示词 + 触发来源 + 证据摘要。
 * 证据只带前 10 条（避免把收件箱卡片的完整证据链灌进上下文）。
 */
export function buildAutomationUserMessage(task: AutomationTask, match: TriggerMatch): string {
  const lines = [
    `[自动化任务] ${task.name}`,
    '',
    task.targetRef,
    '',
    `触发来源：${match.title}`,
    match.summary,
  ]
  if (match.evidence.length > 0) {
    lines.push('', '相关证据：')
    for (const ev of match.evidence.slice(0, 10)) {
      lines.push(`- ${ev.title}${ev.ref ? ` (${ev.ref})` : ''}`)
    }
  }
  return lines.join('\n')
}

/**
 * 可作为自动化目标的工作流白名单（D 档 Critical 1）。
 *
 * 刻意排除 `post_process` 的各注册项：它们是**主流程内部调用的子流**
 * （注册时带 `match` 谓词，如 `__subflow === 'arch_extract'`），空 params 必然重建失败，
 * 作为独立目标没有意义。新增可选目标时在此登记并给出参数示例。
 */
export const AUTOMATION_WORKFLOW_TARGETS = [
  // example 即完整的 targetRef 字面量（可被 rehydrateWorkflow 成功重建）
  { type: 'chapter_creation', example: '{"type":"chapter_creation","params":{"workflow":"draft","chapterNumber":1}}' },
  { type: 'architecture_generation', example: '{"type":"architecture_generation","params":{}}' },
  { type: 'directory', example: '{"type":"directory","params":{"mode":"full"}}' },
] as const

/**
 * 把本次触发命中的章节信息注入工作流参数（D 档 Critical 1）。
 * 约定占位符（字符串值**精确匹配**才替换，避免误伤普通文本）：
 * - `$chapters` → 命中章节号数组；`$chapterFrom` / `$chapterTo` → 起止章号
 */
export function withMatchParams(
  params: Record<string, unknown>,
  match: TriggerMatch,
): Record<string, unknown> {
  const numbers = match.evidence
    .filter(ev => ev.source === 'chapter' && ev.ref)
    .map(ev => Number(ev.ref))
    .filter(n => Number.isFinite(n))

  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (value === '$chapters') return numbers
      if (value === '$chapterFrom') return numbers[0]
      if (value === '$chapterTo') return numbers[numbers.length - 1]
      return value
    }
    if (Array.isArray(value)) return value.map(replace)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]))
    }
    return value
  }

  return replace(params) as Record<string, unknown>
}

/** 生产实现：从真实 store 取依赖（测试用 createExecutor + mock deps） */
export function createProductionExecutor(): AutomationExecutor {
  return createExecutor({
    startWorkflow: (targetRef, match) => new Promise<string>((resolve, reject) => {
      let parsed: { type: string; params?: Record<string, unknown> }
      try {
        parsed = JSON.parse(targetRef) as { type: string; params?: Record<string, unknown> }
      } catch {
        reject(new Error(`工作流目标不是合法 JSON：${targetRef}`))
        return
      }
      const definition = rehydrateWorkflow(
        parsed.type as Parameters<typeof rehydrateWorkflow>[0],
        withMatchParams(parsed.params ?? {}, match) as Parameters<typeof rehydrateWorkflow>[1],
      )
      if (!definition) {
        reject(new Error(`无法重建工作流定义：${parsed.type}（该类型可能不是可独立触发的目标）`))
        return
      }
      // ⚠️ 不等待 run 结束（Critical 2）：startWorkflow 要等整个 run 完成才 return，
      // 自动化侧靠 onStarted 在**启动瞬间**拿到 runId；完成/失败由事件回写 run 记录
      let settled = false
      void useWorkflowStore.getState()
        .startWorkflow(definition, false, {
          headless: true,
          onStarted: (runId) => { settled = true; resolve(runId) },
        })
        .catch((e) => { if (!settled) reject(e instanceof Error ? e : new Error(String(e))) })
    }),
    startAgent: async (task, match) => {
      const store = useAgentStore.getState()
      // per_task：复用任务绑定的会话；per_run：每次新会话
      let conversationId = task.sessionStrategy === 'per_task' ? task.sessionId ?? null : null
      if (!conversationId) {
        conversationId = store.createConversation({ title: `[自动化] ${task.name}` }).id
        // per_task：把新会话写回任务定义供下次复用（评审 Important 6：否则每次都新建，旧会话成孤儿）
        if (task.sessionStrategy === 'per_task') {
          const { ipc } = await import('../ipc-client')
          await ipc.invoke('db:automation-save', {
            ...task, sessionId: conversationId, updatedAt: Date.now(),
          })
        }
      }
      await useAgentStore.getState().sendMessage(buildAutomationUserMessage(task, match))
      return conversationId
    },
    isWorkflowAlive: (runId) =>
      useWorkflowStore.getState().activeRuns.some(r => r.id === runId),
    isConversationAlive: (conversationId) =>
      useAgentStore.getState().conversations.some(c => c.id === conversationId),
  })
}
