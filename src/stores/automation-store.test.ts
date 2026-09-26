// @vitest-environment jsdom
/**
 * automation-store × 收件箱三态流转（D 档 T7）
 *
 * 关键不变量：
 * - confirm → 执行成功才转 confirmed 并写 runId；失败写 actionError 且**保持 pending**（可重试）
 * - dismiss → 转 dismissed（不删除，保留证据链）
 * - notify_only 条目**不可执行**（UI 不渲染按钮，store 也拒绝执行）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
const startMock = vi.hoisted(() => vi.fn())

vi.mock('../services/ipc-client', () => ({ ipc: { invoke: invokeMock, isElectron: true } }))
vi.mock('../services/automation/executor', () => ({
  createProductionExecutor: () => ({ start: startMock, isAlive: vi.fn(async () => true) }),
  buildAutomationUserMessage: vi.fn(() => 'msg'),
}))

import { useAutomationStore } from './automation-store'
import type { AutomationTask, InboxItem } from '../services/automation/types'

const TASK: AutomationTask = {
  id: 'a1', name: '每3章后处理', enabled: true,
  targetType: 'workflow', targetRef: '{"type":"post_process"}',
  sessionStrategy: 'per_run',
  triggers: [{ id: 't1', type: 'chapter_batch', enabled: true, chapterBatchSize: 3 }],
  defaultActionPolicy: 'confirm', createdAt: 1, updatedAt: 1,
}

const item = (over: Partial<InboxItem>): InboxItem => ({
  id: 'i1', automationId: 'a1', triggerId: 't1', status: 'pending', actionPolicy: 'confirm',
  title: '第 1-3 章已成批', summary: '可运行后处理',
  evidence: [], fingerprint: 'fp1', createdAt: 1, ...over,
})

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (ch: string) => {
    if (ch === 'db:automation-list') return { success: true, tasks: [TASK] }
    if (ch === 'db:automation-inbox-list') {
      return {
        success: true,
        items: [
          item({}),
          item({ id: 'i2', actionPolicy: 'notify_only', fingerprint: 'fp2' }),
          item({ id: 'i3', status: 'auto_run', actionPolicy: 'auto_run', fingerprint: 'fp3' }),
        ],
      }
    }
    return { success: true }
  })
  startMock.mockReset()
  useAutomationStore.setState({ tasks: [], inbox: [], loading: false })
})

/** 取最后一次指定通道调用的参数 */
const lastCall = (channel: string) => [...invokeMock.mock.calls].reverse().find(c => c[0] === channel)

describe('automation-store', () => {
  it('loadAll 读取任务与收件箱', async () => {
    await useAutomationStore.getState().loadAll()
    expect(useAutomationStore.getState().tasks).toHaveLength(1)
    expect(useAutomationStore.getState().inbox).toHaveLength(3)
  })

  it('confirmInboxItem → 执行成功转 confirmed 并写 runId', async () => {
    startMock.mockResolvedValue({ refId: 'run-9', kind: 'workflow' })
    await useAutomationStore.getState().loadAll()
    await useAutomationStore.getState().confirmInboxItem('i1')
    expect(startMock).toHaveBeenCalledTimes(1)
    const patch = lastCall('db:automation-inbox-update')?.[2] as { status: string; runId: string }
    expect(patch.status).toBe('confirmed')
    // inbox.run_id 指向 automation_runs 记录（不是执行句柄的 refId）
    expect(patch.runId).toBeTruthy()
    const runAppend = lastCall('db:automation-run-append')?.[1] as { refId?: string }
    expect(runAppend.refId).toBe('run-9')
  })

  it('confirmInboxItem 执行失败 → 写 actionError 且保持 pending（可重试）', async () => {
    startMock.mockRejectedValue(new Error('no default model'))
    await useAutomationStore.getState().loadAll()
    await useAutomationStore.getState().confirmInboxItem('i1')
    const patch = lastCall('db:automation-inbox-update')?.[2] as { status: string; actionError: string }
    expect(patch.status).toBe('pending')
    expect(patch.actionError).toContain('no default model')
  })

  it('notify_only 条目 → 拒绝执行（策略选择不被绕过）', async () => {
    await useAutomationStore.getState().loadAll()
    await useAutomationStore.getState().confirmInboxItem('i2')
    expect(startMock).not.toHaveBeenCalled()
    expect(lastCall('db:automation-inbox-update')).toBeUndefined()
  })

  it('dismissInboxItem → 转 dismissed（不删除）', async () => {
    await useAutomationStore.getState().loadAll()
    await useAutomationStore.getState().dismissInboxItem('i1')
    expect(lastCall('db:automation-inbox-update')?.[2]).toMatchObject({ status: 'dismissed' })
  })

  it('runNow → 构造手动触发并走同一执行链', async () => {
    startMock.mockResolvedValue({ refId: 'run-11', kind: 'workflow' })
    await useAutomationStore.getState().loadAll()
    await useAutomationStore.getState().runNow('a1')
    expect(startMock).toHaveBeenCalledTimes(1)
    const [calledTask] = startMock.mock.calls[0] as [AutomationTask, { fingerprint: string }]
    expect(calledTask.id).toBe('a1')
    expect(startMock.mock.calls[0][1].fingerprint.startsWith('manual:t1:')).toBe(true)
    expect(lastCall('db:automation-run-append')).toBeTruthy()
  })

  it('startScheduler / stopScheduler 幂等（重复调用不抛、不重复启动）', () => {
    const s = useAutomationStore.getState()
    expect(() => { s.startScheduler(); s.startScheduler(); s.stopScheduler(); s.stopScheduler() }).not.toThrow()
  })
})
