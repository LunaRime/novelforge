import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCcrSummaryPrompt, generateConversationSummary } from './ccr-summary'
import type { AgentMessage } from '../../stores/agent-store'

// mock llm-store 与 ipc-client：generateConversationSummary 失败路径需要断言
// generate 返回值 + db:log-llm-call 落库参数
const { mockLlmState, mockIpcInvoke } = vi.hoisted(() => ({
  mockLlmState: {
    generate: vi.fn(),
    getModelForPurpose: vi.fn(),
    models: [] as Array<{ id: string; name?: string; modelName?: string }>,
  },
  mockIpcInvoke: vi.fn(),
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: { getState: () => mockLlmState },
}))

vi.mock('../ipc-client', () => ({
  ipc: { invoke: mockIpcInvoke },
}))

const batchMsg: AgentMessage[] = [{ id: 'm1', role: 'user', content: '第1条消息', createdAt: 0 }]

describe('buildCcrSummaryPrompt', () => {
  it('含旧摘要时以「旧摘要 + 新批」迭代输入', () => {
    const p = buildCcrSummaryPrompt('旧摘要内容', '新批内容')
    expect(p).toContain('旧摘要内容')
    expect(p).toContain('新批内容')
    // 旧摘要标记与新批标记分离
    expect(p.indexOf('旧摘要内容')).toBeLessThan(p.indexOf('新批内容'))
  })

  it('无旧摘要（首次压缩）时不含旧摘要标记', () => {
    const p = buildCcrSummaryPrompt('', '新批内容')
    expect(p).not.toContain('旧摘要')
    expect(p).toContain('新批内容')
  })
})

describe('generateConversationSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLlmState.models.length = 0
    // 默认：未配置路由 → getModelForPurpose 返回 null → 回退 opts.modelId
    mockLlmState.getModelForPurpose.mockReturnValue(null)
    mockLlmState.generate.mockResolvedValue({
      success: false, error: 'x', content: '', usage: undefined,
    })
  })

  it('生成失败时 throw 且落库 success:0（mock ipc 捕获 db:log-llm-call 参数）', async () => {
    await expect(generateConversationSummary({
      oldSummary: '',
      batch: batchMsg,
      modelId: 'agent-model',
    })).rejects.toThrow('x')

    const logCall = mockIpcInvoke.mock.calls.find(c => c[0] === 'db:log-llm-call')
    expect(logCall).toBeDefined()
    expect(logCall![1]).toMatchObject({
      model_id: 'agent-model',
      purpose: 'ccr_summary',
      success: 0,
      error_message: 'x',
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    })
  })

  it('走 budget 路由：getModelForPurpose(\'summarize\') 优先于 opts.modelId 且落库路由结果', async () => {
    mockLlmState.generate.mockResolvedValue({
      success: true,
      content: '迭代摘要 v1',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedTokens: 0 },
    })
    mockLlmState.getModelForPurpose.mockReturnValue('budget-model')

    const summary = await generateConversationSummary({
      oldSummary: '旧摘要',
      batch: batchMsg,
      modelId: 'agent-model',
    })
    expect(summary).toBe('迭代摘要 v1')
    expect(mockLlmState.generate).toHaveBeenCalledWith(
      [{ role: 'user', content: expect.stringContaining('第1条消息') }],
      'budget-model',
      expect.objectContaining({ temperature: 0.2 }),
    )
    const logCall = mockIpcInvoke.mock.calls.find(c => c[0] === 'db:log-llm-call')
    expect(logCall).toBeDefined()
    expect(logCall![1]).toMatchObject({ model_id: 'budget-model', success: 1 })
  })
})
