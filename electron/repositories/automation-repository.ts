/**
 * AutomationRepository — 写作自动化三张表的读写（D 档）
 *
 * 表结构见 docs/superpowers/specs/2026-09-26-writing-automation-design.md §3.1。
 *
 * 设计要点：
 * - `AUTOMATION_SCHEMA_SQL` 是 DDL 的**唯一真相源**：全新建表块、增量迁移、测试三处共用
 * - JSON 字段（triggers / trigger_state / evidence）在读写边界解析，解析失败回落默认值（fail-safe）
 * - 收件箱指纹有 UNIQUE 索引兜底：调度竞态下重复入箱会抛错而不是静默产生重复条目
 * - `applyTriggerOutcome` 是**唯一的事务入口**：指纹推进与产物落库必须一起成功
 */
import type BetterSqlite3 from 'better-sqlite3'
import { getProjectDb } from '../database'
import type {
  AutomationRun,
  AutomationTask,
  InboxItem,
  InboxStatus,
  TriggerMatch,
  TriggerStateMap,
} from '../../src/services/automation/types'

// ===== DDL（单一真相源） =====

export { AUTOMATION_SCHEMA_SQL } from './automation-schema'

// ===== 行映射 =====

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function rowToTask(r: Record<string, unknown>): AutomationTask {
  return {
    id: String(r.id),
    name: String(r.name),
    enabled: Number(r.enabled) === 1,
    targetType: r.target_type === 'agent' ? 'agent' : 'workflow',
    targetRef: String(r.target_ref ?? ''),
    sessionStrategy: r.session_strategy === 'per_task' ? 'per_task' : 'per_run',
    sessionId: (r.session_id as string | null) ?? null,
    triggers: parseJson(r.triggers, []),
    defaultActionPolicy: (r.default_action_policy as AutomationTask['defaultActionPolicy']) ?? 'confirm',
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  }
}

function rowToInboxItem(r: Record<string, unknown>): InboxItem {
  return {
    id: String(r.id),
    automationId: String(r.automation_id),
    triggerId: String(r.trigger_id),
    status: (r.status as InboxStatus) ?? 'pending',
    actionPolicy: (r.action_policy as InboxItem['actionPolicy']) ?? 'confirm',
    title: String(r.title ?? ''),
    summary: String(r.summary ?? ''),
    evidence: parseJson(r.evidence, []),
    fingerprint: String(r.fingerprint ?? ''),
    runId: (r.run_id as string | null) ?? null,
    actionError: (r.action_error as string | null) ?? null,
    createdAt: Number(r.created_at ?? 0),
    readAt: (r.read_at as number | null) ?? null,
    handledAt: (r.handled_at as number | null) ?? null,
  }
}

function rowToRun(r: Record<string, unknown>): AutomationRun {
  return {
    id: String(r.id),
    automationId: String(r.automation_id),
    triggerType: r.trigger_type as AutomationRun['triggerType'],
    targetType: r.target_type === 'agent' ? 'agent' : 'workflow',
    refId: (r.ref_id as string | null) ?? null,
    status: r.status as AutomationRun['status'],
    summary: (r.summary as string | undefined) ?? undefined,
    error: (r.error as string | undefined) ?? undefined,
    evidence: parseJson(r.evidence, []),
    startedAt: Number(r.started_at ?? 0),
    finishedAt: (r.finished_at as number | null) ?? null,
    recoveryState: (r.recovery_state as string | null) ?? null,
  }
}

/** 一次触发处置的完整产物（applyTriggerOutcome 的事务输入） */
export interface TriggerOutcomeInput {
  automationId: string
  /** 该次评估后要写回的 per-trigger 状态（覆盖式） */
  triggerState: TriggerStateMap
  /** 要入箱的条目（可为空：指纹已处置但无新条目时只推进状态） */
  inboxItems: Array<{
    id: string
    triggerId: string
    status: InboxStatus
    actionPolicy: InboxItem['actionPolicy']
    match: TriggerMatch
    /** auto_run 时关联的 run id（由调用方在构造产物时确定，入库前显式带过来） */
    runId?: string | null
  }>
  /** auto_run 策略下同时建 run */
  runs: AutomationRun[]
  now: number
}

// ===== Repository =====

export class AutomationRepository {
  private db(): BetterSqlite3.Database {
    const db = getProjectDb()
    if (!db) throw new Error('project database not open')
    return db
  }

