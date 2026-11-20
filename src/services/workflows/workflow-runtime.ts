import { createStore } from 'zustand/vanilla'
import { getCurrentLocale, t } from '../../shared/locale'
import { randomUUID } from '../../utils/id'
import { sanitizeCheckpointData, cleanupMessageText } from '../agent/conversation-recovery'
import type { CheckpointData, WorkflowStep, WorkflowRun, WorkflowType, WorkflowContext, StepCallbacks, WorkflowParams, WorkflowDefinition } from '../../shared/workflow-types'
import type { EventPayloadMap } from '../../shared/event-bus'
import type { WorkflowOutputTailData } from '../../shared/ipc-channels'
import type { ArchitectureScope } from '../../core'

type WorkflowProject = { id: string | null; path: string | null; session: number }

export interface WorkflowRuntimePorts {
  id?: () => string
  project: {
    current(): WorkflowProject
    subscribe(listener: () => void): () => void
  }
  checkpoint: {
    read(isCurrent: () => boolean): Promise<unknown>
    write(data: CheckpointData): void
    clear(explicit?: boolean): void
  }
  output: {
    append(runId: string, step: number, text: string): void
    delete(runId: string): void
    read(runId: string, step: number, options: { full: true }): Promise<WorkflowOutputTailData>
  }
  rehydrate(): Promise<(type: WorkflowType, params: WorkflowParams) => WorkflowDefinition | null>
  emitComplete(event: EventPayloadMap['WORKFLOW_COMPLETE']): void
  registerSource?(runId: string, source: ArchitectureScope, retained: Iterable<string>): void
  showTasks?(): void
  log?(level: 'info' | 'warn' | 'error', message: string): void
}

interface WorkflowState {
  /** 所有活跃的工作流（支持多任务并发） */
  activeRuns: WorkflowRun[]
  /** 历史工作流记录 */
  history: WorkflowRun[]
  /** 全局日志（下方面板用） */
  globalLogs: Array<{ ts: number; time: string; level: 'info' | 'warn' | 'error'; message: string }>

  /** 兼容属性：第一个活跃工作流（供旧代码平稳过渡） */
  currentRun: WorkflowRun | null

  /** 步进模式：各工作流的等待状态 */
  waitingRuns: Record<string, { waitingForConfirm: boolean; waitingAfterStepIndex: number }>

  // ===== 旧接口兼容（映射到第一个 activeRun） =====
  waitingForConfirm: boolean
  waitingAfterStepIndex: number

  // ===== 便捷查询 =====
  /** 检查指定类型的工作流是否有在运行 */
  isTypeRunning: (type: WorkflowType) => boolean
  /** 是否有任何工作流在运行 */
  hasActiveRun: () => boolean
  /** 活跃任务数量 */
  activeCount: () => number
  isRunCurrent: (runId: string) => boolean
  /** 获取当前正在流式输出的活跃工作流（供 AI 输出面板消费） */
  getActiveStreamingRun: () => WorkflowRun | null
  /** 获取当前最活跃任务的步骤信息（供 StatusBar 胶囊显示） */
  getActiveStepInfo: () => { title: string; stepName: string; progress: number; total: number; completed: number } | null

  // ===== Actions =====
  /** 启动一个工作流（可并发），返回 runId */
  startWorkflow: (definition: WorkflowDefinition, stepByStep?: boolean, options?: { headless?: boolean; onStarted?: (runId: string) => void }) => Promise<string>
  /** 步进模式下确认继续执行下一步（需指定 runId） */
  confirmContinue: (runId?: string) => void
  /** 取消工作流（传 runId 取消指定，不传取消全部） */
  cancelWorkflow: (runId?: string) => void
  /** 添加全局日志 */
  addLog: (level: 'info' | 'warn' | 'error', message: string) => void
  /** 清空日志 */
  clearLogs: () => void
  /** 从 checkpoint 恢复未完成的工作流（应用启动时调用；L2 v2：rehydrate 重建 + 断点重放决断） */
  restoreCheckpoint: () => Promise<CheckpointData | null>
  /** 清除持久化的 checkpoint */
  clearCheckpoint: () => void
  /**
   * 崩溃恢复续读（M2，CC §三.4）：restoreCheckpoint 后调用——把中断步骤落盘到
   * workflow-output/<runId>/<stepIndex>.txt 的输出（主进程文件）补回空的 step.result。
   * 只补「result 为空且文件存在」的步骤（checkpoint 已有内容/正常步骤零改动），
   * 补填内容走 cleanupMessageText 净化（与 checkpoint 恢复同语义，防半截 think 残片）。
   */
  hydrateInterruptedOutputs: () => Promise<void>
}

