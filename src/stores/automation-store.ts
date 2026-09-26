/**
 * automation-store — 写作自动化的渲染层状态（D 档 T7）
 *
 * 职责：任务 CRUD、收件箱三态流转、调度器生命周期。
 * 调度器的依赖在此组装（IPC + executor）；执行层本身对宿主无感知（spec §6.1）。
 */
import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import { renderLog } from '../services/render-logger'
import { createProductionExecutor } from '../services/automation/executor'
import { createScheduler, type Scheduler, type SchedulerDeps } from '../services/automation/scheduler'
import { buildManualMatch } from '../services/automation/triggers'
import { randomUUID } from '../utils/id'
import type {
  AutomationTask,
  InboxItem,
  TriggerMatch,
  TriggerStateMap,
} from '../services/automation/types'

interface AutomationState {
  tasks: AutomationTask[]
  inbox: InboxItem[]
  loading: boolean
  loadAll: () => Promise<void>
  saveTask: (task: AutomationTask) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  /** 手动立即运行（构造 manual match，与自动触发共用同一执行链） */
  runNow: (taskId: string) => Promise<void>
  confirmInboxItem: (id: string) => Promise<void>
  dismissInboxItem: (id: string) => Promise<void>
  markInboxRead: (id: string) => Promise<void>
  startScheduler: () => void
  stopScheduler: () => void
}

/** 执行器为无状态薄封装，模块级共享即可 */
const executor = createProductionExecutor()

let scheduler: Scheduler | null = null

/** 组装调度器依赖（唯一一处把 IPC 与执行层接起来的地方） */
function buildSchedulerDeps(): SchedulerDeps {
  return {
    getTasks: async () => {
      const res = await ipc.invoke('db:automation-list') as { tasks?: AutomationTask[] } | null
      return res?.tasks ?? []
    },
    getTriggerStates: async () => {
      const res = await ipc.invoke('db:automation-trigger-states') as { states?: Record<string, TriggerStateMap> } | null
      return res?.states ?? {}
    },
    getChapters: async () => {
      const res = await ipc.invoke('db:automation-finalized-chapters') as
        { chapters?: Array<{ number: number; title: string; wordCount: number }> } | null
      return res?.chapters ?? []
    },
    applyOutcome: async (input) => {
      const res = await ipc.invoke('db:automation-apply-outcome', input) as { success?: boolean; error?: string } | null
      if (res && res.success === false) throw new Error(res.error ?? 'apply outcome failed')
    },
    markRunRef: async (runId, refId) => {
      await ipc.invoke('db:automation-run-update', runId, { refId })
    },
    markInboxError: async (id, error) => {
      await ipc.invoke('db:automation-inbox-update', id, { actionError: error })
    },
    executor,
    now: () => Date.now(),
    // ⚠️ 已知限制（v1）：semantic 的正文上下文暂不注入（只用章节标题/章号），
    //    正文读取需新增批量取正文的 IPC，留待后续（spec §4.4 的截断策略已就绪，只缺数据源）
    readChapterText: () => '',
    // semantic 的模型调用：走三层路由的 budget 层（判定是轻量分类任务）
    callModel: async (prompt) => {
      const { useLLMStore } = await import('./llm-store')
      const store = useLLMStore.getState()
      const modelId = store.getModelForPurpose('classify') ?? store.defaultModelId
      if (!modelId) throw new Error('semantic trigger: no model available')
      const res = await store.generate([{ role: 'user', content: prompt }], modelId, { temperature: 0 })
      if (!res.success) throw new Error(res.error ?? 'semantic trigger: model call failed')
      return res.content
    },
  }
}

