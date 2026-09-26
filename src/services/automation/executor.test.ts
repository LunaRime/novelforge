import { describe, it, expect, vi } from 'vitest'
import { createExecutor, buildAutomationUserMessage, type ExecutorDeps } from './executor'
import type { AutomationTask, TriggerMatch } from './types'

const task = (over: Partial<AutomationTask> = {}): AutomationTask => ({
  id: 'a1', name: '每3章后处理', enabled: true,
  targetType: 'workflow', targetRef: '{"type":"post_process"}',
  sessionStrategy: 'per_run', triggers: [], defaultActionPolicy: 'confirm',
  createdAt: 1, updatedAt: 1, ...over,
})

const match: TriggerMatch = {
  triggerId: 't1', title: '第 1-3 章已成批', summary: '可运行后处理',
  evidence: [{ source: 'chapter', title: '第1章', ref: '1' }],
  fingerprint: 'fp1',
}

function deps(over: Partial<ExecutorDeps> = {}): ExecutorDeps {
  return {
    startWorkflow: vi.fn(async () => 'run-1'),
    startAgent: vi.fn(async () => 'conv-1'),
    isWorkflowAlive: vi.fn(() => true),
    isConversationAlive: vi.fn(() => true),
    ...over,
  }
}

describe('createExecutor 双目标分派', () => {
  it('workflow 目标 → workflow handle（refId = runId）', async () => {
    const d = deps()
    const h = await createExecutor(d).start(task(), match)
    expect(h).toEqual({ refId: 'run-1', kind: 'workflow' })
    expect(d.startAgent).not.toHaveBeenCalled()
  })

  it('agent 目标 → agent handle（refId = conversationId）', async () => {
    const d = deps()
    const h = await createExecutor(d).start(task({ targetType: 'agent', targetRef: '写下一章' }), match)
    expect(h).toEqual({ refId: 'conv-1', kind: 'agent' })
    expect(d.startWorkflow).not.toHaveBeenCalled()
  })

  it('isAlive 按 kind 分派到对应探活', async () => {
    const d = deps()
    const exec = createExecutor(d)
    await exec.isAlive({ refId: 'run-1', kind: 'workflow' })
    expect(d.isWorkflowAlive).toHaveBeenCalledWith('run-1')
    await exec.isAlive({ refId: 'conv-1', kind: 'agent' })
    expect(d.isConversationAlive).toHaveBeenCalledWith('conv-1')
  })

  it('启动失败向上抛（调用方据此落 actionError，不静默）', async () => {
    const d = deps({ startWorkflow: vi.fn(async () => { throw new Error('no model') }) })
    await expect(createExecutor(d).start(task(), match)).rejects.toThrow('no model')
  })
})

describe('buildAutomationUserMessage', () => {
  it('含任务名、提示词与证据摘要', () => {
    const msg = buildAutomationUserMessage(task({ targetType: 'agent', targetRef: '请续写下一章' }), match)
    expect(msg).toContain('每3章后处理')
    expect(msg).toContain('请续写下一章')
    expect(msg).toContain('第 1-3 章已成批')
    expect(msg).toContain('第1章')
  })

  it('无证据时不渲染证据段', () => {
    const msg = buildAutomationUserMessage(task(), { ...match, evidence: [] })
    expect(msg).not.toContain('相关证据')
  })
})
