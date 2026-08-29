import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runAgentLoop, type LLMMessage, type AgentEngineDeps } from './agent-engine'
import { toolRegistry, buildAgentTool } from './tool-registry'

/** 测试专用纯内存工具名（不触碰 IPC） */
const TEST_TOOL_NAME = 'agent_test_echo'

/** 注册一个纯内存 echo 工具（执行后固定返回成功结果） */
function registerEchoTool(): void {
  toolRegistry.register(
    buildAgentTool({
      name: TEST_TOOL_NAME,
      description: 'test echo tool',
      source: 'builtin',
      inputSchema: { type: 'object', properties: {} },
      requiresConfirmation: false,
      execute: async () => ({ success: true, content: 'echo: ok' }),
    }),
  )
}

/** 构造最小 callbacks（无断言，仅收集调用） */
function createCallbacks() {
  return {
    onTextChunk: vi.fn(),
    onToolCallStart: vi.fn(),
    onToolCallComplete: vi.fn(),
    onToolCallConfirmRequired: vi.fn(async () => false),
    onProgress: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  } as const
}

/**
 * 运行 agent 循环：
 * responses 按序作为每次 LLM 生成的返回值；messagesLog 收集每次 generateFn 收到的消息副本
 * deps 可选（D6-2 写盘引用）：传入 runAgentLoop 第 9 参（8 参 options 由本任务起预留，D7-1 消费）
 */
async function runLoopWithResponses(
  responses: string[],
  deps?: AgentEngineDeps,
): Promise<{ generateFn: ReturnType<typeof vi.fn>; messagesLog: LLMMessage[][]; callbacks: ReturnType<typeof createCallbacks> }> {
  const messagesLog: LLMMessage[][] = []
  const generateFn = vi.fn((messages: LLMMessage[]): Promise<string> => {
    // 浅拷贝快照：compressMessagesToBudget 在预算内返回原数组引用（token-budget.ts:544），
    // 引擎随后仍会继续向其 push 新消息——直接存引用会让 messagesLog 全部别名到循环结束后的最终态
    messagesLog.push([...messages])
    return Promise.resolve(responses.shift() ?? '')
  })
  const callbacks = createCallbacks()
  await runAgentLoop('system prompt', [], '测试用户消息', 'test-model', generateFn, callbacks, undefined, undefined, deps)
  return { generateFn, messagesLog, callbacks }
}

/** 取第 n 次 LLM 调用收到的最后一则 user 消息（即上一轮注入的 observation/诊断） */
function lastUserMessage(messagesLog: LLMMessage[][], callIndex: number): string {
  const messages = messagesLog[callIndex]
  const last = messages[messages.length - 1]
  expect(last.role).toBe('user')
  return last.content
}

