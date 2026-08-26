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

describe('SharedContext：压缩摘要附带提取可复用事实（P3）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLlmState.getModelForPurpose.mockReturnValue(null)
    // memory:read shared.md 默认不存在（返回 null）
    mockIpcInvoke.mockResolvedValue(null)
  })

  it('prompt 含提取指令且 [可复用事实] 机器锚点在批文本之后（三语字面量不翻译）', () => {
    const p = buildCcrSummaryPrompt('', '新批内容')
    expect(p).toContain('[可复用事实]')
    expect(p.indexOf('[可复用事实]')).toBeGreaterThan(p.indexOf('新批内容'))
  })

  it('生成成功 → 解析 [可复用事实] → 合并写 shared.md（写失败降级不阻断）', async () => {
    mockLlmState.generate.mockResolvedValue({
      success: true,
      content: '汇总摘要 v1\n\n[可复用事实]\n- 用户偏好爽文节奏\n- 主角名苏晚晴',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedTokens: 0 },
    })
    const summary = await generateConversationSummary({ oldSummary: '', batch: batchMsg, modelId: 'agent-model' })
    expect(summary).toBe('汇总摘要 v1\n\n[可复用事实]\n- 用户偏好爽文节奏\n- 主角名苏晚晴') // 摘要内容不变
    const read = mockIpcInvoke.mock.calls.find(c => c[0] === 'memory:read')
    expect(read).toBeDefined()
    expect(read![1]).toBe('shared.md')
    const write = mockIpcInvoke.mock.calls.find(c => c[0] === 'memory:write')
    expect(write).toBeDefined()
    expect(write![1]).toBe('shared.md')
    expect(write![2]).toContain('- 用户偏好爽文节奏')
    expect(write![2]).toContain('- 主角名苏晚晴')
  })

  it('摘要无 [可复用事实] 段 → 不写 shared.md（幂等）', async () => {
    mockLlmState.generate.mockResolvedValue({
      success: true, content: '纯摘要', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cachedTokens: 0 },
    })
    await generateConversationSummary({ oldSummary: '', batch: batchMsg, modelId: 'agent-model' })
    const writes = mockIpcInvoke.mock.calls.filter(c => c[0] === 'memory:write')
    expect(writes).toHaveLength(0)
  })
})
