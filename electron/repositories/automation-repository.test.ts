/**
 * AutomationRepository 单元测试 — mock getProjectDb 用内存 DB 验证 SQL 逻辑
 *
 * 覆盖（D 档 T1）：schema v18 三表 DDL 的幂等与约束（指纹唯一、级联删除）、
 * 实体的 JSON 字段往返、fail-safe 回落。
 *
 * 注：better-sqlite3 为 Electron 内置 Node 编译（ABI 不兼容系统 Node），
 * 测试用 Node 内置 node:sqlite（DatabaseSync，SQL 语法同源）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { AutomationRepository, AUTOMATION_SCHEMA_SQL } from './automation-repository'
import type { AutomationTask, AutomationRun, InboxItem } from '../../src/services/automation/types'

vi.mock('../database', () => ({
  getProjectDb: () => (globalThis as unknown as { __testDb: DatabaseSync }).__testDb,
}))

let db: DatabaseSync
let repo: AutomationRepository

const TASK: AutomationTask = {
  id: 'a1',
  name: '每3章后处理',
  enabled: true,
  targetType: 'workflow',
  targetRef: 'post_process',
  sessionStrategy: 'per_run',
  triggers: [{ id: 't1', type: 'chapter_batch', enabled: true, chapterBatchSize: 3 }],
  defaultActionPolicy: 'confirm',
  createdAt: 1000,
  updatedAt: 1000,
}

const INBOX: InboxItem = {
  id: 'i1',
  automationId: 'a1',
  triggerId: 't1',
  status: 'pending',
  actionPolicy: 'confirm',
  title: '第 1-3 章已成批',
  summary: '可运行后处理管线',
  evidence: [{ source: 'chapter', title: '第1章', ref: '1' }],
  fingerprint: 'chapter_batch:t1:1:1,2,3',
  createdAt: 2000,
}

const RUN: AutomationRun = {
  id: 'r1',
  automationId: 'a1',
  triggerType: 'chapter_batch',
  targetType: 'workflow',
  status: 'running',
  evidence: [],
  startedAt: 3000,
}

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(AUTOMATION_SCHEMA_SQL)
  ;(globalThis as unknown as { __testDb: DatabaseSync }).__testDb = db
  repo = new AutomationRepository()
})

describe('DDL（schema v18）', () => {
  it('三张表与关键索引存在', () => {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    const names = rows.map(r => r.name)
    expect(names).toContain('automations')
    expect(names).toContain('automation_inbox')
    expect(names).toContain('automation_runs')

    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>)
      .map(r => r.name)
    expect(idx).toContain('idx_automation_inbox_fingerprint')
    expect(idx).toContain('idx_automation_inbox_status')
    expect(idx).toContain('idx_automation_runs_task')
  })

  it('DDL 幂等：重复执行不报错（迁移可重入）', () => {
    expect(() => db.exec(AUTOMATION_SCHEMA_SQL)).not.toThrow()
  })
})

describe('AutomationRepository', () => {
  it('保存后可读回（triggers JSON 往返一致）', () => {
    repo.saveTask(TASK)
    const list = repo.listTasks()
    expect(list).toHaveLength(1)
    expect(list[0].triggers[0].chapterBatchSize).toBe(3)
    expect(list[0].defaultActionPolicy).toBe('confirm')
  })

  it('同一 (automation_id, fingerprint) 的收件箱条目只能插一次（UNIQUE 兜底）', () => {
    repo.saveTask(TASK)
    repo.appendInboxItem(INBOX)
    expect(() => repo.appendInboxItem({ ...INBOX, id: 'i2' })).toThrow()
  })

  it('证据 JSON 往返一致', () => {
    repo.saveTask(TASK)
    repo.appendInboxItem(INBOX)
    expect(repo.listInbox()[0].evidence[0].ref).toBe('1')
  })

  it('删除任务级联删除其收件箱与运行记录', () => {
    repo.saveTask(TASK)
    repo.appendInboxItem(INBOX)
    repo.appendRun(RUN)
    repo.deleteTask('a1')
    expect(repo.listInbox()).toHaveLength(0)
    expect(repo.getRunningRuns()).toHaveLength(0)
  })

  it('getRunningRuns 只返回 running 状态的记录', () => {
    repo.saveTask(TASK)
    repo.appendRun(RUN)
    repo.appendRun({ ...RUN, id: 'r2', status: 'success', finishedAt: 4000 })
    const running = repo.getRunningRuns()
    expect(running).toHaveLength(1)
    expect(running[0].id).toBe('r1')
  })

  it('trigger_state 读回为对象（未写过时为空对象）', () => {
    repo.saveTask(TASK)
    expect(repo.getTriggerState('a1')).toEqual({})
    repo.updateTriggerState('a1', { t1: { lastCheckedAt: 5000, lastFingerprint: 'fp' } })
    expect(repo.getTriggerState('a1').t1.lastFingerprint).toBe('fp')
  })

  it('损坏的 JSON 字段回落默认值（fail-safe，不抛）', () => {
    repo.saveTask(TASK)
    db.exec("UPDATE automations SET triggers = '{broken' WHERE id = 'a1'")
    expect(repo.listTasks()[0].triggers).toEqual([])
  })

  it('updateInboxStatus 写入 status / runId / actionError / handledAt', () => {
    repo.saveTask(TASK)
    repo.appendInboxItem(INBOX)
    repo.updateInboxStatus('i1', { status: 'confirmed', runId: 'r1', handledAt: 9000 })
    const item = repo.listInbox()[0]
    expect(item.status).toBe('confirmed')
    expect(item.runId).toBe('r1')
    expect(item.handledAt).toBe(9000)
  })
})