  // ---- 任务 ----

  saveTask(task: AutomationTask): void {
    this.db().prepare(`
      INSERT INTO automations (id, name, enabled, target_type, target_ref, session_strategy, session_id,
                               triggers, default_action_policy, trigger_state, created_at, updated_at)
      VALUES (@id, @name, @enabled, @targetType, @targetRef, @sessionStrategy, @sessionId,
              @triggers, @defaultActionPolicy, COALESCE((SELECT trigger_state FROM automations WHERE id = @id), '{}'),
              @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = @name, enabled = @enabled, target_type = @targetType, target_ref = @targetRef,
        session_strategy = @sessionStrategy, session_id = @sessionId, triggers = @triggers,
        default_action_policy = @defaultActionPolicy, updated_at = @updatedAt
    `).run({
      id: task.id,
      name: task.name,
      enabled: task.enabled ? 1 : 0,
      targetType: task.targetType,
      targetRef: task.targetRef,
      sessionStrategy: task.sessionStrategy,
      sessionId: task.sessionId ?? null,
      triggers: JSON.stringify(task.triggers ?? []),
      defaultActionPolicy: task.defaultActionPolicy,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })
  }

  listTasks(): AutomationTask[] {
    const rows = this.db().prepare('SELECT * FROM automations ORDER BY created_at ASC').all() as Array<Record<string, unknown>>
    return rows.map(rowToTask)
  }

