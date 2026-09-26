import { describe, it, expect, vi } from 'vitest'
import { createExecutor, buildAutomationUserMessage, withMatchParams, type ExecutorDeps } from './executor'
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

describe('withMatchParams（章节参数注入，评审 Critical 1）', () => {
  const withChapters = {
    ...match,
    evidence: [
      { source: 'chapter', title: '第1章', ref: '1' },
      { source: 'chapter', title: '第2章', ref: '2' },
      { source: 'chapter', title: '第3章', ref: '3' },
    ],
  }

  it('$chapters / $chapterFrom / $chapterTo 按命中章节替换', () => {
    const out = withMatchParams({ chapters: '$chapters', from: '$chapterFrom', to: '$chapterTo' }, withChapters)
    expect(out.chapters).toEqual([1, 2, 3])
    expect(out.from).toBe(1)
    expect(out.to).toBe(3)
  })

  it('嵌套对象与数组内的占位符同样替换；普通文本不受影响', () => {
    const out = withMatchParams({ nested: { list: ['$chapterFrom', 'x'] }, keep: '普通文本' }, withChapters)
    expect((out.nested as { list: unknown[] }).list).toEqual([1, 'x'])
    expect(out.keep).toBe('普通文本')
  })

  it('非章节证据不参与替换（semantic 的 ref 不是章号）', () => {
    const out = withMatchParams({ c: '$chapters' }, { ...match, evidence: [{ source: 'semantic', title: 'x', ref: 'abc' }] })
    expect(out.c).toEqual([])
  })
})
