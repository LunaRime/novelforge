/**
 * 调度器 —— 渲染进程内的 60s tick（D 档；宿主决策 D2：不注册主进程定时器）
 *
 * 单次 tick：取 enabled 任务 → 逐触发器评估（semantic 串行 await）→ 指纹去重 →
 * 按策略分流 → **一次 applyOutcome 事务提交**（指纹推进 + 收件箱 + run 一起落库）→
 * 事务提交后才启动 auto_run 的执行（避免"执行已起但产物没落库"）。
 *
 * 三条硬约束：
 * 1. **重入保护**：tick 未完成时再次调用直接返回空结果（setInterval 不等人）
 * 2. **单任务隔离**：某任务处理失败只记日志并跳过，同 tick 的其余任务照常（评审 Important 5）
 * 3. **semantic 成本短路**：章节身份未变则跳过模型调用（评审 Important 9）
 */
import { randomUUID } from '../../utils/id'
import { renderLog } from '../render-logger'
import { evaluateChapterBatch, evaluateSchedule } from './triggers'
import { evaluateSemantic } from './semantic-trigger'
import type { AutomationExecutor } from './executor'
import {
  SCHEDULER_TICK_MS,
  type ActionPolicy,
  type AutomationRun,
  type AutomationTask,
  type TriggerContext,
  type TriggerMatch,
  type TriggerOutcomeInput,
  type TriggerStateMap,
} from './types'

export interface SchedulerDeps {
  /** 当前项目的自动化任务（实现方按 enabled 过滤或由本模块过滤） */
  getTasks: () => Promise<AutomationTask[]>
  /** 各任务的 per-trigger 去重状态 */
  getTriggerStates: () => Promise<Record<string, TriggerStateMap>>
  /** 当前项目的定稿章节（wordCount=0 的占位章节由评估函数过滤） */
  getChapters: () => Promise<Array<{ number: number; title: string; wordCount: number }>>
  /** 事务写入：指纹推进 + 收件箱 + run */
  applyOutcome: (input: TriggerOutcomeInput) => Promise<void>
  /** auto_run 启动成功后回写 run 的可追踪引用 */
  markRunRef: (runId: string, refId: string) => Promise<void>
  /** auto_run 启动失败：run 同步标 failed（否则 run 表留下永久 running 的幽灵记录） */
  markRunFailed: (runId: string, error: string) => Promise<void>
  /** 启动失败时把原因写回收件箱条目（不静默） */
  markInboxError: (inboxItemId: string, error: string) => Promise<void>
  executor: AutomationExecutor
  now: () => number
  /** semantic 专用：已定稿章节的**截断正文**（主进程侧按 spec §4.4 截断；仅在有 semantic 触发器时预取） */
  getChapterTexts: () => Promise<Record<number, string>>
  callModel: (prompt: string) => Promise<string>
}

export interface TickResult {
  evaluated: number
  matched: number
  inboxed: number
  started: number
}

export interface Scheduler {
  start: () => void
  stop: () => void
  /** 公开以便测试直接驱动（生产由 setInterval 调用） */
  tick: () => Promise<TickResult>
}

const EMPTY_RESULT: TickResult = { evaluated: 0, matched: 0, inboxed: 0, started: 0 }

