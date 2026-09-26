/**
 * 调度器 —— 渲染进程内的 60s tick（D 档；宿主决策 D2：不注册主进程定时器）
 *
 * 单次 tick：取 enabled 任务 → 逐触发器评估（semantic 串行 await）→ 指纹去重 →
 * 按策略分流 → **一次 applyOutcome 事务提交**（指纹推进 + 收件箱 + run 一起落库）→
 * 事务提交后才启动 auto_run 的执行（避免"执行已起但产物没落库"）。
 *
 * 重入保护：tick 未完成时再次调用直接返回空结果（setInterval 不等人；
 * 并发写入会撞收件箱的指纹唯一索引）。
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
  /** 当前项目的自动化任务（实现方需按 enabled 过滤或由本模块过滤） */
  getTasks: () => Promise<AutomationTask[]>
  /** 各任务的 per-trigger 去重状态 */
  getTriggerStates: () => Promise<Record<string, TriggerStateMap>>
  /** 当前项目的定稿章节（wordCount=0 的占位章节由评估函数过滤） */
  getChapters: () => Promise<Array<{ number: number; title: string; wordCount: number }>>
  /** 事务写入：指纹推进 + 收件箱 + run */
  applyOutcome: (input: TriggerOutcomeInput) => Promise<void>
  /** auto_run 启动成功后回写 run 的可追踪引用 */
  markRunRef: (runId: string, refId: string) => Promise<void>
  /** 启动失败时把原因写回收件箱条目（不静默） */
  markInboxError: (inboxItemId: string, error: string) => Promise<void>
  executor: AutomationExecutor
  now: () => number
  readChapterText: (chapterNumber: number) => string
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

      for (const task of tasks) {
        const taskState: TriggerStateMap = { ...(states[task.id] ?? {}) }
        const inboxItems: TriggerOutcomeInput['inboxItems'] = []
        const runs: AutomationRun[] = []
        const pendingStarts: Array<{ runId: string; inboxItemId: string; match: TriggerMatch }> = []

        for (const trigger of task.triggers.filter(t => t.enabled)) {
          result.evaluated++
          const last = taskState[trigger.id]
          const ctx: TriggerContext = {
            now,
            chapters,
            lastCheckedAt: last?.lastCheckedAt,
            callModel: deps.callModel,
            readChapterText: deps.readChapterText,
          }

          let match: TriggerMatch | null = null
          try {
            match = await evaluateOne(trigger, ctx)
          } catch (e) {
            // 单个触发器失败不阻断同任务的其余触发器（semantic 的失败在自身内部已降级，这里是兜底）
            renderLog('error', 'Automation', `触发器评估失败（${task.id}/${trigger.id}）：${String(e)}`)
            continue
          }

          if (!match) continue
          if (match.fingerprint === last?.lastFingerprint) continue   // 指纹去重
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

          taskState[trigger.id] = { lastCheckedAt: now, lastFingerprint: match.fingerprint }
        }

        if (inboxItems.length === 0) continue

        // 事务：指纹推进 + 收件箱 + run 一起提交（失败则整体回滚，下次 tick 重新评估）
        await deps.applyOutcome({ automationId: task.id, triggerState: taskState, inboxItems, runs, now })
        result.inboxed += inboxItems.length

        // 事务提交后才启动执行：避免"执行已起但产物没落库"
        for (const start of pendingStarts) {
          result.started++
          try {
            const handle = await deps.executor.start(task, start.match)
            await deps.markRunRef(start.runId, handle.refId)
          } catch (e) {
            await deps.markInboxError(start.inboxItemId, String(e))
            renderLog('error', 'Automation', `自动化执行启动失败（${task.id}）：${String(e)}`)
          }
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
