/**
 * 确定性触发器评估 —— schedule / chapter_batch / manual（semantic 见 semantic-trigger.ts）
 *
 * 全部为**纯函数**：外部事实（时间、章节、上次检查点）由 `TriggerContext` 注入，可直接单测。
 * 参照 Denova：`internal/app/automation/trigger_evaluation.go`（chapter_batch 的"最后完整批 + 指纹"）、
 * `internal/automation/schedule.go`（区间回溯而非"下次触发时间"）。
 */
import { t } from '../../shared/locale'
import {
  DEFAULT_CHAPTER_BATCH_SIZE,
  SCHEDULE_FIRST_LOOKBACK_MS,
  type Schedule,
  type TriggerContext,
  type TriggerDefinition,
  type TriggerMatch,
} from './types'

// ===== 定时触发（区间回溯） =====

/** 人类可读的频率描述 */
function describeSchedule(s: Schedule): string {
  switch (s.kind) {
    case 'hourly':
      return t('automation.schedule.hourly').replace('{n}', String(s.everyHours ?? 1))
    case 'daily':
      return t('automation.schedule.daily').replace('{time}', `${pad(s.hour ?? 0)}:${pad(s.minute ?? 0)}`)
    case 'weekly':
      return t('automation.schedule.weekly')
        .replace('{day}', String(s.weekday ?? 0))
        .replace('{time}', `${pad(s.hour ?? 0)}:${pad(s.minute ?? 0)}`)
    case 'monthly':
      return t('automation.schedule.monthly')
        .replace('{day}', String(s.dayOfMonth ?? 1))
        .replace('{time}', `${pad(s.hour ?? 0)}:${pad(s.minute ?? 0)}`)
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * 取 `(from, now)` **开区间**内最近的命中点（严格早于 now，避免 tick 恰好落在整点时抖动；
 * 晚一分钟的下个 tick 仍会命中）。
 */
function latestHitInWindow(schedule: Schedule, from: number, now: number): number | null {
  const hit = schedule.kind === 'hourly'
    ? hourlyHit(schedule.everyHours ?? 1, now)
    : calendarHit(schedule, now)
  if (hit === null) return null
  return hit > from ? hit : null
}

/** 每 N 小时：以**当天 0 点**为基准对齐（不用 epoch，避免跨时区的整点漂移） */
function hourlyHit(everyHours: number, now: number): number {
  const period = Math.max(1, everyHours) * 3_600_000
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const k = Math.floor((now - dayStart.getTime()) / period)
  let hit = dayStart.getTime() + k * period
  if (hit >= now) hit -= period
  return hit
}

/** 每日/每周/每月：从 now 所在周期向下找最近一个已过的时刻 */
function calendarHit(schedule: Schedule, now: number): number {
  const candidate = new Date(now)
  candidate.setHours(schedule.hour ?? 0, schedule.minute ?? 0, 0, 0)

  if (schedule.kind === 'daily') {
    if (candidate.getTime() >= now) candidate.setDate(candidate.getDate() - 1)
    return candidate.getTime()
  }

  if (schedule.kind === 'weekly') {
    const target = schedule.weekday ?? 0
    // 回退到本周（或上周）的目标星期
    let delta = (candidate.getDay() - target + 7) % 7
    if (delta === 0 && candidate.getTime() >= now) delta = 7
    candidate.setDate(candidate.getDate() - delta)
    return candidate.getTime()
  }

  // monthly：回退到本月（或上月）的目标日（目标日超过当月天数时取当月最后一天）
  const targetDay = Math.min(schedule.dayOfMonth ?? 1, daysInMonth(candidate.getFullYear(), candidate.getMonth()))
  candidate.setDate(targetDay)
  if (candidate.getTime() >= now) {
    const prev = new Date(now)
    prev.setDate(1)                      // 先归到 1 号，避免"3/31 减一个月"溢出到 3/3
    prev.setMonth(prev.getMonth() - 1)
    const prevTarget = Math.min(schedule.dayOfMonth ?? 1, daysInMonth(prev.getFullYear(), prev.getMonth()))
    candidate.setFullYear(prev.getFullYear(), prev.getMonth(), prevTarget)
  }
  return candidate.getTime()
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

export function evaluateSchedule(trigger: TriggerDefinition, ctx: TriggerContext): TriggerMatch | null {
  const schedule = trigger.schedule
  if (!schedule) return null

  // 首次评估只回溯一分钟：避免初次启用时把历史触发点一次性刷成收件箱
  const from = ctx.lastCheckedAt ?? ctx.now - SCHEDULE_FIRST_LOOKBACK_MS
  const hit = latestHitInWindow(schedule, from, ctx.now)
  if (hit === null) return null

  const desc = describeSchedule(schedule)
  return {
    triggerId: trigger.id,
    title: t('automation.trigger.scheduleTitle').replace('{desc}', desc),
    summary: t('automation.trigger.scheduleSummary')
      .replace('{desc}', desc)
      .replace('{time}', new Date(hit).toLocaleString()),
    evidence: [],
    fingerprint: `schedule:${trigger.id}:${hit}`,
  }
}

// ===== 章节成批（指纹去重） =====

export function evaluateChapterBatch(trigger: TriggerDefinition, ctx: TriggerContext): TriggerMatch | null {
  const batchSize = Math.max(1, trigger.chapterBatchSize ?? DEFAULT_CHAPTER_BATCH_SIZE)
  const nonEmpty = ctx.chapters.filter(c => c.wordCount > 0)
  if (nonEmpty.length < batchSize) return null

  // 取最后一个**完整批**（Denova 同款：batchNumber = floor(非空章节数 / N)）
  const batchNumber = Math.floor(nonEmpty.length / batchSize)
  const batchEnd = batchNumber * batchSize
  const batch = nonEmpty.slice(batchEnd - batchSize, batchEnd)

  const numbers = batch.map(c => c.number)
  const from = numbers[0]
  const to = numbers[numbers.length - 1]
  const totalWords = batch.reduce((s, c) => s + c.wordCount, 0)

  return {
    triggerId: trigger.id,
    title: t('automation.trigger.chapterBatchTitle').replace('{from}', String(from)).replace('{to}', String(to)),
    summary: t('automation.trigger.chapterBatchSummary')
      .replace('{from}', String(from))
      .replace('{to}', String(to))
      .replace('{count}', String(batchSize))
      .replace('{words}', totalWords.toLocaleString()),
    evidence: batch.map(c => ({ source: 'chapter', title: c.title, ref: String(c.number) })),
    // ⚠️ 指纹只含批号与章节号（**不含字数/标题**）——同批内容后续编辑不得再次触发
    fingerprint: `chapter_batch:${trigger.id}:${batchNumber}:${numbers.join(',')}`,
  }
}

// ===== 手动 =====

/** 手动序号：保证同一毫秒内的多次「立即运行」也各有唯一指纹（手动触发本就该每次都执行） */
let manualSeq = 0

export function buildManualMatch(trigger: TriggerDefinition, ctx: TriggerContext): TriggerMatch {
  return {
    triggerId: trigger.id,
    title: t('automation.trigger.manualTitle').replace('{name}', trigger.name ?? trigger.id),
    summary: t('automation.trigger.manualSummary'),
    evidence: [],
    fingerprint: `manual:${trigger.id}:${ctx.now}:${++manualSeq}`,
  }
}