/** semantic 的观察身份：章节号列表（未变则跳过模型调用） */
function observationIdentity(chapters: Array<{ number: number; wordCount: number }>): string {
  return chapters.filter(c => c.wordCount > 0).map(c => c.number).join(',')
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  let running = false
  let timer: ReturnType<typeof setInterval> | null = null

  async function evaluateOne(
    trigger: AutomationTask['triggers'][number],
    ctx: TriggerContext,
  ): Promise<TriggerMatch | null> {
    switch (trigger.type) {
      case 'chapter_batch':
        return evaluateChapterBatch(trigger, ctx)
      case 'schedule':
        return evaluateSchedule(trigger, ctx)
      case 'semantic':
        return await evaluateSemantic(trigger, ctx)
      default:
        return null   // manual 不参与自动评估（由「立即运行」直接构造 TriggerMatch）
    }
  }

  /** 单任务处理（失败由上层 catch 隔离，不波及同 tick 的其他任务） */
  async function processTask(
    task: AutomationTask,
    chapters: Array<{ number: number; title: string; wordCount: number }>,
    chapterTexts: Record<number, string>,
    baseState: TriggerStateMap,
    now: number,
    result: TickResult,
  ): Promise<void> {
    const taskState: TriggerStateMap = { ...baseState }
    const inboxItems: TriggerOutcomeInput['inboxItems'] = []
    const runs: AutomationRun[] = []
    const pendingStarts: Array<{ runId: string; inboxItemId: string; match: TriggerMatch }> = []
    let stateDirty = false

    const observation = observationIdentity(chapters)

    for (const trigger of task.triggers.filter(t => t.enabled)) {
      result.evaluated++
      const last = taskState[trigger.id]

      // semantic 成本短路：章节身份未变 → 跳过模型调用（fingerprint 只挡重复入箱，挡不住重复计费）
      if (trigger.type === 'semantic' && last?.lastObservationFingerprint === observation) continue

      const ctx: TriggerContext = {
        now,
        chapters,
        lastCheckedAt: last?.lastCheckedAt,
        callModel: deps.callModel,
        // 正文来自 tick 起点的预取（主进程侧已截断；无 semantic 任务时为空 map）
        readChapterText: (n) => chapterTexts[n] ?? '',
      }

      let match: TriggerMatch | null = null
      try {
        match = await evaluateOne(trigger, ctx)
      } catch (e) {
        // 单个触发器失败不阻断同任务的其余触发器（semantic 自身已降级，这里是兜底）
        renderLog('error', 'Automation', `触发器评估失败（${task.id}/${trigger.id}）：${String(e)}`)
        continue
      }

      // 无论是否命中都推进观察身份（否则 semantic 每 tick 都会重新调用模型）
      const nextState = { ...(taskState[trigger.id] ?? {}) }
      if (trigger.type === 'semantic') nextState.lastObservationFingerprint = observation

      if (!match || match.fingerprint === last?.lastFingerprint) {
        if (trigger.type === 'semantic') {
          taskState[trigger.id] = nextState
          stateDirty = true
        }
        continue
      }
      result.matched++

      const policy: ActionPolicy = trigger.actionPolicy ?? task.defaultActionPolicy
      const runId = policy === 'auto_run' ? randomUUID() : null
      const inboxItemId = randomUUID()

      if (policy === 'auto_run' && runId) {
        runs.push({
          id: runId,
          automationId: task.id,
          triggerType: trigger.type,
          targetType: task.targetType,
          status: 'running',
          evidence: match.evidence,
          startedAt: now,
        })
        pendingStarts.push({ runId, inboxItemId, match })
      }

      inboxItems.push({
        id: inboxItemId,
        triggerId: trigger.id,
        status: policy === 'auto_run' ? 'auto_run' : 'pending',
        actionPolicy: policy,
        match,
        runId,
      })

      taskState[trigger.id] = { ...nextState, lastCheckedAt: now, lastFingerprint: match.fingerprint }
      stateDirty = true
    }

    if (inboxItems.length === 0 && !stateDirty) return

    // 事务：指纹/观察身份推进 + 收件箱 + run 一起提交（失败则整体回滚，下次 tick 重新评估）
    await deps.applyOutcome({ automationId: task.id, triggerState: taskState, inboxItems, runs, now })
    result.inboxed += inboxItems.length

    // 事务提交后才启动执行（避免"执行已起但产物没落库"）
    for (const start of pendingStarts) {
      result.started++
      try {
        const handle = await deps.executor.start(task, start.match)
        await deps.markRunRef(start.runId, handle.refId)
      } catch (e) {
        await deps.markInboxError(start.inboxItemId, String(e))
        await deps.markRunFailed(start.runId, String(e))
        renderLog('error', 'Automation', `自动化执行启动失败（${task.id}）：${String(e)}`)
      }
    }
  }

  async function tick(): Promise<TickResult> {
    if (running) return { ...EMPTY_RESULT }
    running = true
    const result: TickResult = { ...EMPTY_RESULT }

    try {
      const tasks = (await deps.getTasks()).filter(t => t.enabled)
      if (tasks.length === 0) return result

      const states = await deps.getTriggerStates()
      const chapters = await deps.getChapters()
      const now = deps.now()
      // 仅在有启用的 semantic 触发器时才预取正文（避免无谓的正文查询）
      const needsTexts = tasks.some(t => t.triggers.some(tr => tr.type === 'semantic' && tr.enabled))
      const chapterTexts = needsTexts ? await deps.getChapterTexts() : {}

      for (const task of tasks) {
        try {
          await processTask(task, chapters, chapterTexts, states[task.id] ?? {}, now, result)
        } catch (e) {
          // 单任务失败隔离：记日志并跳过，其余任务照常评估（评审 Important 5）
          renderLog('error', 'Automation', `自动化任务处理失败（${task.id}）：${String(e)}`)
        }
      }

      return result
    } finally {
      running = false
    }
  }

  return {
    tick,
    start: () => {
      if (timer) return
      timer = setInterval(() => { void tick() }, SCHEDULER_TICK_MS)
    },
    stop: () => {
      if (timer) { clearInterval(timer); timer = null }
    },
  }
}