export const useAutomationStore = create<AutomationState>()((set, get) => ({
  tasks: [],
  inbox: [],
  loading: false,

  loadAll: async () => {
    set({ loading: true })
    try {
      const [taskRes, inboxRes] = await Promise.all([
        ipc.invoke('db:automation-list') as Promise<{ tasks?: AutomationTask[] } | null>,
        ipc.invoke('db:automation-inbox-list') as Promise<{ items?: InboxItem[] } | null>,
      ])
      set({ tasks: taskRes?.tasks ?? [], inbox: inboxRes?.items ?? [], loading: false })
    } catch (e) {
      renderLog('error', 'Automation', `加载自动化配置失败：${String(e)}`)
      set({ loading: false })
    }
  },

  saveTask: async (task) => {
    await ipc.invoke('db:automation-save', { ...task, updatedAt: Date.now() })
    await get().loadAll()
  },

  deleteTask: async (id) => {
    await ipc.invoke('db:automation-delete', id)
    await get().loadAll()
  },

  setEnabled: async (id, enabled) => {
    await ipc.invoke('db:automation-set-enabled', id, enabled)
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, enabled } : t)) }))
  },

  runNow: async (taskId) => {
    const task = get().tasks.find(t => t.id === taskId)
    const trigger = task?.triggers[0]
    if (!task || !trigger) return

    const match = buildManualMatch(trigger, { now: Date.now(), chapters: [] })
    const runId = randomUUID()
    await ipc.invoke('db:automation-run-append', {
      id: runId,
      automationId: task.id,
      triggerType: 'manual',
      targetType: task.targetType,
      status: 'running',
      evidence: [],
      startedAt: Date.now(),
    })
    try {
      const handle = await executor.start(task, match)
      await ipc.invoke('db:automation-run-update', runId, { refId: handle.refId })
    } catch (e) {
      await ipc.invoke('db:automation-run-update', runId, {
        status: 'failed', error: String(e), finishedAt: Date.now(),
      })
      renderLog('error', 'Automation', `手动运行失败：${String(e)}`)
    }
  },

  confirmInboxItem: async (id) => {
    const item = get().inbox.find(i => i.id === id)
    if (!item) return
    // notify_only 只提醒不执行：UI 不渲染按钮，store 同样拒绝（策略选择不得被绕过）
    if (item.actionPolicy === 'notify_only') return
    const task = get().tasks.find(t => t.id === item.automationId)
    if (!task) return

    const match: TriggerMatch = {
      triggerId: item.triggerId,
      title: item.title,
      summary: item.summary,
      evidence: item.evidence,
      fingerprint: item.fingerprint,
    }

    try {
      const handle = await executor.start(task, match)
      const runId = randomUUID()
      await ipc.invoke('db:automation-run-append', {
        id: runId,
        automationId: task.id,
        triggerType: task.triggers.find(t => t.id === item.triggerId)?.type ?? 'manual',
        targetType: task.targetType,
        refId: handle.refId,
        status: 'running',
        evidence: item.evidence,
        startedAt: Date.now(),
      })
      await ipc.invoke('db:automation-inbox-update', id, {
        status: 'confirmed', runId, handledAt: Date.now(), actionError: null,
      })
    } catch (e) {
      // 失败保持 pending（可重试）+ 写可见原因，不静默
      await ipc.invoke('db:automation-inbox-update', id, { status: 'pending', actionError: String(e) })
      renderLog('error', 'Automation', `确认运行失败：${String(e)}`)
    }
    await get().loadAll()
  },

  dismissInboxItem: async (id) => {
    await ipc.invoke('db:automation-inbox-update', id, { status: 'dismissed', handledAt: Date.now() })
    await get().loadAll()
  },

  markInboxRead: async (id) => {
    const readAt = Date.now()
    await ipc.invoke('db:automation-inbox-update', id, { readAt })
    set(s => ({ inbox: s.inbox.map(i => (i.id === id ? { ...i, readAt } : i)) }))
  },

  startScheduler: () => {
    if (scheduler) return
    scheduler = createScheduler(buildSchedulerDeps())
    scheduler.start()
  },

  stopScheduler: () => {
    scheduler?.stop()
    scheduler = null
  },
}))