  getTask(id: string): AutomationTask | null {
    const row = this.db().prepare('SELECT * FROM automations WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? rowToTask(row) : null
  }

  deleteTask(id: string): void {
    this.db().prepare('DELETE FROM automations WHERE id = ?').run(id)
  }

  setEnabled(id: string, enabled: boolean, now: number): void {
    this.db().prepare('UPDATE automations SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, now, id)
  }

  /** per_task 会话绑定（首次运行后写回） */
  setSessionId(id: string, sessionId: string): void {
    this.db().prepare('UPDATE automations SET session_id = ? WHERE id = ?').run(sessionId, id)
  }

  // ---- 触发状态 ----

  getTriggerState(automationId: string): TriggerStateMap {
    const row = this.db().prepare('SELECT trigger_state FROM automations WHERE id = ?')
      .get(automationId) as { trigger_state?: string } | undefined
    return parseJson(row?.trigger_state, {}) as TriggerStateMap
  }

  updateTriggerState(automationId: string, state: TriggerStateMap): void {
    this.db().prepare('UPDATE automations SET trigger_state = ? WHERE id = ?')
      .run(JSON.stringify(state ?? {}), automationId)
  }

  // ---- 收件箱 ----

  appendInboxItem(item: InboxItem): void {
    this.db().prepare(`
      INSERT INTO automation_inbox (id, automation_id, trigger_id, status, action_policy, title, summary,
                                    evidence, fingerprint, run_id, action_error, created_at, read_at, handled_at)
      VALUES (@id, @automationId, @triggerId, @status, @actionPolicy, @title, @summary,
              @evidence, @fingerprint, @runId, @actionError, @createdAt, @readAt, @handledAt)
    `).run({
      id: item.id,
      automationId: item.automationId,
      triggerId: item.triggerId,
      status: item.status,
      actionPolicy: item.actionPolicy,
      title: item.title,
      summary: item.summary,
      evidence: JSON.stringify(item.evidence ?? []),
      fingerprint: item.fingerprint,
      runId: item.runId ?? null,
      actionError: item.actionError ?? null,
      createdAt: item.createdAt,
      readAt: item.readAt ?? null,
      handledAt: item.handledAt ?? null,
    })
  }

  listInbox(): InboxItem[] {
    const rows = this.db().prepare('SELECT * FROM automation_inbox ORDER BY created_at DESC').all() as Array<Record<string, unknown>>
    return rows.map(rowToInboxItem)
  }

  updateInboxStatus(id: string, patch: Partial<Pick<InboxItem, 'status' | 'runId' | 'actionError' | 'readAt' | 'handledAt'>>): void {
    const sets: string[] = []
    const params: Record<string, unknown> = { id }
    if (patch.status !== undefined) { sets.push('status = @status'); params.status = patch.status }
    if (patch.runId !== undefined) { sets.push('run_id = @runId'); params.runId = patch.runId }
    if (patch.actionError !== undefined) { sets.push('action_error = @actionError'); params.actionError = patch.actionError }
    if (patch.readAt !== undefined) { sets.push('read_at = @readAt'); params.readAt = patch.readAt }
    if (patch.handledAt !== undefined) { sets.push('handled_at = @handledAt'); params.handledAt = patch.handledAt }
    if (sets.length === 0) return
    this.db().prepare(`UPDATE automation_inbox SET ${sets.join(', ')} WHERE id = @id`).run(params)
  }

  // ---- 运行记录 ----

  appendRun(run: AutomationRun): void {
    this.db().prepare(`
      INSERT INTO automation_runs (id, automation_id, trigger_type, target_type, ref_id, status, summary,
                                   error, evidence, started_at, finished_at, recovery_state)
      VALUES (@id, @automationId, @triggerType, @targetType, @refId, @status, @summary,
              @error, @evidence, @startedAt, @finishedAt, @recoveryState)
    `).run({
      id: run.id,
      automationId: run.automationId,
      triggerType: run.triggerType,
      targetType: run.targetType,
      refId: run.refId ?? null,
      status: run.status,
      summary: run.summary ?? null,
      error: run.error ?? null,
      evidence: JSON.stringify(run.evidence ?? []),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      recoveryState: run.recoveryState ?? null,
    })
  }

  updateRun(id: string, patch: Partial<Pick<AutomationRun, 'refId' | 'status' | 'summary' | 'error' | 'finishedAt' | 'recoveryState'>>): void {
    const sets: string[] = []
    const params: Record<string, unknown> = { id }
    if (patch.refId !== undefined) { sets.push('ref_id = @refId'); params.refId = patch.refId }
    if (patch.status !== undefined) { sets.push('status = @status'); params.status = patch.status }
    if (patch.summary !== undefined) { sets.push('summary = @summary'); params.summary = patch.summary }
    if (patch.error !== undefined) { sets.push('error = @error'); params.error = patch.error }
    if (patch.finishedAt !== undefined) { sets.push('finished_at = @finishedAt'); params.finishedAt = patch.finishedAt }
    if (patch.recoveryState !== undefined) { sets.push('recovery_state = @recoveryState'); params.recoveryState = patch.recoveryState }
    if (sets.length === 0) return
    this.db().prepare(`UPDATE automation_runs SET ${sets.join(', ')} WHERE id = @id`).run(params)
  }

  getRunningRuns(): AutomationRun[] {
    const rows = this.db().prepare("SELECT * FROM automation_runs WHERE status = 'running' ORDER BY started_at DESC")
      .all() as Array<Record<string, unknown>>
    return rows.map(rowToRun)
  }

  listRuns(automationId?: string): AutomationRun[] {
    const rows = (automationId
      ? this.db().prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC').all(automationId)
      : this.db().prepare('SELECT * FROM automation_runs ORDER BY started_at DESC').all()) as Array<Record<string, unknown>>
    return rows.map(rowToRun)
  }

  // ---- 事务入口 ----

  /**
   * 一次触发处置的**唯一写入路径**：推进 trigger_state + 落收件箱条目 + 建 run，同一事务。
   * 任意一步失败则整体回滚 —— 避免"指纹已推进但产物没落库"（丢触发）或
   * "产物落库但指纹没推进"（同一批无限重复入箱）。
   */
  applyTriggerOutcome(input: TriggerOutcomeInput): void {
    const db = this.db()
    // 用显式 BEGIN/COMMIT 而非 better-sqlite3 的 db.transaction()——
    // 后者是驱动专有 API，测试环境的 node:sqlite (DatabaseSync) 没有
    db.exec('BEGIN')
    try {
      this.updateTriggerState(input.automationId, input.triggerState)
      for (const item of input.inboxItems) {
        this.appendInboxItem({
          id: item.id,
          automationId: input.automationId,
          triggerId: item.triggerId,
          status: item.status,
          actionPolicy: item.actionPolicy,
          title: item.match.title,
          summary: item.match.summary,
          evidence: item.match.evidence,
          fingerprint: item.match.fingerprint,
          runId: item.runId ?? null,
          actionError: null,
          createdAt: input.now,
          readAt: null,
          handledAt: item.status === 'auto_run' ? input.now : null,
        })
      }
      for (const run of input.runs) this.appendRun(run)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}

export function createAutomationRepository(): AutomationRepository {
  return new AutomationRepository()
}
