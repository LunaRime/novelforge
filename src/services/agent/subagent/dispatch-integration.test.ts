// @vitest-environment jsdom
/**
 * 派发链路的**集成**用例（C 档第二轮评审建议）。
 *
 * 真引擎 → 真 `task` 工具 → 真 store 编排；只把两处**外部边界**换成假实现：
 * runner（等价于 LLM）与 llm-store 的流式通道。
 *
 * 为什么要有它：C1（父引擎 30s 工具超时把 >30s 的子 agent 腰斩）与「工具→store 接线」
 * 这类**跨接缝**缺陷，2112 条单测全程无感——因为每个接缝都被单独 mock 掉了。
 * 这条用例是那类缺陷的第二道网。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runAgentLoop, type LLMMessage, type ToolCallInfo } from '../agent-engine'
import { registerBuiltinTools } from '../tools'
import { useAgentStore } from '../../../stores/agent-store'
import { useProjectStore } from '../../../stores/project-store'
import type { SubAgentSession } from './types'

vi.mock('./runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./runner')>()
  return { ...actual, runSubAgent: vi.fn() }
})

import { runSubAgent } from './runner'
const runMock = vi.mocked(runSubAgent)

const fakeSession = (over: Partial<SubAgentSession> = {}): SubAgentSession => ({
  id: 't1', taskId: 't1', description: '查玉佩伏笔', prompt: '查玉佩伏笔', allowedTools: ['read_drafts'],
  status: 'completed', messages: [
    { id: 'sa-0', role: 'user', content: '查玉佩伏笔', createdAt: 0 },
    { id: 'sa-1', role: 'assistant', content: '玉佩在第 3 章首次出现。', createdAt: 1 },
  ],
  toolCalls: [], artifacts: [], result: '玉佩在第 3 章首次出现。', startedAt: 0, endedAt: 1, ...over,
})

/** 引擎回调桩（收观察文案与工具状态） */
function callbacks(seen: { observations: string[]; statuses: string[] }) {
  return {
    onTextChunk: () => {},
    onToolCallStart: () => {},
    onToolCallComplete: (tc: ToolCallInfo) => { seen.statuses.push(`${tc.toolName}:${tc.status}`) },
    onToolCallConfirmRequired: async () => true,
    onDone: () => {},
    onError: () => {},
  }
}

beforeEach(() => {
  registerBuiltinTools()
  runMock.mockReset()
  runMock.mockImplementation(async (task) => fakeSession({ id: task.taskId, taskId: task.taskId, allowedTools: task.allowedTools }))
  useProjectStore.setState({ currentProject: null })
  useAgentStore.setState({
    conversations: [{ id: 'c1', title: 'T', messages: [], createdAt: 0, updatedAt: 0, mode: 'quick', modelId: 'm' }],
    activeConversationId: 'c1',
    pendingSubAgentConfirmation: null,
  } as never)
})

describe('派发链路集成（引擎 → task → store → runner）', () => {
  it('模型调 task → 子 agent 跑完 → 结论按 untrusted 回注父端，父循环继续', async () => {
    const seen = { observations: [] as string[], statuses: [] as string[] }
    const generate = vi.fn(async (messages: LLMMessage[]) => {
      const last = messages[messages.length - 1].content
      if (!last.includes('<tool_result')) {
        return '<tool_call>{"name":"task","arguments":{"description":"查玉佩伏笔"}}</tool_call>'
      }
      seen.observations.push(last)
      return '好的，结论是玉佩在第 3 章。'
    })

    await runAgentLoop('sys', [], '帮我查伏笔', 'm', generate as never, callbacks(seen))

    expect(runMock).toHaveBeenCalledTimes(1)
    expect(seen.statuses).toContain('task:completed')
    const back = seen.observations.join('\n')
    expect(back).toContain('untrusted')                 // 标注不可信
    expect(back).toContain('玉佩在第 3 章首次出现。')     // 结论真的回来了（C1 的正面断言）
    expect(back).toMatch(/task\(task_id=/)               // 回放线索
  })

  it('子会话写进父会话（50ms 缓冲后可见），描述与工具集进了幂等指纹', async () => {
    const seen = { observations: [] as string[], statuses: [] as string[] }
    const generate = vi.fn(async (messages: LLMMessage[]) => {
      const last = messages[messages.length - 1].content
      if (!last.includes('<tool_result')) {
        return '<tool_call>{"name":"task","arguments":{"description":"查玉佩伏笔","tools":"read_drafts"}}</tool_call>'
      }
      seen.observations.push(last)
      return '好。'
    })
    await runAgentLoop('sys', [], '帮我查伏笔', 'm', generate as never, callbacks(seen))
    await new Promise(r => setTimeout(r, 80))   // 等 50ms 缓冲 flush

    const conv = useAgentStore.getState().getActiveConversation()!
    expect(conv.subSessions).toHaveLength(1)
    expect(conv.subSessions![0].description).toBe('查玉佩伏笔')
    // 白名单 = 只读交集 + 写工具恒在（task 自身结构性排除）
    const allowed = conv.subSessions![0].allowedTools
    expect(allowed).toContain('read_drafts')
    expect(allowed).toContain('write_file')
    expect(allowed).not.toContain('task')
    // 幂等：同描述再派一次不新增会话
    const again = await useAgentStore.getState().runSubAgentTask({ description: '查玉佩伏笔', tools: ['read_drafts'] })
    expect(again.text).toContain('untrusted')
    expect(runMock).toHaveBeenCalledTimes(1)
  })

  it('子 agent 失败 → 工具如实报失败（父端 status=failed，文本仍带原因与回放线索）', async () => {
    runMock.mockImplementation(async (task) => fakeSession({ id: task.taskId, taskId: task.taskId, status: 'failed', error: 'model down', result: '' }))
    const seen = { observations: [] as string[], statuses: [] as string[] }
    const generate = vi.fn(async (messages: LLMMessage[]) => {
      const last = messages[messages.length - 1].content
      if (!last.includes('<tool_result')) {
        return '<tool_call>{"name":"task","arguments":{"description":"查玉佩伏笔"}}</tool_call>'
      }
      seen.observations.push(last)
      return '那我换个办法。'
    })
    await runAgentLoop('sys', [], '帮我查伏笔', 'm', generate as never, callbacks(seen))

    expect(seen.statuses).toContain('task:failed')
    expect(seen.observations.join('\n')).toContain('model down')
  })

  it('task 的工具级超时覆盖确实比全局大（C1 回归钉）', async () => {
    const { taskTool } = await import('../tools/task.tool')
    const { SUBAGENT_MAX_MS, SUBAGENT_CONFIRM_TIMEOUT_MS } = await import('./types')
    expect(taskTool.timeoutMs ?? 0).toBeGreaterThanOrEqual(SUBAGENT_MAX_MS + SUBAGENT_CONFIRM_TIMEOUT_MS)
  })
})