describe('agent-engine 工具解析错误反馈', () => {
  // ⚠️ zh-CN 字面量断言说明（H1 补强）：本组用例直接断言诊断文案的中文字面量
  // （如「以下工具调用未能解析，已忽略」「请根据上述诊断修正」）——这些文案来自
  // t('engine.parsePartialDiagnosis')/t('engine.parseDiagnosis') 等 locale 键，测试未 mock
  // locale，输出按当前导出 locale（zh-CN）求值。若 locale 初始化/默认值变化，此类
  // 字面量断言必须同步改为按键值用 t() 计算，防止「i18n 输出受 locale 影响」静默漂移。
  beforeEach(() => {
    registerEchoTool()
  })

  afterEach(() => {
    toolRegistry.unregister(TEST_TOOL_NAME)
  })

  it('部分成功 + 部分解析失败：失败项诊断注入 observation（不再静默）', async () => {
    // 第一轮：一条合法 tool_call + 一条损坏的 tool_call（解析失败）
    const responses = [
      [
        '让我先调用一下工具。',
        '<tool_call>',
        '{"name": "agent_test_echo", "arguments": {"msg": "hello"}}',
        '</tool_call>',
        '<tool_call>',
        '这是损坏的调用，不是 JSON',
        '</tool_call>',
      ].join('\n'),
      // 第二轮：LLM 已看到诊断，正常回答且不再调用工具
      '好的，下面是回答。',
    ]

    const { generateFn, messagesLog, callbacks } = await runLoopWithResponses(responses)

    expect(generateFn).toHaveBeenCalledTimes(2)
    // 第二轮收到的 observation 必须包含「部分解析失败」诊断（此前被静默丢弃）
    const observation = lastUserMessage(messagesLog, 1)
    expect(observation).toContain('以下工具调用未能解析，已忽略')
    expect(observation).toContain('这是损坏的调用，不是 JSON') // 失败项原始内容透出
    expect(observation).toContain('修复建议') // 诊断附带建议
    // 成功的 tool 结果仍保留在 observation 中（未因诊断注入而中断执行链）
    expect(observation).toContain('<tool_result name="agent_test_echo">')
    expect(observation).toContain('echo: ok')
    // 工具真实执行成功
    expect(callbacks.onToolCallComplete).toHaveBeenCalledTimes(1)
    expect(callbacks.onToolCallComplete).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: TEST_TOOL_NAME, status: 'completed' }),
    )
    expect(callbacks.onDone).toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('全失败场景保持既有行为（诊断注入独立消息）', async () => {
    // 第一轮：只有一条损坏的 tool_call（全失败 → 既有独立诊断消息路径）
    const responses = [
      '<tool_call>\n这不是 JSON\n</tool_call>',
      // 第二轮：LLM 修正后正常回答
      '好的，已修正。',
    ]

    const { generateFn, messagesLog, callbacks } = await runLoopWithResponses(responses)

    expect(generateFn).toHaveBeenCalledTimes(2)
    // 全失败时为独立 user 诊断消息（parseDiagnosis 模板，含 {feedback} 展开后文本）
    const diagnosis = lastUserMessage(messagesLog, 1)
    expect(diagnosis).toContain('系统诊断')
    expect(diagnosis).toContain('这不是 JSON')
    expect(diagnosis).toContain('请根据上述诊断修正')
    // 全失败不执行任何工具
    expect(callbacks.onToolCallStart).not.toHaveBeenCalled()
    expect(callbacks.onToolCallComplete).not.toHaveBeenCalled()
    expect(callbacks.onDone).toHaveBeenCalled()
  })

  it('无解析失败不注入诊断', async () => {
    // 第一轮：唯一一条合法 tool_call（无解析错误）→ 正常执行
    const responses = [
      '<tool_call>\n{"name": "agent_test_echo", "arguments": {}}\n</tool_call>',
      '好的，执行完成。',
    ]

    const { generateFn, messagesLog, callbacks } = await runLoopWithResponses(responses)

    expect(generateFn).toHaveBeenCalledTimes(2)
    const observation = lastUserMessage(messagesLog, 1)
    expect(observation).toContain('<tool_result name="agent_test_echo">')
    // 无诊断注入
    expect(observation).not.toContain('解析失败')
    expect(observation).not.toContain('未能解析')
    expect(callbacks.onToolCallComplete).toHaveBeenCalledTimes(1)
    expect(callbacks.onDone).toHaveBeenCalled()
  })
})

describe('空结果占位注入（D6-1）', () => {
  // 成功但 content 为空的工具：runLoopWithResponses 不负责注册工具，
  // 此处自建 empty_tool / blank_tool 并经全局 toolRegistry 注册（参照 registerEchoTool 模式）
  const EMPTY_TOOL_NAME = 'empty_tool'
  const BLANK_TOOL_NAME = 'blank_tool'

  beforeEach(() => {
    toolRegistry.register(
      buildAgentTool({
        name: EMPTY_TOOL_NAME,
        description: 'empty result tool',
        source: 'builtin',
        inputSchema: { type: 'object', properties: {} },
        requiresConfirmation: false,
        execute: async () => ({ success: true, content: '' }),
      }),
    )
    toolRegistry.register(
      buildAgentTool({
        name: BLANK_TOOL_NAME,
        description: 'blank result tool',
        source: 'builtin',
        inputSchema: { type: 'object', properties: {} },
        requiresConfirmation: false,
        execute: async () => ({ success: true, content: ' \n\t  \n ' }),
      }),
    )
  })

  afterEach(() => {
    toolRegistry.unregister(EMPTY_TOOL_NAME)
    toolRegistry.unregister(BLANK_TOOL_NAME)
  })

  it('成功但内容为空的工具 → observation 注入占位文本而非空壳', async () => {
    const { messagesLog, callbacks } = await runLoopWithResponses([
      `<tool_call>{"name":"${EMPTY_TOOL_NAME}","arguments":{}}</tool_call>`,
      '最终回复',
    ])
    const lastUser = messagesLog[messagesLog.length - 1].filter(m => m.role === 'user').at(-1)
    expect(lastUser?.content).toContain(`${EMPTY_TOOL_NAME} 已完成，无输出`)
    expect(lastUser?.content).not.toContain(`<tool_result name="${EMPTY_TOOL_NAME}">\n\n</tool_result>`)
    expect(callbacks.onDone).toHaveBeenCalled()
  })

  it('纯空白内容（含换行/空格）同样注入占位', async () => {
    const { messagesLog } = await runLoopWithResponses([
      `<tool_call>{"name":"${BLANK_TOOL_NAME}","arguments":{}}</tool_call>`,
      '最终回复',
    ])
    const lastUser = messagesLog[messagesLog.length - 1].filter(m => m.role === 'user').at(-1)
    expect(lastUser?.content).toContain('已完成，无输出')
  })
})

