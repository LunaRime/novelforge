/**
 * runSubAgent（C 档第二轮 T3）——子 agent 运行体。
 * 契约：空白起步（无父历史）；转录与产物可回收；取消/超时/报错都不静默；
 * 注入父端的结果标 untrusted 并截断，回放给全文。
 */
import { describe, it, expect, vi } from 'vitest'
import { runSubAgent, formatSubAgentResult, formatSubAgentTranscript, type SubAgentDeps } from './runner'
import { SUBAGENT_MAX_MS, SUBAGENT_RESULT_MAX_TOKENS, type SubAgentTask } from './types'
import { estimateTokens } from '../token-budget'
import { t } from '../../../shared/locale'

/**
 * 生成函数的测试形态：**必须显式声明形参类型**——
 * `vi.fn(async () => 'ok')` 的元组长度为 0，随后 mock.calls[0][0] 会触发 TS2493
 * （vitest 不做类型检查，只有 tsc 会拦；本项目既有踩坑）。
 */
type GenFn = (messages: { role: string; content: string }[]) => Promise<string>
/** 带流式回调的形态（I3 清洗用例用） */
type GenFn3 = (messages: { role: string; content: string }[], modelId: string, onChunk?: (chunk: string) => void) => Promise<string>

const task = (over: Partial<SubAgentTask> = {}): SubAgentTask =>
  ({ taskId: 'abc123', description: '查玉佩伏笔', prompt: '查清玉佩伏笔', allowedTools: ['read_drafts'], modelId: 'm', ...over })

/** 显式类型（不用 as never：那会掩盖注入签名的漂移） */
const baseDeps = (over: Partial<SubAgentDeps> = {}): SubAgentDeps => ({
  generate: async () => 'ok',
  buildPrompt: async () => 'SUBPROMPT',
  confirm: async () => true,
  ...over,
})

describe('runSubAgent', () => {
  it('正常完成：结论进 result、转录含 user 提示与 assistant 回复、状态 completed', async () => {
    const generate = vi.fn(async () => '玉佩在第 3 章首次出现。')
    const s = await runSubAgent(task(), baseDeps({ generate }))
    expect(s.status).toBe('completed')
    expect(s.result).toContain('玉佩在第 3 章首次出现。')
    expect(s.messages[0]).toMatchObject({ role: 'user', content: '查清玉佩伏笔' })
    expect(s.messages.some(m => m.role === 'assistant' && m.content.includes('玉佩'))).toBe(true)
    expect(s.endedAt).toBeGreaterThanOrEqual(s.startedAt)
  })

  it('空白起步：systemPrompt 用注入的装配结果，消息里没有父历史', async () => {
    const generate = vi.fn<GenFn>(async () => 'ok')
    await runSubAgent(task(), baseDeps({ generate }))
    const firstCall = generate.mock.calls[0][0]
    expect(firstCall[0]).toMatchObject({ role: 'system', content: 'SUBPROMPT' })
    expect(firstCall.filter(m => m.role !== 'system')).toHaveLength(1)   // 只有本轮 user
  })

  it('generateFn 抛错 → failed + 原因，不向上抛（Review Focus 2）', async () => {
    const generate = vi.fn(async () => { throw new Error('model down') })
    const s = await runSubAgent(task(), baseDeps({ generate }))
    expect(s.status).toBe('failed')
    expect(s.error).toContain('model down')
  })

  it('父 signal 取消 → cancelled，转录保留', async () => {
    const ac = new AbortController()
    const generate = vi.fn(async (_m: unknown, _id: string, onChunk?: (c: string) => void) => {
      ac.abort()                       // 模拟「生成中途被取消」
      onChunk?.('半截')
      return '半截'
    })
    const s = await runSubAgent(task(), baseDeps({ generate: generate as never, signal: ac.signal }))
    expect(s.status).toBe('cancelled')
    expect(s.messages.length).toBeGreaterThan(0)
  })

  it('墙钟超时 → failed + 超时原因（用注入的 now 驱动，测试不等待真实时间）', async () => {
    let clock = 0
    const generate = vi.fn(async () => { clock += SUBAGENT_MAX_MS + 1; return 'ok' })
    const s = await runSubAgent(task(), baseDeps({ generate, now: () => clock }))
    expect(s.status).toBe('failed')
    expect(s.error).toBe(t('subagent.timeout'))
  })

  it('工具调用进转录（toolCalls 与 assistant 消息同源）', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce('<tool_call>{"name":"read_drafts","arguments":{"chapter":3}}</tool_call>')
      .mockResolvedValueOnce('结论：玉佩在第 3 章。')
    const s = await runSubAgent(task(), baseDeps({ generate }))
    expect(s.toolCalls.map(c => c.toolName)).toContain('read_drafts')
    expect(s.messages.some(m => (m.toolCalls ?? []).some(tc => tc.toolName === 'read_drafts'))).toBe(true)
  })

  it('onUpdate 被调用，且最后一次是终态（父端据此流式写回 store）', async () => {
    const generate = vi.fn(async () => 'ok')
    const onUpdate = vi.fn()
    await runSubAgent(task(), baseDeps({ generate, onUpdate }))
    expect(onUpdate).toHaveBeenCalled()
    const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as { status: string }
    expect(last.status).toBe('completed')
  })

  it('转录消息数不超上限（MAX_SUBAGENT_MESSAGES）', async () => {
    const many = Array.from({ length: 80 }, (_, i) => `<tool_call>{"name":"read_drafts","arguments":{"chapter":${i}}}</tool_call>`)
    const generate = vi.fn<GenFn>(async (messages) => {
      const idx = messages.filter(m => m.content.includes('<tool_result')).length
      return many[idx] ?? '结论'
    })
    const s = await runSubAgent(task(), baseDeps({ generate }))
    expect(s.messages.length).toBeLessThanOrEqual(60)
  })
})

