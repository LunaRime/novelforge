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
  /** 按 targetRef（JSON：{type, params}）启动工作流，返回 runId */
  startWorkflow: (targetRef: string) => Promise<string>
  /** 发起 Agent 任务，返回 conversationId */
  startAgent: (task: AutomationTask, match: TriggerMatch) => Promise<string>
  isWorkflowAlive: (runId: string) => boolean
  isConversationAlive: (conversationId: string) => boolean
}

export function createExecutor(deps: ExecutorDeps): AutomationExecutor {
  return {
    async start(task, match) {
      if (task.targetType === 'workflow') {
        return { refId: await deps.startWorkflow(task.targetRef), kind: 'workflow' }
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

/** 生产实现：从真实 store 取依赖（测试用 createExecutor + mock deps） */
export function createProductionExecutor(): AutomationExecutor {
  return createExecutor({
    startWorkflow: async (targetRef) => {
      const parsed = JSON.parse(targetRef) as { type: string; params?: Record<string, unknown> }
      const definition = rehydrateWorkflow(
        parsed.type as Parameters<typeof rehydrateWorkflow>[0],
        (parsed.params ?? {}) as Parameters<typeof rehydrateWorkflow>[1],
      )
      if (!definition) throw new Error(`无法重建工作流定义：${parsed.type}`)
      // headless：自动触发不抢焦点
      return useWorkflowStore.getState().startWorkflow(definition, false, { headless: true })
    },
    startAgent: async (task, match) => {
      const store = useAgentStore.getState()
      // per_task：复用任务绑定的会话；per_run：每次新会话
      let conversationId = task.sessionStrategy === 'per_task' ? task.sessionId ?? null : null
      if (!conversationId) {
        conversationId = store.createConversation({ title: `[自动化] ${task.name}` }).id
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