describe('长结果写盘引用（D6-2）', () => {
  const LONG_TOOL_NAME = 'long_tool'
  const SHORT_TOOL_NAME = 'short_tool'
  const longContent = '中'.repeat(1200) // 中文 1.5 token/字 ≈ 1800 tokens > 800

  beforeEach(() => {
    toolRegistry.register(
      buildAgentTool({
        name: LONG_TOOL_NAME,
        description: 'long result tool',
        source: 'builtin',
        inputSchema: { type: 'object', properties: {} },
        requiresConfirmation: false,
        execute: async () => ({ success: true, content: longContent }),
      }),
    )
    toolRegistry.register(
      buildAgentTool({
        name: SHORT_TOOL_NAME,
        description: 'short result tool',
        source: 'builtin',
        inputSchema: { type: 'object', properties: {} },
        requiresConfirmation: false,
        execute: async () => ({ success: true, content: 'short: ok' }),
      }),
    )
  })

  afterEach(() => {
    toolRegistry.unregister(LONG_TOOL_NAME)
    toolRegistry.unregister(SHORT_TOOL_NAME)
  })

  it('>800 token 结果 → 写盘 + 注入路径/摘要/总数', async () => {
    const writeResultMock = vi.fn(async () => ({ success: true, path: 'C:\\Users\\test\\.novelforge\\agent-results\\abc123.txt' }))
    const { messagesLog } = await runLoopWithResponses(
      [`<tool_call>{"name":"${LONG_TOOL_NAME}","arguments":{}}</tool_call>`, '最终回复'],
      { writeResult: writeResultMock },
    )
    expect(writeResultMock).toHaveBeenCalledWith(longContent)
    const lastUser = messagesLog[messagesLog.length - 1].filter(m => m.role === 'user').at(-1)
    expect(lastUser?.content).toContain('已写入') // engine.resultSpilledToDisk 中文文案
    expect(lastUser?.content).toContain('abc123.txt')
    expect(lastUser?.content).not.toContain(longContent.slice(0, 500)) // 全文不进上下文
  })

  it('≤800 token 结果 → 不写盘，原样注入', async () => {
    const spy = vi.fn(async () => ({ success: false, error: 'unexpected write' }))
    const { messagesLog } = await runLoopWithResponses(
      [`<tool_call>{"name":"${SHORT_TOOL_NAME}","arguments":{}}</tool_call>`, '最终回复'],
      { writeResult: spy },
    )
    expect(spy).not.toHaveBeenCalled()
    const lastUser = messagesLog[messagesLog.length - 1].filter(m => m.role === 'user').at(-1)
    expect(lastUser?.content).toContain(SHORT_TOOL_NAME)
    expect(lastUser?.content).toContain('short: ok')
  })

  it('写盘失败 → 回退截断注入（降级路径）', async () => {
    const failMock = vi.fn(async () => ({ success: false, error: 'disk full' }))
    const { messagesLog } = await runLoopWithResponses(
      [`<tool_call>{"name":"${LONG_TOOL_NAME}","arguments":{}}</tool_call>`, '最终回复'],
      { writeResult: failMock },
    )
    const lastUser = messagesLog[messagesLog.length - 1].filter(m => m.role === 'user').at(-1)
    expect(lastUser?.content).toContain('<tool_result') // 截断注入形态
  })

  it('未注入 deps → 行为兼容（截断注入）', async () => {
    const { messagesLog } = await runLoopWithResponses([
      `<tool_call>{"name":"${LONG_TOOL_NAME}","arguments":{}}</tool_call>`,
      '最终回复',
    ])
    const lastUser = messagesLog[messagesLog.length - 1].filter(m => m.role === 'user').at(-1)
    expect(lastUser?.content).toContain('<tool_result')
  })

  it('同内容两次 → 写盘调用 content 相同（决策冻结确定性）', async () => {
    // 独立 spy：避免共享 writeResultMock 的调用计数被同 describe 其他用例污染
    // 带参 mock（供 mock.calls[0] 断言）：无参/下划线前缀会被 tsc 或 eslint 判为未使用，用 void 显式引用
    const spy = vi.fn(async (content: string) => { void content; return { success: true, path: 'C:\\Users\\test\\.novelforge\\agent-results\\abc123.txt' } })
    await runLoopWithResponses(
      [
        `<tool_call>{"name":"${LONG_TOOL_NAME}","arguments":{}}</tool_call>`,
        `<tool_call>{"name":"${LONG_TOOL_NAME}","arguments":{}}</tool_call>`,
        '最终回复',
      ],
      { writeResult: spy },
    )
    expect(spy).toHaveBeenCalledTimes(2)
    const [first, second] = spy.mock.calls.map(c => c[0])
    expect(first).toBe(second)
  })
})