describe('formatSubAgentResult（untrusted 回收）', () => {
  const mk = (result: string, over = {}) => ({
    id: 'abc123', taskId: 'abc123', description: '查玉佩伏笔', prompt: '', allowedTools: [],
    status: 'completed' as const, messages: [], toolCalls: [], artifacts: [], result, startedAt: 0, endedAt: 1000, ...over,
  })

  it('含 untrusted 标注 + task_id + 回放提示', () => {
    const text = formatSubAgentResult(mk('结论'))
    expect(text).toContain('结论')
    expect(text).toContain('untrusted')
    expect(text).toContain('abc123')
    expect(text).toMatch(/task\(/)
  })

  it('超 1200 tokens 截断（头部/尾部标注另计，故断言留余量）', () => {
    const text = formatSubAgentResult(mk('详'.repeat(3000)))
    expect(estimateTokens(text)).toBeLessThanOrEqual(SUBAGENT_RESULT_MAX_TOKENS + 200)
  })

  it('失败不静默：状态与原因都在文本里（Review Focus 2）', () => {
    const text = formatSubAgentResult(mk('', { status: 'failed', error: 'model down' }))
    expect(text).toContain('model down')
  })

  it('空结论给显式空态（不是空白）', () => {
    expect(formatSubAgentResult(mk(''))).toContain(t('subagent.emptyResult'))
  })
})

describe('formatSubAgentTranscript（task(task_id) 回放）', () => {
  it('给全文转录 + 同样标 untrusted（截断只作用于「回收」，不作用于回放）', () => {
    const long = {
      id: 'abc123', taskId: 'abc123', description: '查玉佩伏笔', prompt: '', allowedTools: [],
      status: 'completed' as const, toolCalls: [], artifacts: [], result: '详'.repeat(3000),
      messages: [
        { id: 'm1', role: 'user' as const, content: '查玉佩', createdAt: 0 },
        { id: 'm2', role: 'assistant' as const, content: '详'.repeat(3000), createdAt: 1 },
      ],
      startedAt: 0, endedAt: 1,
    }
    const text = formatSubAgentTranscript(long)
    expect(text).toContain('untrusted')
    expect(text.length).toBeGreaterThan(3000)     // 未被截断
    expect(text).toContain('查玉佩')
  })

  it('失败的子会话回放也带原因', () => {
    const s = {
      id: 'x', taskId: 'x', description: 'd', prompt: '', allowedTools: [], status: 'failed' as const,
      messages: [], toolCalls: [], artifacts: [], result: '', error: 'model down', startedAt: 0, endedAt: 1,
    }
    expect(formatSubAgentTranscript(s)).toContain('model down')
  })
})

describe('评审修复：写入侧净化与产物合并（C 档第二轮）', () => {
  it('I3：流式 chunk 里的 tool_call/tool_result 标签被清洗（父同口径，否则卡片给用户看 JSON）', async () => {
    const generate = vi.fn<GenFn3>(async (_m, _id, onChunk) => {
      onChunk?.('<tool_call>{"name":"read_drafts","arguments":{"chapter":3}}</tool_call>')
      onChunk?.('玉佩在第 3 章。')
      return '<tool_call>{"name":"read_drafts","arguments":{"chapter":3}}</tool_call>\n玉佩在第 3 章。'
    })
    const s = await runSubAgent(task(), baseDeps({ generate: generate as never }))
    const all = s.messages.map(m => m.content).join('\n')
    expect(all).not.toContain('<tool_call>')
    expect(all).toContain('玉佩在第 3 章。')
  })

  it('I3：onDone 用清洗后的全文重写（跨 chunk 被切开的标签也能清掉）', async () => {
    const generate = vi.fn<GenFn3>(async (_m, _id, onChunk) => {
      onChunk?.('<tool_')            // 半截
      onChunk?.('call>{"name":"x","arguments":{}}</tool_call>')
      return '结论：玉佩在第 3 章。<tool_call>{"name":"x","arguments":{}}</tool_call>'
    })
    const s = await runSubAgent(task(), baseDeps({ generate: generate as never }))
    expect(s.result).not.toContain('<tool_call>')
    expect(s.messages.map(m => m.content).join('\n')).not.toContain('<tool_call>')
  })
})