export function createWorkflowRuntime(ports: WorkflowRuntimePorts) {
  const runScopes = new Map<string, WorkflowProject>()
  const sameProject = (a: WorkflowProject, b: WorkflowProject) => a.id === b.id && a.path === b.path && a.session === b.session

  function saveCheckpoint(state: WorkflowState, origin?: WorkflowProject): void {
    try {
      const current = ports.project.current()
      if (origin && !sameProject(origin, current)) return
      const active = state.activeRuns.filter(r => {
        const source = runScopes.get(r.id)
        return (!source || sameProject(source, current))
          && !r.cancellation
          && (r.status === 'running' || r.status === 'waiting' || r.status === 'paused')
      })
      const activeIds = new Set(active.map(run => run.id))
      const data: CheckpointData = {
        activeRuns: active,
        waitingRuns: Object.fromEntries(Object.entries(state.waitingRuns).filter(([id]) => activeIds.has(id))),
        savedAt: new Date().toISOString(),
        runDefs: Object.fromEntries(
          active.map((r): [string, { type: WorkflowType; params: WorkflowParams }] => [
            r.id,
            runDefs.get(r.id) ?? { type: r.type, params: (r as WorkflowRun & { rehydrateParams?: WorkflowParams }).rehydrateParams ?? {} },
          ]),
        ),
        contextData: Object.fromEntries(
          [...activeContexts]
            .filter(([id]) => activeIds.has(id))
            .map(([id, ctx]): [string, Record<string, unknown>] => [id, ctx.data]),
        ),
      }
      if (active.length > 0) ports.checkpoint.write(data)
      else ports.checkpoint.clear()
    } catch { /* 持久化不可用（非 Electron / 浏览器模式）时静默 */ }
  }

  /** 工作流上下文实例 Map（runId → context） */
  const activeContexts = new Map<string, WorkflowContext>()
  /** 步进模式：存储「等待用户确认」的 Promise resolve（runId → resolve） */
  const continueResolveRefs = new Map<string, () => void>()
  /** L2：run 可重建参数快照（type + params → rehydrateWorkflow；Task 5 saveCheckpoint 消费，本任务先引入） */
  const runDefs = new Map<string, { type: WorkflowType; params: WorkflowParams }>()
  /** L2 v2（IMP-1）：跨重启 waiting 续跑的断点上下文——restoreCheckpoint 时从 checkpoint contextData 快照；
   *  waiting run 恢复时无 activeContexts 条目，confirmContinue 重放用它恢复 ctx.data（否则 ?? {} 恒为空丢共享数据）。 */
  const resumeContextData = new Map<string, Record<string, unknown>>()
  /** Restored waiting runs reuse the accepted factory closure rather than rebinding on confirmation. */
  const restoredWaitingDefinitions = new Map<string, { definition: WorkflowDefinition; isCurrent: () => boolean }>()

  // ===== appendText 流式缓冲（共享限频调度器） =====
  // LLM 流式 chunk 逐片 setState 会高频重渲染整个面板，阻塞主线程。
  // 后果：mouseover 事件排队 → 浏览器原生 title 提示（UI 线程驱动，不受 JS 阻塞）
  // 抢先弹出，用户看到"旧样式"悬浮弹窗。
  //
  // 根因教训（44244a1 修复无效的原因）：旧的"按 buffer 大小 >=200 立即 flush"会绕过
  // 定时器——chunk 大或快时 flush 频率仍 ≈ chunk 频率；且定稿后处理 6-7 个步骤并发
  // 流式，各自独立 buffer/timer，setState 频率再 ×并发数 → 主线程照样被占。
  //
  // 正确做法：**单一共享 timer 驱动，所有 run/step 的文本先进 pending 队列**。
  // 最小刷新间隔 = FLUSH_INTERVAL_MS 是硬约束（并发步骤共用一个 timer，每轮最多
  // 一次渲染）；同 tick 内的多次 updateStepById 被 React 自动批处理为一次渲染。
  const FLUSH_INTERVAL_MS = 100
  const pendingAppendFlushes = new Map<string, string>()
  let appendFlushScheduled = false

  /** 安排下一轮统一 flush（模块级单 timer，所有并发步骤共享） */
  function scheduleAppendFlush(): void {
    if (appendFlushScheduled) return
    appendFlushScheduled = true
    setTimeout(() => {
      appendFlushScheduled = false
      flushAllPendingAppends()
    }, FLUSH_INTERVAL_MS)
  }

  /**
   * 把当前步骤的累积文本写入步骤 result。
   * key 格式：`{runId}:{stepIndex}`
   *
   * M2 双轨：此处是「内存流式 + 文件镜像」的单一汇聚点——文本以既有 100ms 共享 flush 节奏
   * 同时进 step.result（UI 流式渲染）与主进程输出文件（崩溃恢复/续读，见 workflow-output）。
   * 镜像与内存写同频、fire-and-forget，失败静默（补充通道，绝不打断渲染主路径）。
   */
  function writeStepResultAppend(key: string, text: string): void {
    const sepIdx = key.indexOf(':')
    if (sepIdx < 0) return
    const runId = key.slice(0, sepIdx)
    const stepIndex = parseInt(key.slice(sepIdx + 1), 10)
    if (isNaN(stepIndex)) return

    const activeRun = store.getState().activeRuns.find(r => r.id === runId)
    if (!activeRun) return
    const step = activeRun.steps[stepIndex]
    if (!step) return
    updateStepById(store.setState, runId, stepIndex, { result: (step.result || '') + text })
    ports.output.append(runId, stepIndex, text)
  }

  /** 定时器到期：把 pending 队列中全部累积文本一次性写入（多 key 同 tick → 一次渲染） */
  function flushAllPendingAppends(): void {
    if (pendingAppendFlushes.size === 0) return
    for (const [key, text] of pendingAppendFlushes) {
      pendingAppendFlushes.delete(key)
      writeStepResultAppend(key, text)
    }
  }

  /**
   * 立即写入指定 key 的残留缓冲（不等 timer）。
   * 用于步骤完成/工作流结束时——此后该 key 不会再有新 chunk。
   */
  function flushAppendTextNow(key: string): void {
    const text = pendingAppendFlushes.get(key)
    if (text === undefined) return
    pendingAppendFlushes.delete(key)
    writeStepResultAppend(key, text)
  }

  /** 清理某工作流的所有待写缓冲（结束/取消时丢弃残留，不写入） */
  function clearAppendBuffers(runId: string): void {
    for (const key of [...pendingAppendFlushes.keys()]) {
      if (key.startsWith(`${runId}:`)) pendingAppendFlushes.delete(key)
    }
  }

  /** 计算兼容字段的辅助函数 */
  function computeCompat(activeRuns: WorkflowRun[], waitingRuns: Record<string, { waitingForConfirm: boolean; waitingAfterStepIndex: number }>) {
    const currentRun = activeRuns.length > 0 ? activeRuns[0] : null
    const firstRunId = currentRun?.id ?? ''
    const firstWaiting = waitingRuns[firstRunId]
    return {
      currentRun,
      waitingForConfirm: firstWaiting?.waitingForConfirm ?? false,
      waitingAfterStepIndex: firstWaiting?.waitingAfterStepIndex ?? -1,
    }
  }

  function pruneRunScopes() {
    const { activeRuns, history } = store.getState()
    const retained = new Set([...activeRuns, ...history].map(run => run.id))
    for (const id of runScopes.keys()) {
      if (!retained.has(id)) runScopes.delete(id)
    }
  }

  const store = createStore<WorkflowState>()((set, get) => ({
    activeRuns: [],
    history: [],
    globalLogs: [],
    waitingRuns: {},

    // 兼容属性初始值
    currentRun: null,
    waitingForConfirm: false,
    waitingAfterStepIndex: -1,

    // ===== 便捷查询 =====
    isTypeRunning: (type) => get().activeRuns.some(r => r.type === type && !r.cancellation
          && (r.status === 'running' || r.status === 'waiting')),
    hasActiveRun: () => get().activeRuns.length > 0,
    activeCount: () => get().activeRuns.length,
    isRunCurrent: runId => {
      const source = runScopes.get(runId)
      return !source || sameProject(source, ports.project.current())
    },

    getActiveStreamingRun: () => {
      const runs = get().activeRuns
      // 优先返回正在 running 的任务；其次 waiting 的
      return runs.find(r => r.status === 'running') || runs.find(r => r.status === 'waiting') || null
    },

    getActiveStepInfo: () => {
      const run = get().activeRuns.find(r => r.status === 'running' || r.status === 'waiting')
      if (!run) return null
      const step = run.steps[run.currentStepIndex] || run.steps[0]
      const completed = run.steps.filter(s => s.status === 'completed').length
      return {
        title: run.title,
        stepName: step?.name || '',
        progress: step?.progress || 0,
        total: run.steps.length,
        completed,
      }
    },

    confirmContinue: (runId) => {
      // 如果未指定 runId，使用第一个等待中的
      const targetId = runId ?? Object.keys(get().waitingRuns).find(id => get().waitingRuns[id]?.waitingForConfirm)
      if (!targetId || !get().isRunCurrent(targetId)) return
      const resolve = continueResolveRefs.get(targetId)
      if (resolve) {
        // 进程内步进等待：内存 resolve（现状语义不变），continueResolveRefs 保持进程内语义
        resolve()
        continueResolveRefs.delete(targetId)
      } else {
        // A restored factory already captured its project; never rebuild it against a new one.
        const r = get().activeRuns.find(x => x.id === targetId)
        const restored = restoredWaitingDefinitions.get(targetId)
        if (!r || !restored || !restored.isCurrent()) return
        const waitIdx = get().waitingRuns[targetId]?.waitingAfterStepIndex ?? -1
        restoredWaitingDefinitions.delete(targetId)
        void executeRunFromIndex(r, restored.definition, waitIdx + 1,
          activeContexts.get(targetId)?.data ?? resumeContextData.get(targetId) ?? {}).catch(() => {})
      }
      set(s => {
        const newWaiting = { ...s.waitingRuns }
        delete newWaiting[targetId]
        const compat = computeCompat(s.activeRuns, newWaiting)
        return { waitingRuns: newWaiting, ...compat }
      })
    },

    startWorkflow: async (definition, stepByStep = false, options) => {
      const run: WorkflowRun = {
        id: (ports.id ?? randomUUID)(),
        type: definition.type,
        title: definition.title,
        status: 'running',
        currentStepIndex: 0,
        createdAt: new Date().toISOString(),
        steps: definition.steps.map((s) => ({
          id: (ports.id ?? randomUUID)(),
          name: s.name,
          description: s.description,
          status: 'pending',
          logs: [],
        })),
        rehydrateParams: definition.rehydrateParams ?? {},
      }

      runScopes.set(run.id, { ...ports.project.current() })
      // 添加到活跃列表
      set(s => {
        const newRuns = [...s.activeRuns, run]
        return { activeRuns: newRuns, ...computeCompat(newRuns, s.waitingRuns) }
      })
      get().addLog('info', `[Start] ${definition.title}`)

      // 自动联动：打开底部任务面板（步进模式的"继续"确认按钮所在位置）+ 右侧 AI 输出视图
      // 非阻塞 import 避免循环依赖；不打开底栏时，步进模式下工作流会在等待确认时"隐形卡住"
      // headless（D 档自动化触发）：不抢焦点 —— 自动运行不该打断用户正在进行的编辑/阅读
      if (!options?.headless) {
        ports.showTasks?.()
      }

      // 记录 run 可重建参数快照（Task 5 saveCheckpoint 消费；confirmContinue 跨重启重放读 run.rehydrateParams）
      runDefs.set(run.id, { type: run.type, params: definition.rehydrateParams ?? {} })

      // 启动即回执（D 档 Critical 2）：本函数要等整个 run 结束才 return，
      // 自动化侧不能为此阻塞（否则 tick 会自锁到工作流跑完）
      options?.onStarted?.(run.id)

      // 交给可重入执行函数（断点 index 0 + 空上下文字段）——行为与原内联循环 + 收尾等价
      await executeRunFromIndex(run, definition, 0, {}, stepByStep)
      return run.id
    },

    cancelWorkflow: (runId) => {
      const targets = get().activeRuns.filter(run => !run.cancellation && (!runId || run.id === runId))
      const cancellable = targets.filter(run => !activeContexts.get(run.id)?.finalCommitStarted)
      if (cancellable.length < targets.length) get().addLog('info', t('log.workflow.finishingCommit'))
      if (!cancellable.length) return

      const ids = new Set(cancellable.map(run => run.id))
      for (const id of ids) {
        const context = activeContexts.get(id)
        if (context) context.cancelled = true
        restoredWaitingDefinitions.delete(id)
        clearAppendBuffers(id)
        resumeContextData.delete(id)
      }
      set(state => {
        const activeRuns: WorkflowRun[] = []
        const immediatelyCancelled: WorkflowRun[] = []
        for (const run of state.activeRuns) {
          if (!ids.has(run.id)) activeRuns.push(run)
          else if (activeContexts.has(run.id)) activeRuns.push({ ...run, cancellation: 'requested' })
          else immediatelyCancelled.push({ ...run, status: 'failed', cancellation: 'cancelled', completedAt: new Date().toISOString() })
        }
        const waitingRuns = { ...state.waitingRuns }
        for (const id of ids) delete waitingRuns[id]
        return {
          activeRuns, waitingRuns,
          history: [...immediatelyCancelled, ...state.history].slice(0, 50),
          ...computeCompat(activeRuns, waitingRuns),
        }
      })

      for (const id of ids) {
        const release = continueResolveRefs.get(id)
        continueResolveRefs.delete(id)
        release?.()
        if (!activeContexts.has(id)) {
          ports.output.delete(id)
          runDefs.delete(id)
        }
      }
      if (!runId && get().activeRuns.every(run => run.cancellation === 'requested')) ports.checkpoint.clear(true)
      else saveCheckpoint(get(), runId ? runScopes.get(runId) : undefined)
      pruneRunScopes()
    },

    addLog: (level, message) => {
      const now = Date.now()
      const entry = { ts: now, time: new Date(now).toLocaleTimeString(getCurrentLocale()), level, message }
      set((s) => ({
        globalLogs: [...s.globalLogs, entry].slice(-500), // 保留最近 500 条
      }))
      // 双写：内存（LogsView 展示）+ 主进程文件日志（持久化，用户反馈可查）
      ports.log?.(level, message)
    },

    clearLogs: () => set({ globalLogs: [] }),

    // ===== Checkpoint 持久化 =====
    restoreCheckpoint: async () => {
      const source = { ...ports.project.current() }
      let sourceChanged = false
      const matchesSource = () => {
        const current = ports.project.current()
        return sameProject(current, source)
      }
      const unsubscribe = ports.project.subscribe(() => { if (!matchesSource()) sourceChanged = true })
      const isCurrent = () => !sourceChanged && matchesSource()
      try {
        const cp = sanitizeCheckpointData(await ports.checkpoint.read(isCurrent))
        if (!isCurrent()) return null
        if (!cp || cp.activeRuns.length === 0) return cp
        // Factories capture project state, so validate BEFORE rebuilding after asynchronous IO.
        const rehydrate = await ports.rehydrate()
        if (!isCurrent()) return null
        const interruptedWaitingIds = new Set(Object.keys(cp.waitingRuns ?? {}))
        const restored: WorkflowRun[] = []
        const keptWaitingIds: string[] = []
        const waitingDefinitions = new Map<string, WorkflowDefinition>()
        const runningReplays: Array<{ rr: WorkflowRun; def: WorkflowDefinition; startIndex: number }> = []
        for (const r of cp.activeRuns) {
          if (!isCurrent()) return null
          // Missing runDefs is legacy: never feed empty parameters into a live factory.
          const runDef = cp.runDefs?.[r.id]
          const def = runDef ? rehydrate(r.type, runDef.params) : null
          if (!isCurrent()) return null
          const isWaiting = interruptedWaitingIds.has(r.id)
          if (def) {
            const rr = { ...r, status: isWaiting ? ('waiting' as const) : ('running' as const) }
            restored.push(rr)
            if (isWaiting) { keptWaitingIds.push(r.id); waitingDefinitions.set(r.id, def) }
            else runningReplays.push({ rr, def, startIndex: rr.currentStepIndex })
          } else {
            if (isWaiting) get().addLog('warn', t('log.workflow.restoreInterrupted').replace('{title}', () => r.title))
            restored.push(isWaiting ? { ...r, status: 'failed' as const } : { ...r, status: 'paused' as const })
          }
        }
        if (!isCurrent()) return null
        // Do not clear a new project's resume data until the old read has been accepted.
        resumeContextData.clear()
        restoredWaitingDefinitions.clear()
        for (const [id, definition] of waitingDefinitions) restoredWaitingDefinitions.set(id, { definition, isCurrent })
        for (const r of cp.activeRuns) {
          runScopes.set(r.id, source)
          resumeContextData.set(r.id, cp.contextData?.[r.id] ?? {})
        }
        // Publish before replay, including zero-step completion; preserve waiting continuation indices.
        set((s) => ({
          activeRuns: [...s.activeRuns, ...restored],
          waitingRuns: Object.fromEntries(Object.entries(cp.waitingRuns ?? {}).filter(([id]) => keptWaitingIds.includes(id))),
        }))
        if (!isCurrent()) return null
        if (source.id && source.path) {
          const { activeRuns, history } = get()
          const retainedIds = [...activeRuns, ...history].map(run => run.id)
          for (const run of restored) ports.registerSource?.(run.id, { id: source.id, path: source.path, session: source.session }, retainedIds)
        }
        for (const { rr, def, startIndex } of runningReplays) {
          if (!isCurrent()) return null
          void executeRunFromIndex(rr, def, startIndex, cp.contextData?.[rr.id] ?? {})
        }
        return cp
      } finally {
        unsubscribe()
      }
    },

    clearCheckpoint: () => ports.checkpoint.clear(true),

    hydrateInterruptedOutputs: async () => {
      // 只处理崩溃恢复回来的暂停/失败 run（正常 run 不落此状态，文件在其结束时已被任务级清理）
      const runs = get().activeRuns.filter(r => r.status === 'paused' || r.status === 'failed')
      for (const run of runs) {
        // 候选 = result 为空/缺失的步骤（文件存在才补——pending/未流式步骤无文件，天然跳过）
        const candidates = run.steps
          .map((step, index) => ({ index, step }))
          .filter(({ step }) => typeof step.result !== 'string' || step.result === '')
        for (const { index } of candidates) {
          try {
            const tail = await ports.output.read(run.id, index, { full: true })
            if (!tail.success || !tail.exists || tail.content === '') continue
            // cleanupMessageText：与 restoreCheckpoint 同语义净化（半截 think/tool 残片）
            updateStepById(set, run.id, index, { result: cleanupMessageText(tail.content) })
          } catch {
            // 单步补填失败不影响其余步骤/run
          }
        }
      }
    },
  }))

  // ===== 工具函数（按 runId 操作） =====

  /** 更新指定工作流的运行状态 */
  function updateRunById(
    set: (fn: (s: WorkflowState) => Partial<WorkflowState>) => void,
    runId: string,
    updates: Partial<WorkflowRun>
  ) {
    set((s) => {
      const newRuns = s.activeRuns.map(r =>
        r.id === runId ? { ...r, ...updates } : r
      )
      return { activeRuns: newRuns, ...computeCompat(newRuns, s.waitingRuns) }
    })
  }

  /** 更新指定工作流的指定步骤 */
  function updateStepById(
    set: (fn: (s: WorkflowState) => Partial<WorkflowState>) => void,
    runId: string,
    stepIndex: number,
    updates: Partial<WorkflowStep>
  ) {
    set((s) => {
      const newRuns = s.activeRuns.map(r => {
        if (r.id !== runId) return r
        const steps = [...r.steps]
        steps[stepIndex] = { ...steps[stepIndex], ...updates }
        return { ...r, steps }
      })
      return { activeRuns: newRuns, ...computeCompat(newRuns, s.waitingRuns) }
    })
  }

  /** 追加指定工作流的指定步骤日志 */
  function appendStepLogById(
    set: (fn: (s: WorkflowState) => Partial<WorkflowState>) => void,
    runId: string,
    stepIndex: number,
    message: string
  ) {
    set((s) => {
      const newRuns = s.activeRuns.map(r => {
        if (r.id !== runId) return r
        const steps = [...r.steps]
        steps[stepIndex] = {
          ...steps[stepIndex],
          logs: [...steps[stepIndex].logs, `[${new Date().toLocaleTimeString(getCurrentLocale())}] ${message}`],
        }
        return { ...r, steps }
      })
      return { activeRuns: newRuns, ...computeCompat(newRuns, s.waitingRuns) }
    })
  }

  /**
   * L2：把原 startWorkflow 内联执行循环抽为按任意断点 index 推进的可重入函数。
   *
   * - `startIndex` 之前的步骤视为已完成（断点重放：跳过，不重跑）；
   * - `contextData` 作为重放起点的工作流上下文字段（executor 经 `ctx.data` 读到）；
   * - 完成后处理（完成判定/onComplete/入历史/清理/PERSIST）与本函数一体
   *   （Task 5 save/load/restore 复用；index 0 调用 = 原 startWorkflow 内联循环等价）。
   * `activeContexts`/`continueResolveRefs` 保持模块级进程内语义（此函数重建 context）。
   * `stepByStep`（可选，仅 startWorkflow 传入）：重放/续跑路径默认 false（不再暂停）。
   */
  async function executeRunFromIndex(
    run: WorkflowRun,
    definition: WorkflowDefinition,
    startIndex: number,
    contextData: Record<string, unknown>,
    stepByStep = false,
  ): Promise<void> {
    const set = store.setState
    const get = () => store.getState()

    // 重建执行上下文（模块级进程内 Map 语义）
    const context: WorkflowContext = { data: contextData, cancelled: false }
    activeContexts.set(run.id, context)
    const origin = runScopes.get(run.id) ?? { ...ports.project.current() }

    // I-1（跨任务硬约束）：进入执行循环前把 run 状态对齐为 running——保证完成判定
    // finalRun.status==='running' 成立。对 startWorkflow 正常路径无害（其开始已 set running）；
    // 对跨重启 waiting 点「继续」重放必要（restore 后 run 为 waiting，若不对齐则重放完成后
    // 不会被标记 completed，断点重放永远打不到 completed）；对 restoreCheckpoint 自动重放的
    // run（尚未入 activeRuns）此写入为 no-op，其 running 态由 restoreCheckpoint 自身置位。
    updateRunById(set, run.id, { status: 'running' })

    // 逐步执行（从断点 startIndex 起）
    for (let i = startIndex; i < definition.steps.length; i++) {
      // 检查取消
      if (context.cancelled) break

      const stepDef = definition.steps[i]

      // 标记当前步骤为运行中
      updateStepById(set, run.id, i, { status: 'running', startedAt: new Date().toISOString() })
      updateRunById(set, run.id, { currentStepIndex: i })
      get().addLog('info', `[${definition.title}] ${stepDef.name}`)

      // 创建步骤回调
      const callbacks: StepCallbacks = {
        log: (message) => {
          appendStepLogById(set, run.id, i, message)
          get().addLog('info', `  ${message}`)
        },
        setProgress: (progress) => {
          updateStepById(set, run.id, i, { progress })
        },
        appendText: (text) => {
          if (context.cancelled) return
          // 共享限频调度：只累积 + 安排统一 flush（timer 保证最小间隔），
          // 不在此同步 setState——避免 LLM 流式高频 chunk 阻塞主线程
          const key = `${run.id}:${i}`
          pendingAppendFlushes.set(key, (pendingAppendFlushes.get(key) ?? '') + text)
          scheduleAppendFlush()
        },
      }

      try {
        const result = await stepDef.executor(run.steps[i], context, callbacks)
        if (context.cancelled) break
        // 刷新该步骤流式缓冲残留（立即写入，避免 timer 晚于步骤完成）
        flushAppendTextNow(`${run.id}:${i}`)
        updateStepById(set, run.id, i, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          progress: 100,
          result: result || get().activeRuns.find(r => r.id === run.id)?.steps[i].result,
        })
        get().addLog('info', `[${definition.title}] ${stepDef.name} — OK`)

        // 步进模式：非最后一步，且未取消 → 暂停等待用户确认
        if (stepByStep && i < definition.steps.length - 1 && !context.cancelled) {
          const continued = new Promise<void>(resolve => { continueResolveRefs.set(run.id, resolve) })
          set(s => {
            const activeRuns = s.activeRuns.map(item => item.id === run.id ? { ...item, status: 'waiting' as const } : item)
            const newWaiting = { ...s.waitingRuns, [run.id]: { waitingForConfirm: true, waitingAfterStepIndex: i } }
            return { activeRuns, waitingRuns: newWaiting, ...computeCompat(activeRuns, newWaiting) }
          })
          get().addLog('info', `[${definition.title}] Waiting: step ${i + 2} — ${definition.steps[i + 1].name}`)
          saveCheckpoint(get(), origin)
          await continued
          if (context.cancelled) break
          updateRunById(set, run.id, { status: 'running' })
        } else {
          saveCheckpoint(get(), origin)
        }
      } catch (error) {
        if (context.cancelled) break
        const errorMsg = error instanceof Error ? error.message : String(error)
        updateStepById(set, run.id, i, {
          status: 'failed',
          error: errorMsg,
          completedAt: new Date().toISOString(),
        })
        updateRunById(set, run.id, { status: 'failed', completedAt: new Date().toISOString() })
        // D 档：失败也要广播（带 runId）——自动化侧据此把 automation_runs 标 failed，
        // 否则 run 表会留下永久 running 的幽灵记录（评审 Important 3）
        ports.emitComplete({ type: definition.type, runId: run.id, status: 'failed' })
        get().addLog('error', `[${definition.title}] ${stepDef.name} — FAIL: ${errorMsg}`)
        break
      }
    }

    const finalRun = get().activeRuns.find(r => r.id === run.id)
    if (finalRun && context.cancelled) {
      const step = finalRun.steps[finalRun.currentStepIndex]
      if (step?.status === 'running') {
        updateStepById(set, run.id, finalRun.currentStepIndex, { status: 'skipped', completedAt: new Date().toISOString() })
      }
      updateRunById(set, run.id, { status: 'failed', cancellation: 'cancelled', completedAt: new Date().toISOString() })
      get().addLog('warn', `[Cancel] ${definition.title}`)
    } else if (finalRun?.status === 'running') {
      updateRunById(set, run.id, { status: 'completed', completedAt: new Date().toISOString() })
      saveCheckpoint(get(), origin)
      get().addLog('info', `[Done] ${definition.title}`)

      // 通过 EventBus 广播工作流完成事件（替代 window.dispatchEvent）
      ports.emitComplete({ type: definition.type, runId: run.id, status: 'success' })

      // ===== 执行 onComplete 通知/跳转 =====
      if (definition.onComplete) {
        const { mode, openResult } = definition.onComplete
        try {
          if (mode === 'open' && openResult) {
            // 直接打开结果
            await openResult()
          }
          // silent 模式不做额外操作
        } catch (e) {
          get().addLog('warn', `onComplete failed: ${e}`)
        }
      }
    }

    // 从活跃列表移除，存入历史
    set(s => {
      const completedRun = s.activeRuns.find(r => r.id === run.id)
      const newRuns = s.activeRuns.filter(r => r.id !== run.id)
      const newWaiting = { ...s.waitingRuns }
      delete newWaiting[run.id]
      const newHistory = completedRun
        ? [completedRun, ...s.history].slice(0, 50)
        : s.history
      return {
        activeRuns: newRuns,
        history: newHistory,
        waitingRuns: newWaiting,
        ...computeCompat(newRuns, newWaiting),
      }
    })

    // 清理上下文与流式缓冲
    activeContexts.delete(run.id)
    pruneRunScopes()
    runDefs.delete(run.id)
    continueResolveRefs.delete(run.id)
    resumeContextData.delete(run.id)
    clearAppendBuffers(run.id)
    // M2 任务级清理：run 已移入历史（完成/失败），删除其输出目录（崩溃恢复窗口已过）
    ports.output.delete(run.id)

    // 持久化 checkpoint
    saveCheckpoint(get(), origin)
  }

  return { store, executeRunFromIndex, persistCheckpoint: () => saveCheckpoint(store.getState()) }
}
