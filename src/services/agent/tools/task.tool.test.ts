// @vitest-environment jsdom
/**
 * task 工具（C 档第二轮 T5）——模型侧唯一派发通道。
 * 薄壳契约：参数校验 + 归一（tools 是逗号分隔字符串），编排在 agent-store.runSubAgentTask。
 * 这里用 store 动作 spy 隔离：工具只负责「把什么交给 store、把结果怎么还给模型」。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { taskTool } from './task.tool'
import { useAgentStore } from '../../../stores/agent-store'
import { t } from '../../../shared/locale'
import { registerBuiltinTools } from './index'
import { SUBAGENT_CONFIRM_TIMEOUT_MS, SUBAGENT_MAX_MS } from '../subagent/types'
import type { SubAgentSession } from '../subagent/types'

const sub = (over: Partial<SubAgentSession> = {}): SubAgentSession => ({
  id: 'abc123', taskId: 'abc123', description: '查玉佩', prompt: 'p', allowedTools: [],
  status: 'completed', messages: [{ id: 'm1', role: 'assistant', content: '玉佩结论', createdAt: 0 }],
  toolCalls: [], artifacts: [], result: '玉佩结论', startedAt: 0, endedAt: 1, ...over,
})

const setConv = (subSessions?: SubAgentSession[]): void => {
  useAgentStore.setState({
    conversations: [{
      id: 'c1', title: 'T', messages: [], createdAt: 0, updatedAt: 0, mode: 'quick', modelId: null,
      ...(subSessions ? { subSessions } : {}),
    }],
    activeConversationId: 'c1',
  } as never)
}

beforeEach(() => {
  registerBuiltinTools()   // 工具表要有真工具：M2 的工具名校验与白名单构造都依赖它
  useAgentStore.setState({ conversations: [], activeConversationId: null } as never)
})

describe('task 工具（模型侧通道）', () => {
  it('只读、免确认（派发本身不打扰用户；子 agent 的写操作各自过审批卡）', () => {
    expect(taskTool.requiresConfirmation).toBe(false)
    expect(taskTool.isReadOnly).toBe(true)
  })

  it('无活跃会话 → 失败（不静默）', async () => {
    const res = await taskTool.execute({ description: 'x' })
    expect(res.success).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('description 必填：缺省 → 失败并说明', async () => {
    setConv()
    const res = await taskTool.execute({})
    expect(res.success).toBe(false)
    expect(res.error).toContain('description')
  })

  it('给 task_id → 回放（不派发），同样标 untrusted', async () => {
    setConv([sub()])
    const res = await taskTool.execute({ task_id: 'abc123' })
    expect(res.success).toBe(true)
    expect(res.content).toContain('玉佩结论')
    expect(res.content).toContain('untrusted')
  })

  it('未知 task_id → 失败 + 可用子会话清单', async () => {
    setConv([sub()])
    const res = await taskTool.execute({ task_id: 'nope' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('nope')
    expect(res.error).toContain('abc123')
  })

  it('正常派发：tools 是**逗号分隔字符串**（ToolInputSchema 不支持数组）→ 拆成数组交给 store', async () => {
    setConv()
    const spy = vi.spyOn(useAgentStore.getState(), 'runSubAgentTask').mockResolvedValue({ text: 'RESULT_TEXT', ok: true })
    const res = await taskTool.execute({ description: '查玉佩', prompt: '细节', tools: 'read_drafts, read_memory' })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      description: '查玉佩', prompt: '细节', tools: ['read_drafts', 'read_memory'],
    }))
    expect(res.success).toBe(true)
    expect(res.content).toBe('RESULT_TEXT')
    spy.mockRestore()
  })

  it('tools 缺省 / 全空白 → undefined（交给 store 用默认白名单）', async () => {
    setConv()
    const spy = vi.spyOn(useAgentStore.getState(), 'runSubAgentTask').mockResolvedValue({ text: 'R', ok: true })
    await taskTool.execute({ description: 'x', tools: '  ' })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tools: undefined }))
    spy.mockRestore()
  })

  it('派发失败（store 抛错）→ 工具失败而非静默（Review Focus: 不静默）', async () => {
    setConv()
    const spy = vi.spyOn(useAgentStore.getState(), 'runSubAgentTask').mockRejectedValue(new Error('boom'))
    const res = await taskTool.execute({ description: '查玉佩' })
    expect(res.success).toBe(false)
    expect(String(res.error)).toContain('boom')
    spy.mockRestore()
  })

  it('工具描述声明了边界（看不到对话历史 / 写操作需父确认）', () => {
    expect(taskTool.description).toContain(t('tool.taskDesc').slice(0, 20))
  })
})

describe('评审修复：工具名校验与失败如实上报（C 档第二轮）', () => {
  it('M2：给的工具名全部不存在 → 立即失败并列出可用工具（不白跑一轮）', async () => {
    setConv()
    const spy = vi.spyOn(useAgentStore.getState(), 'runSubAgentTask').mockResolvedValue({ text: 'x', ok: true })
    const res = await taskTool.execute({ description: '查玉佩', tools: '不存在的A,不存在的B' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('不存在的A')
    expect(res.error).toContain('read_drafts')     // 可用集合
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('M2：部分名字不存在 → 照常派发（白名单交集的过滤交给 store）', async () => {
    setConv()
    const spy = vi.spyOn(useAgentStore.getState(), 'runSubAgentTask').mockResolvedValue({ text: 'R', ok: true })
    const res = await taskTool.execute({ description: '查玉佩', tools: 'read_drafts,不存在的A' })
    expect(res.success).toBe(true)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tools: ['read_drafts', '不存在的A'] }))
    spy.mockRestore()
  })

  it('M4：子会话 failed/cancelled → 工具报失败（spec §3.6），但文本不丢（含回放线索）', async () => {
    setConv()
    const spy = vi.spyOn(useAgentStore.getState(), 'runSubAgentTask')
      .mockResolvedValue({ text: 'UNTEXT 失败原因：model down', ok: false })
    const res = await taskTool.execute({ description: '查玉佩' })
    expect(res.success).toBe(false)
    expect(String(res.error)).toContain('model down')
    spy.mockRestore()
  })
})

describe('产物合并与超时契约（spec §3.6 / 评审 C1）', () => {
  it('子 agent 的产物并入工具结果（父消息能看到它改过哪些文件）', async () => {
    setConv()
    const artifacts = [{ type: 'file_modified' as const, path: 'drafts/c30.md', name: 'c30.md' }]
    const spy = vi.spyOn(useAgentStore.getState(), 'runSubAgentTask')
      .mockResolvedValue({ text: 'R', ok: true, artifacts })
    const res = await taskTool.execute({ description: '查玉佩' })
    expect(res.artifacts).toEqual(artifacts)
    spy.mockRestore()
  })

  it('C1 契约：task 的工具级超时必须覆盖子 agent 上限 + 其审批卡等待', () => {
    expect(taskTool.timeoutMs).toBeGreaterThanOrEqual(SUBAGENT_MAX_MS + SUBAGENT_CONFIRM_TIMEOUT_MS)
  })
})
