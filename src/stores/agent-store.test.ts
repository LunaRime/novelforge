// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAgentStore } from './agent-store'
import { useProjectStore } from './project-store'
import { useLLMStore } from './llm-store'
import { readFileTool, clearReadState } from '../services/agent/tools/read-file.tool'
import { detectWritingIntent } from '../services/agent/writing-intent'
import { startChapterWorkflow, WorkflowStartError } from '../services/workflows/workflow-starter'
import { runAgentLoop, type AgentEngineCallbacks, type ToolCallInfo } from '../services/agent/agent-engine'
import { registerBuiltinTools } from '../services/agent/tools'
import { skillRegistry } from '../services/agent/skill-registry'
import { serializeArchive, parseArchive } from '../services/agent/archive-codec'
import { t } from '../shared/locale'
import type { AgentConversation } from './agent-store'

// ===== 意图预路由 mock（A3）：writing-intent / workflow-starter / agent-engine =====
// locale 不 mock（A4 起真实键已齐备）——意图层断言直接用真实 t() 文案

vi.mock('../services/agent/writing-intent', () => ({
  // 默认未命中（与真实 detectWritingIntent 对不含写稿动词的输入行为一致）——既有用例不受影响
  detectWritingIntent: vi.fn(() => ({ kind: 'none' } as const)),
}))

vi.mock('../services/workflows/workflow-starter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/workflows/workflow-starter')>()
  return {
    ...actual,
    startChapterWorkflow: vi.fn(),
    startBlueprintWorkflow: vi.fn(),
    startArchitectureWorkflow: vi.fn(),
  }
})

vi.mock('../services/agent/agent-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/agent/agent-engine')>()
  return {
    ...actual,
    // ReAct 桩：被调用即抛错——sendMessage 的 catch 会复位 generating（与既有用例的终止语义一致），
    // 测试通过「是否被调用」区分预路由命中/未命中
    runAgentLoop: vi.fn(async () => { throw new Error('agent-engine stub: ReAct not implemented') }),
  }
})

// mock IPC（fs:agent-archive-* + fs:read-file 通道）
const archiveFiles = new Map<string, string>()
let deleteCalls: string[] = []
const mockInvoke = vi.fn(async (ch: string, ...args: unknown[]) => {
  switch (ch) {
    case 'fs:agent-archive-list':
      return [...archiveFiles.keys()].map(id => ({ id, title: '会话', updatedAt: 1 }))
    case 'fs:agent-archive-read':
      return archiveFiles.get(String(args[0])) ?? null
    case 'fs:agent-archive-write': {
      archiveFiles.set(String(args[0]), String(args[1]))
      return { success: true }
    }
    case 'fs:agent-archive-delete': {
      deleteCalls.push(String(args[0]))
      archiveFiles.delete(String(args[0]))
      return { success: true }
    }
    case 'fs:read-file':
      return { success: true, content: '长文本内容' }
    // §7.1-C2：压缩保留偏好从全局配置读（逐用例覆写 configResponse）
    case 'config:get':
      return configResponse
    default:
      return null
  }
})

/** §7.1-C2：config:get 的返回值（逐用例覆写） */
let configResponse: unknown = null

beforeEach(() => {
  archiveFiles.clear()
  configResponse = null
  deleteCalls = []
  useAgentStore.setState({ conversations: [], activeConversationId: null })
  // 项目快照 fixture：createConversation 读取 currentProject 写入 projectPath/projectName
  useProjectStore.setState({
    currentProject: {
      id: 'test-project',
      name: '测试项目',
      path: '/tmp/test-project',
      novelConfig: {
        genre: '玄幻',
        subGenre: '东方玄幻',
        targetAudience: '男频',
        totalChapters: 100,
        wordsPerChapter: 2000,
        plotStructure: 'three_act',
        narrativePOV: 'third_limited',
        coreOutline: '',
        worldSetting: '',
        goldenFinger: '',
        protagonistProfile: '',
        globalGuidance: '',
      },
      characterStates: '',
      createdAt: 0,
      updatedAt: 0,
    },
  })
  Object.defineProperty(window, 'velaAPI', { value: { invoke: mockInvoke }, configurable: true })
})

describe('agent-store 持久化', () => {
  it('createConversation 写入项目快照并落盘', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    expect(conv.projectPath).toBeDefined()
    expect(conv.projectName).toBeDefined()
    await vi.waitFor(() => {
      expect(archiveFiles.has(conv.id)).toBe(true)
    })
  })

  it('deleteConversation 同步删除 archive 文件', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.getState().deleteConversation(conv.id)
    await vi.waitFor(() => {
      expect(deleteCalls).toContain(conv.id)
    })
  })

  it('restoreArchives 从 archive 恢复会话列表', async () => {
    const conv = useAgentStore.getState().createConversation({ title: '旧会话' })
    // 仅清内存（不经 clearAll——clearAll 会同步删归档，测试意图是验证 restoreArchives 从 archive 重建列表）
    useAgentStore.setState({ conversations: [], activeConversationId: null })
    await useAgentStore.getState().restoreArchives()
    const restored = useAgentStore.getState().conversations.find(c => c.id === conv.id)
    expect(restored).toBeDefined()
    expect(restored!.title).toBe('旧会话')
  })

  it('损坏 archive 跳过不崩溃', async () => {
    archiveFiles.set('bad', '{bad json')
    await useAgentStore.getState().restoreArchives()
    expect(useAgentStore.getState().conversations).toHaveLength(0)
  })
})

describe('CCR 压缩集成', () => {
  it('历史超预算时最旧批移入 compressed 且 rollingSummary 迭代更新', async () => {
    // 构造超预算会话（12 条 × 每条 cl100k 800 / 启发式 1750 tokens——repeat(30) 在 cl100k 下仅 240/条，
    // 12 条 2880 < 4000 不触发压缩，故用 repeat(100)，两种 tokenizer 路径均稳定超 4000 预算）
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    const longMsgs = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: '这里是历史消息内容占位。'.repeat(100), createdAt: i,
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: longMsgs } : c),
    }))
    // 必要补充：默认模型（否则 sendMessage 因无模型早退，压缩路径不可达）
    useLLMStore.setState({ defaultModelId: 'test-model' })
    // mock 摘要生成（success: true 必要补充——generateConversationSummary 检查 response.success，缺省即抛错走降级）
    const generateMock = vi.fn(async () => ({ success: true, content: '迭代摘要 v1', usage: undefined }))
    useLLMStore.setState({ generate: generateMock as never })

    await useAgentStore.getState().sendMessage('新消息')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.rollingSummary).toBe('迭代摘要 v1')
    expect(after.compressed).toHaveLength(1)
    expect(after.messages.length).toBeLessThan(longMsgs.length)
  })

  it('压缩无收益（摘要比原文还长）→ 不替换历史（可证明性，B 档第二轮）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    const longMsgs = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: '这里是历史消息内容占位。'.repeat(100), createdAt: i,
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: longMsgs } : c),
    }))
    useLLMStore.setState({ defaultModelId: 'test-model' })
    // 摘要比原文还长 → 降幅为负 → degraded → 必须保持原样
    const generateMock = vi.fn(async () => ({ success: true, content: '超长摘要'.repeat(5000), usage: undefined }))
    useLLMStore.setState({ generate: generateMock as never })

    await useAgentStore.getState().sendMessage('新消息')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.compressed ?? []).toHaveLength(0)          // 未产生压缩批次
    expect(after.messages.length).toBeGreaterThanOrEqual(longMsgs.length)   // 历史未被替换
  })

  it('正常压缩 → 原文写分卷、会话不内联原文档（B 档第二轮）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    const longMsgs = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: '这里是历史消息内容占位。'.repeat(100), createdAt: i,
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: longMsgs } : c),
    }))
    useLLMStore.setState({ defaultModelId: 'test-model' })
    const generateMock = vi.fn(async () => ({ success: true, content: '短摘要', usage: undefined }))
    useLLMStore.setState({ generate: generateMock as never })

    await useAgentStore.getState().sendMessage('新消息')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const batch = after.compressed?.[0]
    expect(batch).toBeTruthy()
    expect(batch!.original).toEqual([])              // 不内联（原文在分卷）
    expect(batch!.recoverable).toBe(true)
    expect(batch!.changeTokens).toBeGreaterThan(0)   // 记了真实降幅
    expect(mockInvoke).toHaveBeenCalledWith('fs:agent-archive-original-write', conv.id, expect.any(String))
  })

  it('摘要生成失败时降级硬截断（不阻断对话，rollingSummary 不变）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    const longMsgs = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: '这里是历史消息内容占位。'.repeat(100), createdAt: i,
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: longMsgs } : c),
    }))
    useLLMStore.setState({ defaultModelId: 'test-model' })
    useLLMStore.setState({ generate: vi.fn(async () => { throw new Error('LLM 失败') }) as never })

    await useAgentStore.getState().sendMessage('新消息')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.rollingSummary).toBeUndefined() // 压缩失败未污染摘要
    // 注：压缩失败路径不触碰 compressed（字段保持未设/旧值），?? [] 兼容未初始化的可选字段
    expect(after.compressed ?? []).toHaveLength(0)
    // 对话仍完成（assistant 回复生成中/完成，generating 已复位）
    expect(useAgentStore.getState().generating).toBe(false)
  })

  it('sendMessage 后消息即时落盘（刷新后完整恢复）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    useLLMStore.setState({ generate: vi.fn(async () => { throw new Error('LLM 失败') }) as never })

    await useAgentStore.getState().sendMessage('你好')

    // 直接断言（不用 waitFor）：createConversation 的防抖尾写在 +500ms 也会写入最终态，
    // 只有「消息追加后的即时落盘（leading 写）」才能区分接线是否生效
    const raw = archiveFiles.get(conv.id)
    expect(raw).toBeDefined()
    const restored = JSON.parse(raw!) as { messages: Array<{ role: string; content: string }> }
    expect(restored.messages.some(m => m.role === 'user' && m.content === '你好')).toBe(true)
  })

  it('/clear 清空后同步落盘（重启后已清空消息不复活）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: [{
        id: 'old', role: 'user' as const, content: '旧消息', createdAt: 0,
      }] } : c),
    }))
    // 先手动落盘「旧消息」状态——模拟 /clear 前 archive 里已有历史
    useAgentStore.getState().persistCurrent()

    await useAgentStore.getState().sendMessage('/clear')

    // 直接断言：/clear 的即时落盘必须覆盖旧消息状态（防抖尾写 +500ms 同样会写最终态，
    // 只有即时断言能区分清空接线是否生效）
    const raw = archiveFiles.get(conv.id)
    expect(raw).toBeDefined()
    const restored = JSON.parse(raw!) as { messages: unknown[] }
    expect(restored.messages).toHaveLength(0)
  })
})

describe('read_file 读去重与会话生命周期', () => {
  it('切换会话后 read_file 重复读返回全文（clearReadState 生效）', async () => {
    // 防测试顺序依赖：先全清模块级读去重状态
    clearReadState()
    useAgentStore.getState().createConversation({ title: 'S1' })
    const r1 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r1.content).toContain('长文本内容')
    const r2 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r2.content).toContain('file_unchanged') // 读去重桩命中
    // 切换会话 → clearReadState 全体清空 → 重复读恢复全文（不同上下文应重新全量注入）
    useAgentStore.getState().selectConversation('another-conv-id')
    const r3 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r3.content).toContain('长文本内容')
    expect(r3.content).not.toContain('file_unchanged')
  })

  it('删除活跃会话后 read_file 重复读返回全文（clearReadState 生效）', async () => {
    // 防测试顺序依赖：先全清模块级读去重状态
    clearReadState()
    // 存在第二个会话：删除活跃会话后 activeConversationId 切换到它（镜像 selectConversation 清理用例）
    useAgentStore.getState().createConversation({ title: 'S1' })
    useAgentStore.getState().createConversation({ title: 'S2' })
    const activeId = useAgentStore.getState().activeConversationId!
    const r1 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r1.content).toContain('长文本内容')
    const r2 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r2.content).toContain('file_unchanged') // 读去重桩命中
    // 删除活跃会话（S2）→ 激活 S1 → 读去重状态清空 → 重复读恢复全文
    //（此前 deleteConversation 缺 clearReadState，新活跃会话会收到从未读过的文件的桩）
    useAgentStore.getState().deleteConversation(activeId)
    const r3 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r3.content).toContain('长文本内容')
    expect(r3.content).not.toContain('file_unchanged')
  })
})

describe('审批策略接线（评审 I4：allow/deny 分支此前无测试）', () => {
  const mockRunAgentLoop = vi.mocked(runAgentLoop)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 清理责任：sendMessage 首行有 `if (get().generating) return` 守卫，
  // 本 describe 用桩引擎跑 sendMessage，收尾状态若不复位会把后续用例整片挡掉（实测 18 例连带失败）
  afterEach(() => {
    useAgentStore.setState({ generating: false, conversations: [], activeConversationId: null })
  })

  // 工具注册表需有 read_file（判定 isReadOnly）——模块级注册一次，避免逐用例重复注册刷警告
  registerBuiltinTools()

  /**
   * 捕获引擎回调并直接调用确认门（不跑真实 ReAct）——这正是接线所在：
   * 策略层返回 true=放行 / false=拒绝时，用户不应看到确认卡。
   * 两个分支在同一次 sendMessage 内验证，避免第二次调用受首次残留状态影响。
   */
  it('危险工具 → 拒绝；只读工具 → 放行（都不进确认卡）', async () => {
    const decisions: boolean[] = []
    mockRunAgentLoop.mockImplementationOnce(async (
      _sys: string, _hist: unknown[], _user: string, _model: string, _gen: unknown, callbacks: AgentEngineCallbacks,
    ) => {
      decisions.push(await callbacks.onToolCallConfirmRequired({
        id: 'tc-danger', toolName: 'write_file',
        arguments: { file_path: '.novelforge/x.json', content: 'x' }, status: 'pending',
      } as ToolCallInfo))
      decisions.push(await callbacks.onToolCallConfirmRequired({
        id: 'tc-readonly', toolName: 'read_file',
        arguments: { file_path: 'drafts/ch01.md' }, status: 'pending',
      } as ToolCallInfo))
      return { text: '', toolCalls: [], artifacts: [] } as never
    })

    useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    await useAgentStore.getState().sendMessage('测试接线')

    expect(decisions).toEqual([false, true])
  })
})

describe('/技能名 注入预算（B 档第一轮）', () => {
  const registerSkill = (name: string, content: string) =>
    skillRegistry.register({
      metadata: { name, displayName: `显示-${name}`, description: `描述-${name}`, userInvocable: true },
      content,
      source: 'builtin',
      baseDir: '',
      filePath: `builtin://${name}`,
    })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** 发一条 `/技能名` 并取回注入后的用户消息 */
  async function injectedMessage(skillName: string): Promise<string> {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    await useAgentStore.getState().sendMessage(`/${skillName}`)
    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    return after.messages.find(m => m.role === 'user')?.content ?? ''
  }

  it('超长技能被截断（此前无任何上限）', async () => {
    registerSkill('b-long-skill', '长'.repeat(4000))
    const msg = await injectedMessage('b-long-skill')
    expect(msg.length).toBeGreaterThan(0)
    expect(msg.length).toBeLessThan(4000)
  })

  it('被截断时追加「可用 skill 工具加载全文」提示', async () => {
    registerSkill('b-long-skill-2', '长'.repeat(4000))
    const msg = await injectedMessage('b-long-skill-2')
    expect(msg).toContain('已截断')
    expect(msg).toContain('skill 工具')
  })

  it('未超限时不加提示（既有语义不变）', async () => {
    registerSkill('b-short-skill', '简短技能正文')
    const msg = await injectedMessage('b-short-skill')
    expect(msg).toContain('简短技能正文')
    expect(msg).not.toContain('已截断')
  })
})

describe('压缩产物失效语义（B 档第二轮 T4）', () => {
  /** 构造带一个压缩批次的会话 */
  const withBatch = () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T4' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? {
        ...c,
        messages: [{ id: 'm-live', role: 'user' as const, content: '当前历史', createdAt: 9 }],
        rollingSummary: '旧摘要',
        compressed: [{
          batch: 1, original: [], summary: '批摘要', compressedAt: 1, originalTokens: 100,
          recoverable: true, dependencyHash: '生成时的历史指纹',
        }],
      } : c),
    }))
    return conv.id
  }

  it('历史变更（rewind 等）→ 批次与摘要都标 invalidated', () => {
    withBatch()
    useAgentStore.getState().invalidateCompactions()
    const conv = useAgentStore.getState().conversations[0]
    expect(conv.compressed?.[0].invalidated).toBe(true)
    expect(conv.rollingSummaryInvalidated).toBe(true)
  })

  it('未发生历史变更时不标记（由事件驱动，不误伤）', () => {
    withBatch()
    const conv = useAgentStore.getState().conversations[0]
    expect(conv.compressed?.[0].invalidated).toBeFalsy()
    expect(conv.rollingSummaryInvalidated).toBeFalsy()
  })

  it('无压缩产物的会话不受影响（幂等且安全）', () => {
    useAgentStore.getState().createConversation({ title: '空会话' })
    expect(() => useAgentStore.getState().invalidateCompactions()).not.toThrow()
  })
})

describe('sendMessage 意图预路由', () => {
  const mockDetect = vi.mocked(detectWritingIntent)
  const mockStartChapter = vi.mocked(startChapterWorkflow)
  const mockRunAgentLoop = vi.mocked(runAgentLoop)

  beforeEach(() => {
    // 清理跨用例残留（此前真实/stub 的 runAgentLoop 调用不得泄漏到本 describe）
    vi.clearAllMocks()
  })

  it('强命中写稿意图：不调 runAgentLoop，注入开始消息 + workflow_started 产物', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'chapter_creation', chapter: 3 })
    mockStartChapter.mockResolvedValue({ runId: 'run-1', displayName: '写稿', chapterTag: '第3章' })

    await useAgentStore.getState().sendMessage('写第3章')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    // D5：强命中路径保留用户原文转录 1 次（P0-4 后零出现的缺陷修复）——转录在「已开始」消息之前
    const userMsgs = after.messages.filter(m => m.role === 'user')
    expect(userMsgs).toHaveLength(1)
    expect(userMsgs[0].content).toBe('写第3章')
    expect(after.messages[0].role).toBe('user')
    // 首条用户消息标题合同：强命中会话不再停「新对话」
    expect(after.title).toBe('写第3章')
    const started = after.messages[after.messages.length - 1]
    expect(started.role).toBe('assistant')
    expect(started.content).toContain('已开始')
    expect(started.content).toContain('写稿')
    expect(started.content).toContain('第3章')
    expect(started.artifacts?.[0]).toMatchObject({ type: 'workflow_started', name: '写稿 第3章' })
    expect(mockRunAgentLoop).not.toHaveBeenCalled()
    expect(useAgentStore.getState().generating).toBe(false)
  })

  it('弱命中 hint=chapter：注入 intentClarifyChapter 文案（M2：clarifyChapter 键可达——「帮我写」不再收通用模糊句）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'ambiguous', hint: 'chapter' })

    await useAgentStore.getState().sendMessage('帮我写')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const last = after.messages[after.messages.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toBe(t('agent.intentClarifyChapter'))
    // D5：澄清前保留用户转录 + 首条标题合同（不再停「新对话」）
    expect(after.messages.filter(m => m.role === 'user')[0].content).toBe('帮我写')
    expect(after.title).toBe('帮我写')
    expect(mockStartChapter).not.toHaveBeenCalled()
    expect(mockRunAgentLoop).not.toHaveBeenCalled()
    expect(useAgentStore.getState().generating).toBe(false)
  })

  it('弱命中 hint=character：仍为通用澄清文案（M2 映射：character 不回退 clarifyChapter）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'ambiguous', hint: 'character' })

    await useAgentStore.getState().sendMessage('创建角色')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const last = after.messages[after.messages.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toBe(t('agent.intentClarifyGeneric'))
    // D5：澄清前保留用户转录
    expect(after.messages.filter(m => m.role === 'user')[0].content).toBe('创建角色')
    expect(mockRunAgentLoop).not.toHaveBeenCalled()
    expect(useAgentStore.getState().generating).toBe(false)
  })

  it('未命中：原样走 ReAct（行为不变）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'none' })

    await useAgentStore.getState().sendMessage('看看最近有哪些改动')

    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1)
    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.messages.filter(m => m.role === 'user')[0].content).toBe('看看最近有哪些改动')
  })

  it('`/status 写第三章` 不被预路由抢占：走原 ReAct 链路（无 workflow_started 产物）', async () => {
    // 评审确认缺陷：/status 分支故意 break 穿透（不拦截，作为普通消息让 Agent 处理）——
    // 若预路由对 / 前缀输入生效，读-查询语义会被写工作流吞掉（LLM 费用 + DB 写入 + workflow 状态）
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    // 即便 detectWritingIntent 对「写第三章」返回强命中，/ 前缀守卫也必须短路
    mockDetect.mockReturnValue({ kind: 'chapter_creation', chapter: 3 })
    mockStartChapter.mockResolvedValue({ runId: 'run-1', displayName: '写稿', chapterTag: '第3章' })

    await useAgentStore.getState().sendMessage('/status 写第三章')

    expect(mockDetect).not.toHaveBeenCalled()
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1)
    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.messages.some(m => m.artifacts?.some(a => a.type === 'workflow_started'))).toBe(false)
    expect(after.messages.filter(m => m.role === 'user')[0].content).toBe('/status 写第三章')
  })

  it('character 命中：userMsg.content 为增强内容（原文不重复出现），走 ReAct（P0-4 回归）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'character', name: '苏晚晴', action: 'create' })

    await useAgentStore.getState().sendMessage('创建角色苏晚晴')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const userMsgs = after.messages.filter(m => m.role === 'user')
    expect(userMsgs).toHaveLength(1)
    // P0-4：增强后的完整请求（原文仅出现一次，无重复 append）
    expect(userMsgs[0].content).toBe('创建角色：苏晚晴\n\n创建角色苏晚晴')
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1)
    expect(mockRunAgentLoop.mock.calls[0][2]).toBe('创建角色：苏晚晴\n\n创建角色苏晚晴')
    expect(useAgentStore.getState().generating).toBe(false)
  })

  it('M8：character 增强全文作首条消息 → 标题截取增强句首（「更新角色：苏晚晴」而非吞全文）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'character', name: '苏晚晴', action: 'update' })

    await useAgentStore.getState().sendMessage('修改苏晚晴的角色设定')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    // 增强全文为「更新角色：苏晚晴\n\n修改苏晚晴的角色设定」——M8 首段取「更新角色：苏晚晴」
    expect(after.title).toBe('更新角色：苏晚晴')
  })

  it('M8 负：普通多段用户消息标题不截断（换行折叠为全文，而非仅首段）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'none' })

    await useAgentStore.getState().sendMessage('第一段\n\n第二段')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    // 非增强形态不触发首段截断——若无条件截首段，标题会变成「第一段」
    expect(after.title).toBe('第一段 第二段')
  })

  it('M8 负：/skill 注入消息标题行为不变（全文截断，不因换行截首段）', async () => {
    skillRegistry.register({
      metadata: { name: 'tw', displayName: 'TW', description: 'test skill' },
      content: 'SKILL_BODY',
      source: 'builtin',
      baseDir: '/tmp/skills/tw',
      filePath: '/tmp/skills/tw/SKILL.md',
    })
    try {
      const conv = useAgentStore.getState().createConversation({ title: 'T' })
      useLLMStore.setState({ defaultModelId: 'test-model' })

      await useAgentStore.getState().sendMessage('/tw 嗨')

      const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
      // 注入全文（skillUsed 头 + 换行 + 正文）为标题素材——标题须越过首段（「用户输入」段可见）；
      // 无条件首段截断时标题会被截成「[用户使用了 Skill: TW]」（不含 用户输入）
      expect(after.title).toContain('TW')
      expect(after.title).toContain('用户输入')
    } finally {
      skillRegistry.clear()
    }
  })

  it('工作流启动失败 ERR_GUARD：通用文案 + guard 具体原因（真机反馈：只提示「检查项目配置」不够）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'chapter_creation', chapter: 3 })
    mockStartChapter.mockRejectedValue(new WorkflowStartError('ERR_GUARD', '前置条件失败（guard 明细）'))

    await useAgentStore.getState().sendMessage('写第3章')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const last = after.messages[after.messages.length - 1]
    expect(last.role).toBe('assistant')
    // 具体原因必须回显（否则用户不知道该补什么）
    expect(last.content).toBe(`${t('agent.intentGuardFail')}：前置条件失败（guard 明细）`)
    expect(mockRunAgentLoop).not.toHaveBeenCalled()
    expect(useAgentStore.getState().generating).toBe(false)
  })

  it('ERR_GUARD 只有通用占位（error.prereqNotMet）时不重复啰嗦', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'chapter_creation', chapter: 3 })
    mockStartChapter.mockRejectedValue(new WorkflowStartError('ERR_GUARD', t('error.prereqNotMet')))

    await useAgentStore.getState().sendMessage('写第3章')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const last = after.messages[after.messages.length - 1]
    expect(last.content).toBe(t('agent.intentGuardFail'))
  })

  it('工作流启动失败 ERR_NO_BLUEPRINT：透传 e.message（蓝图缺失文案归因）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'chapter_creation', chapter: 3 })
    const blueprintMissingMsg = '未找到第3章的蓝图数据，请先生成章节蓝图（e.message 透传）'
    mockStartChapter.mockRejectedValue(new WorkflowStartError('ERR_NO_BLUEPRINT', blueprintMissingMsg))

    await useAgentStore.getState().sendMessage('写第3章')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const last = after.messages[after.messages.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toBe(blueprintMissingMsg)
    expect(mockRunAgentLoop).not.toHaveBeenCalled()
    expect(useAgentStore.getState().generating).toBe(false)
  })

  it('refine 意图 ERR_NO_DRAFT：助理消息为 wfNoRefineDraft 修稿语义（I1：e.message 透传不再报「审稿」）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'refine', chapter: 3 })
    const refineNoDraftMsg = t('tool.wfNoRefineDraft').replace('{chapter}', '3')
    mockStartChapter.mockRejectedValue(new WorkflowStartError('ERR_NO_DRAFT', refineNoDraftMsg))

    await useAgentStore.getState().sendMessage('润色第3章')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const last = after.messages[after.messages.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toBe(refineNoDraftMsg)
    expect(mockRunAgentLoop).not.toHaveBeenCalled()
    expect(useAgentStore.getState().generating).toBe(false)
  })

  it('预路由异常兜底：非 WorkflowStartError（startWorkflow 直抛）→ 注入异常消息不 reject、用户转录保留（I2）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'chapter_creation', chapter: 3 })
    mockStartChapter.mockRejectedValue(new Error('startWorkflow 直抛：工作流实例内部异常'))

    // 此前 sendMessage 直接 reject（无错误消息、无用户消息、generating 未置位）——兜底后正常 resolve
    await expect(useAgentStore.getState().sendMessage('写第3章')).resolves.toBeUndefined()

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const last = after.messages[after.messages.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toBe(t('agent.errorException').replace('{error}', 'Error: startWorkflow 直抛：工作流实例内部异常'))
    // D5：错误兜底前转录已 append（用户原文仍保留在历史，顺序为转录在前、异常消息在后）
    expect(after.messages.filter(m => m.role === 'user')).toHaveLength(1)
    expect(after.messages[0].role).toBe('user')
    expect(mockRunAgentLoop).not.toHaveBeenCalled()
    expect(useAgentStore.getState().generating).toBe(false)
  })
})

describe('对话分支 fork/rewind', () => {
  const convId = 'conv-b1'

  // 会话 A：messages [u1, a1, u2, a2]（无 system——按实现过滤，细则用例覆盖）
  const baseConv = (): AgentConversation => ({
    id: convId,
    title: '会话 A',
    messages: [
      { id: 'u1', role: 'user', content: '你好', createdAt: 1 },
      { id: 'a1', role: 'assistant', content: '你好呀', createdAt: 2 },
      { id: 'u2', role: 'user', content: '帮我写第3章', createdAt: 3 },
      { id: 'a2', role: 'assistant', content: '好的', createdAt: 4 },
    ],
    createdAt: 1,
    updatedAt: 4,
    mode: 'deep',
    modelId: null,
  })

  beforeEach(() => {
    useAgentStore.setState({ conversations: [baseConv()], activeConversationId: convId })
  })

  it('forkFromMessage：复制到起点（含）的历史，新会话独立 id + parentId/forkMessageId 标记', () => {
    const newId = useAgentStore.getState().forkFromMessage('u2')
    const forked = useAgentStore.getState().conversations.find(c => c.id === newId)!
    expect(forked.parentId).toBe(convId)
    expect(forked.forkMessageId).toBe('u2')
    // 不含 u2 之后的消息
    expect(forked.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2'])
    expect(forked.id).not.toBe(convId)
    // B4：fork 标题追加三语后缀（zh-CN「（分支）」）——真实键值断言（此前中间态「会话 Aagent.forkSuffix」为键回落），
    // 锁死 B4 键落地行为，防再次回到键名字面量
    expect(forked.title).toBe('会话 A（分支）')
    expect(useAgentStore.getState().activeConversationId).toBe(newId)
  })

  it('fork 复制 compressed/rollingSummary/mode/roleplay，rewound 不复制', () => {
    useAgentStore.setState({
      conversations: [{
        ...baseConv(),
        mode: 'balanced',
        roleplayCharacter: '苏晚晴',
        rollingSummary: '旧摘要',
        compressed: [{
          batch: 1,
          original: [{ id: 'm0', role: 'user', content: '旧消息', createdAt: 0 }],
          summary: '摘要 v1',
          compressedAt: 0,
          originalTokens: 1,
        }],
        rewound: [{ messageId: 'u2', messages: [{ id: 'a2', role: 'assistant', content: '已回退', createdAt: 4 }], rewoundAt: 5 }],
      }],
    })
    const newId = useAgentStore.getState().forkFromMessage('u2')!
    const forked = useAgentStore.getState().conversations.find(c => c.id === newId)!
    expect(forked.mode).toBe('balanced')
    expect(forked.roleplayCharacter).toBe('苏晚晴')
    expect(forked.rollingSummary).toBe('旧摘要')
    expect(forked.compressed).toHaveLength(1)
    expect(forked.rewound).toBeUndefined()
  })

  it('fork 过滤 system 消息（数据干净——生成链路独立构建 system，无影响）', () => {
    useAgentStore.setState({
      conversations: [{
        ...baseConv(),
        messages: [
          { id: 'u1', role: 'user', content: '你好', createdAt: 1 },
          { id: 'sys1', role: 'system', content: '系统提示', createdAt: 2 },
          { id: 'a1', role: 'assistant', content: '你好呀', createdAt: 3 },
          { id: 'sys2', role: 'system', content: '系统提示2', createdAt: 4 },
        ],
      }],
    })
    const newId = useAgentStore.getState().forkFromMessage('a1')!
    const forked = useAgentStore.getState().conversations.find(c => c.id === newId)!
    expect(forked.messages.map(m => m.id)).toEqual(['u1', 'a1'])
    expect(forked.messages.every(m => m.role !== 'system')).toBe(true)
  })

  it('rewindToMessage：截断到起点（含），被截断消息入 rewound 归档', () => {
    const ok = useAgentStore.getState().rewindToMessage('a1')
    expect(ok).toBe(true)
    const conv = useAgentStore.getState().getActiveConversation()!
    expect(conv.messages.map(m => m.id)).toEqual(['u1', 'a1'])
    expect(conv.rewound?.length).toBe(1)
    expect(conv.rewound![0].messages.map(m => m.id)).toEqual(['u2', 'a2'])
  })

  it('restoreRewound：归档 append 回 messages（rewind 可逆）', () => {
    useAgentStore.getState().rewindToMessage('a1')
    const ok = useAgentStore.getState().restoreRewound(0)
    expect(ok).toBe(true)
    const conv = useAgentStore.getState().getActiveConversation()!
    expect(conv.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(conv.rewound?.length).toBe(0) // 恢复后归档清空
  })

  it('restoreRewound 无效索引/无归档：返回 false 不改变状态', () => {
    // 无归档会话：restore 无对象 → false，状态不变
    expect(useAgentStore.getState().restoreRewound(0)).toBe(false)
    const conv = useAgentStore.getState().getActiveConversation()!
    expect(conv.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(conv.rewound).toBeUndefined()
    // 正常 rewind 制造 1 条归档后：越界/负索引 → false，消息与归档均不变（归档不被消费）
    expect(useAgentStore.getState().rewindToMessage('a1')).toBe(true)
    expect(useAgentStore.getState().restoreRewound(5)).toBe(false)
    expect(useAgentStore.getState().restoreRewound(-1)).toBe(false)
    const after = useAgentStore.getState().getActiveConversation()!
    expect(after.messages.map(m => m.id)).toEqual(['u1', 'a1'])
    expect(after.rewound?.length).toBe(1)
    expect(after.rewound![0].messages.map(m => m.id)).toEqual(['u2', 'a2'])
  })

  it('无效 messageId：fork/rewind 返回 null/false 不改变状态', () => {
    expect(useAgentStore.getState().forkFromMessage('not-exist')).toBeNull()
    expect(useAgentStore.getState().rewindToMessage('not-exist')).toBe(false)
    const conv = useAgentStore.getState().getActiveConversation()!
    expect(conv.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('archive 透传：serialize→parse 后 parentId/rewound 保留', () => {
    const newId = useAgentStore.getState().forkFromMessage('u2')!
    const forked = useAgentStore.getState().conversations.find(c => c.id === newId)!
    const raw = serializeArchive(forked)
    const parsed = parseArchive(raw)!
    expect(parsed.parentId).toBe(convId)
    expect(parsed.forkMessageId).toBe('u2')
    // rewind 归档往返：rewind 后 serialize→parse 保留 rewound 结构（fork 已切换活跃会话——切回原会话再回退）
    useAgentStore.getState().selectConversation(convId)
    useAgentStore.getState().rewindToMessage('a1')
    const rewoundConv = useAgentStore.getState().getActiveConversation()!
    const parsedRewound = parseArchive(serializeArchive(rewoundConv))!
    expect(parsedRewound.rewound).toHaveLength(1)
    expect(parsedRewound.rewound![0].messageId).toBe('a1')
    expect(parsedRewound.rewound![0].messages.map(m => m.id)).toEqual(['u2', 'a2'])
  })

  it('fork 过滤 in-flight streaming 占位符（F2：streaming:true 行不复制）', () => {
    useAgentStore.setState({
      conversations: [{
        ...baseConv(),
        messages: [
          { id: 'u1', role: 'user', content: '你好', createdAt: 1 },
          { id: 'u2', role: 'user', content: '继续', createdAt: 2 },
          { id: 'a1', role: 'assistant', content: '生成中', createdAt: 3, streaming: true, toolCalls: [] },
        ],
      }],
    })
    const newId = useAgentStore.getState().forkFromMessage('a1')!
    const forked = useAgentStore.getState().conversations.find(c => c.id === newId)!
    expect(forked.messages.some(m => m.streaming)).toBe(false)
    expect(forked.messages.map(m => m.id)).toEqual(['u1', 'u2'])
  })

  it('rewindToMessage 生成期间守卫（F3：generating 时不截断状态不变）', () => {
    useAgentStore.setState({ generating: true })
    const ok = useAgentStore.getState().rewindToMessage('a1')
    expect(ok).toBe(false)
    const conv = useAgentStore.getState().getActiveConversation()!
    expect(conv.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(conv.rewound).toBeUndefined()
    useAgentStore.setState({ generating: false })
  })

  it('restoreRewound 生成期间守卫（D1：generating 时不恢复，归档不消费——与 F3 对称）', () => {
    // 先正常 rewind 制造归档（generating=false 路径不受影响）
    expect(useAgentStore.getState().rewindToMessage('a1')).toBe(true)
    useAgentStore.setState({ generating: true })
    const ok = useAgentStore.getState().restoreRewound(0)
    expect(ok).toBe(false)
    const conv = useAgentStore.getState().getActiveConversation()!
    expect(conv.messages.map(m => m.id)).toEqual(['u1', 'a1']) // 无 append 回流式会话
    expect(conv.rewound?.length).toBe(1) // 归档保留（不消费）
    useAgentStore.setState({ generating: false })
  })

  it('rewind 到最后一条消息（F6）：无截断内容不产生空 entry', () => {
    const ok = useAgentStore.getState().rewindToMessage('a2')
    expect(ok).toBe(false)
    const conv = useAgentStore.getState().getActiveConversation()!
    expect(conv.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(conv.rewound).toBeUndefined()
  })

  it('parseArchive 损坏 rewound 不 throw（F5：整条过滤/条目内消息净化）', () => {
    const parsed = parseArchive(JSON.stringify({
      id: 'conv-bad-rewound',
      title: '会话',
      messages: [{ id: 'u1', role: 'user', content: '你好', createdAt: 1 }],
      rewound: 'x',
    }))!
    expect(parsed.rewound).toEqual([])
    // 条目缺 messageId / messages 非数组 → 整条过滤；合法条目内坏消息逐条净化
    const parsed2 = parseArchive(JSON.stringify({
      id: 'conv-bad-entry',
      title: '会话2',
      messages: [{ id: 'u1', role: 'user', content: '你好', createdAt: 1 }],
      rewound: [
        { messages: [{ id: 'a1', role: 'assistant', content: 'x', createdAt: 2 }] },
        { messageId: 'u2', messages: 'bad', rewoundAt: 1 },
        { messageId: 'u2', messages: [{ id: 'a2', role: 'assistant', content: 'y', createdAt: 2 }, { id: 'a3', content: 123 }], rewoundAt: 1 },
        null,
      ],
    }))!
    expect(parsed2.rewound).toHaveLength(1)
    expect(parsed2.rewound![0].messageId).toBe('u2')
    expect(parsed2.rewound![0].messages.map(m => m.id)).toEqual(['a2'])
  })
})

// ===== 子 agent 派发（C 档第二轮 T5）=====
// 只替换 runSubAgent（runner 换成假实现），其余（含 store 编排）走真实代码
vi.mock('../services/agent/subagent/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/agent/subagent/runner')>()
  return { ...actual, runSubAgent: vi.fn() }
})

import { runSubAgent } from '../services/agent/subagent/runner'
import type { SubAgentSession } from '../services/agent/subagent/types'
import { computeSubAgentTaskRef, resolveSubAgentTools } from '../services/agent/subagent/taskref'

const runMock = vi.mocked(runSubAgent)

const fakeSession = (over: Partial<SubAgentSession> = {}): SubAgentSession => ({
  id: 't1', taskId: 't1', description: '查玉佩', prompt: '查玉佩', allowedTools: [],
  status: 'completed', messages: [], toolCalls: [], artifacts: [], result: '结论', startedAt: 0, endedAt: 1, ...over,
})

describe('runSubAgentTask（C 档第二轮 T5）', () => {
  // 与 store 同源计算指纹（真实 runner 用传入的 taskId 做会话 id，mock 必须照此契约回填）
  const taskRefFor = (description: string): string =>
    computeSubAgentTaskRef('c1', description, resolveSubAgentTools(undefined))

  beforeEach(() => {
    runMock.mockReset()
    runMock.mockImplementation(async (task) => fakeSession({ id: task.taskId, taskId: task.taskId }))
    useAgentStore.setState({
      conversations: [{ id: 'c1', title: 'T', messages: [], createdAt: 0, updatedAt: 0, mode: 'quick', modelId: 'm' }],
      activeConversationId: 'c1',
    } as never)
  })

  it('幂等：同 description 第二次不重复派发，复用既有结果并附 task_id（Review Focus 6）', async () => {
    const first = await useAgentStore.getState().runSubAgentTask({ description: '查玉佩' })
    const second = await useAgentStore.getState().runSubAgentTask({ description: '查玉佩' })
    expect(runMock).toHaveBeenCalledTimes(1)
    const id = taskRefFor('查玉佩')
    expect(first.text).toContain(id)
    expect(second.text).toContain(id)
    expect(second.text).toContain('untrusted')
  })

  it('running 中重复派发 → 返回「正在执行」提示，不新建', async () => {
    const id = taskRefFor('查玉佩')
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => ({
        ...c, subSessions: [fakeSession({ id, taskId: id, status: 'running', endedAt: undefined })],
      })),
    }))
    const text = await useAgentStore.getState().runSubAgentTask({ description: '查玉佩' })
    expect(text.text).toContain(id)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('工具集归一后指纹稳定：tools 顺序不同 = 同一子会话（不重复派发）', async () => {
    await useAgentStore.getState().runSubAgentTask({ description: 'x', tools: ['read_drafts', 'read_memory'] })
    await useAgentStore.getState().runSubAgentTask({ description: 'x', tools: ['read_memory', 'read_drafts'] })
    expect(runMock).toHaveBeenCalledTimes(1)
  })

  it('取消传播：cancelSubAgent 中止该子 agent 的 signal（父保持生成）', async () => {
    const signals: AbortSignal[] = []
    runMock.mockImplementation(async (task, deps) => {
      signals.push(deps.signal!)
      // 先把会话落到 store（父端 50ms 缓冲同口径），再等取消
      deps.onUpdate?.(fakeSession({ id: task.taskId, taskId: task.taskId, status: 'running' }))
      return new Promise<SubAgentSession>(resolve => {
        const done = (): void => resolve(fakeSession({ id: task.taskId, taskId: task.taskId }))
        deps.signal!.addEventListener('abort', done, { once: true })
        setTimeout(done, 200)
      })
    })
    const p = useAgentStore.getState().runSubAgentTask({ description: 'x' })
    await new Promise(r => setTimeout(r, 80))     // 等 onUpdate 的 50ms 缓冲 flush
    const sessionId = useAgentStore.getState().getActiveConversation()!.subSessions![0].id
    useAgentStore.getState().cancelSubAgent(sessionId)
    expect(signals[0].aborted).toBe(true)
    await p
  })

  it('子会话写进 conversation.subSessions（onUpdate 流式回写也被消费）', async () => {
    runMock.mockImplementation(async (task, deps) => {
      const s = fakeSession({ id: task.taskId, taskId: task.taskId })
      deps.onUpdate?.(s)
      return s
    })
    await useAgentStore.getState().runSubAgentTask({ description: 'x' })
    await new Promise(r => setTimeout(r, 120))   // 等 50ms 缓冲 flush
    expect(useAgentStore.getState().getActiveConversation()!.subSessions).toHaveLength(1)
  })

  it('replaySubAgent：已有会话给全文转录；未知 id 返回 null', async () => {
    const id = taskRefFor('x')
    runMock.mockImplementation(async (task, deps) => {
      const s = fakeSession({ id: task.taskId, taskId: task.taskId })
      deps.onUpdate?.(s)
      return s
    })
    await useAgentStore.getState().runSubAgentTask({ description: 'x' })
    await new Promise(r => setTimeout(r, 120))
    expect(useAgentStore.getState().replaySubAgent(id)).toContain('untrusted')
    expect(useAgentStore.getState().replaySubAgent('nope')).toBeNull()
  })
})

// ===== 子 agent 写操作审批（C 档第二轮 T6）=====
vi.mock('../services/agent/approval', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/agent/approval')>()
  return { ...actual, loadApprovalRules: vi.fn(async () => []) }
})

import { loadApprovalRules, proposeRule, makeRule } from '../services/agent/approval'
import { SUBAGENT_CONFIRM_TIMEOUT_MS } from '../services/agent/subagent/types'
import { registerBuiltinTools as registerForApproval } from '../services/agent/tools'

describe('子 agent 写操作审批（C 档第二轮 T6）', () => {
  const call = (name: string, args: Record<string, unknown> = {}, id = 'tc1'): ToolCallInfo =>
    ({ id, toolName: name, arguments: args, status: 'pending' })
  const ask = (tc: ToolCallInfo, signal?: AbortSignal): Promise<boolean> =>
    useAgentStore.getState().requestSubAgentConfirmation('s1', '查玉佩伏笔', tc, signal)
  /** 等决策层走完（它先 await 读规则，卡在 microtask 之后才 set） */
  const tick = (): Promise<void> => new Promise(r => setTimeout(r, 0))

  beforeEach(() => {
    registerForApproval()
    vi.mocked(loadApprovalRules).mockResolvedValue([])
    useProjectStore.setState({ currentProject: { path: '/mock/proj' } as never })
    useAgentStore.setState({ pendingSubAgentConfirmation: null } as never)
  })

  afterEach(() => {
    useProjectStore.setState({ currentProject: null })
  })

  it('只读工具 → 直接放行，不出卡', async () => {
    await expect(ask(call('read_drafts', { chapter: 3 }))).resolves.toBe(true)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()
  })

  it('critical 命中（路径逃逸）→ 硬拒绝且不出卡（沿用 A 档 fail-closed）', async () => {
    // A 档 matchCritical 的「.. 段使深度 < 0」= 路径逃逸（绝对路径不算逃逸——那是 allowed 分支）
    const res = await ask(call('write_file', { file_path: '../../outside/evil.md', content: 'x' }))
    expect(res).toBe(false)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()
  })

  it('workspace 规则命中 → 放行且不出卡（沿用用户自己的常驻批准）', async () => {
    const args = { file_path: 'drafts/c30.md', content: '正文' }
    const req = {
      projectPath: '/mock/proj', toolName: 'write_file', args,
      descriptor: { requiresConfirmation: true, isReadOnly: false },
      source: 'builtin' as const,
      rules: [],
    }
    const proposal = proposeRule(req)!
    vi.mocked(loadApprovalRules).mockResolvedValue([makeRule(proposal, '/mock/proj', args)])
    await expect(ask(call('write_file', args))).resolves.toBe(true)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()
  })

  it('未覆盖的写操作 → 出卡；允许/拒绝两态；**不写** workspace 规则', async () => {
    const appendSpy = vi.spyOn(await import('../services/agent/approval'), 'appendApprovalRule')
    const allow = ask(call('write_file', { file_path: 'drafts/c30.md', content: 'x' }))
    await tick()   // 决策层要先 await 读规则 → 卡在 microtask 之后才 set
    const card = useAgentStore.getState().pendingSubAgentConfirmation
    expect(card?.toolCall.toolName).toBe('write_file')
    expect(card?.description).toBe('查玉佩伏笔')
    useAgentStore.getState().resolveSubAgentConfirmation(true)
    await expect(allow).resolves.toBe(true)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()
    expect(appendSpy).not.toHaveBeenCalled()

    const deny = ask(call('edit_file', { file_path: 'drafts/c30.md' }, 'tc2'))
    await tick()
    expect(useAgentStore.getState().pendingSubAgentConfirmation).not.toBeNull()
    useAgentStore.getState().resolveSubAgentConfirmation(false)
    await expect(deny).resolves.toBe(false)
  })

  it('超时 → 自动拒绝且卡消失（Review Focus 4：无人场不悬挂）', async () => {
    vi.useFakeTimers()
    const p = ask(call('write_file', { file_path: 'drafts/c30.md' }))
    await Promise.resolve()   // 让决策层的 await 走完（fake timers 不影响 microtask）
    vi.advanceTimersByTime(SUBAGENT_CONFIRM_TIMEOUT_MS + 1)
    await expect(p).resolves.toBe(false)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()
    vi.useRealTimers()
  })

  it('父取消（signal abort）→ 卡消失且 promise 以拒绝收尾（Review Focus 3）', async () => {
    const ac = new AbortController()
    const p = ask(call('write_file', { file_path: 'drafts/c30.md' }), ac.signal)
    await tick()
    expect(useAgentStore.getState().pendingSubAgentConfirmation).not.toBeNull()
    ac.abort()
    await expect(p).resolves.toBe(false)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()
  })
})

describe('派发顺序化与取消传到底（C 档第二轮评审修复）', () => {
  beforeEach(() => {
    runMock.mockReset()
    runMock.mockImplementation(async (task) => fakeSession({ id: task.taskId, taskId: task.taskId }))
    useAgentStore.setState({
      conversations: [{ id: 'c1', title: 'T', messages: [], createdAt: 0, updatedAt: 0, mode: 'quick', modelId: 'm' }],
      activeConversationId: 'c1',
    } as never)
  })

  it('I2：一个子 agent 在跑时，另一个（不同描述的）派发被拒（顺序执行，spec §1.2）', async () => {
    runMock.mockImplementation(async (task, deps) => {
      deps.onUpdate?.(fakeSession({ id: task.taskId, taskId: task.taskId, status: 'running' }))
      return new Promise<SubAgentSession>(resolve => setTimeout(() => resolve(fakeSession({ id: task.taskId, taskId: task.taskId })), 60))
    })
    const first = useAgentStore.getState().runSubAgentTask({ description: '任务A' })
    await new Promise(r => setTimeout(r, 10))
    const second = await useAgentStore.getState().runSubAgentTask({ description: '任务B' })
    expect(second.text).toContain(t('subagent.anotherRunning'))
    expect(runMock).toHaveBeenCalledTimes(1)
    await first
  })

  it('I2：同一指纹并发派发也拦（不重复烧 token）', async () => {
    runMock.mockImplementation(async (task) => new Promise<SubAgentSession>(resolve => setTimeout(() => resolve(fakeSession({ id: task.taskId, taskId: task.taskId })), 60)))
    const first = useAgentStore.getState().runSubAgentTask({ description: '任务A' })
    await new Promise(r => setTimeout(r, 10))
    const second = await useAgentStore.getState().runSubAgentTask({ description: '任务A' })
    expect(second.text).toContain(t('subagent.duplicateRunning').split('{')[0])
    expect(runMock).toHaveBeenCalledTimes(1)
    await first
  })

  it('I5：cancelSubAgent 连底层流式请求一起取消（否则停不下来的 token 燃烧）', async () => {
    const cancelSpy = vi.spyOn(useLLMStore.getState(), 'cancelGeneration').mockResolvedValue(undefined)
    // 模拟真实链路：store 的 generateForSubAgent → llm.generateStream 返回 requestId → 登记
    const streamSpy = vi.spyOn(useLLMStore.getState(), 'generateStream').mockImplementation(async () => 'req-42')
    runMock.mockImplementation(async (task, deps) => {
      void deps.generate([], 'm')   // 不 await：mock 的 generateStream 不会回调 onDone（真实生成才回）
      deps.onUpdate?.(fakeSession({ id: task.taskId, taskId: task.taskId, status: 'running' }))
      // 300ms 才完成：确保取消发生在 finally（它会清掉 requestIds）之前
      return new Promise<SubAgentSession>(resolve => setTimeout(() => resolve(fakeSession({ id: task.taskId, taskId: task.taskId })), 300))
    })
    const p = useAgentStore.getState().runSubAgentTask({ description: '任务A' })
    await new Promise(r => setTimeout(r, 80))   // 等 50ms 缓冲 flush 后才有会话可取消
    const id = useAgentStore.getState().getActiveConversation()!.subSessions![0].id
    useAgentStore.getState().cancelSubAgent(id)
    await p
    expect(cancelSpy).toHaveBeenCalledWith('req-42')
    cancelSpy.mockRestore()
    streamSpy.mockRestore()
  })

  it('M1：signal 已中止 → 立即拒绝且不出卡（不挂幽灵卡）', async () => {
    const ac = new AbortController()
    ac.abort()
    const res = await useAgentStore.getState().requestSubAgentConfirmation(
      's1', 'd', { id: 'tc1', toolName: 'write_file', arguments: { file_path: 'drafts/c30.md' }, status: 'pending' }, ac.signal,
    )
    expect(res).toBe(false)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()
  })
})

// ===== 压缩保留偏好（§7.1-C2）=====
vi.mock('../services/render-logger', () => ({ renderLog: vi.fn() }))

import { renderLog } from '../services/render-logger'

describe('压缩保留偏好（§7.1-C2）', () => {
  const renderLogMock = vi.mocked(renderLog)

  /** 构造会话 + 约 `repeat` 规模的历史（repeat=50 → 启发式 ~1000 tokens/条） */
  const seed = (count: number, repeat: number, batches = 0) => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    const msgs = Array.from({ length: count }, (_, i) => ({
      id: `p${i}`, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: '历史消息占位。'.repeat(repeat), createdAt: i,
    }))
    const compressed = Array.from({ length: batches }, (_, i) => ({
      batch: i + 1, original: [], summary: `旧摘要${i + 1}`, compressedAt: i, originalTokens: 500, recoverable: true,
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: msgs, compressed } : c),
    }))
    return conv
  }

  const setupLlm = (summary = '迭代摘要') => {
    useLLMStore.setState({ defaultModelId: 'test-model' })
    useLLMStore.setState({ generate: vi.fn(async () => ({ success: true, content: summary, usage: undefined })) as never })
  }

  beforeEach(() => {
    renderLogMock.mockClear()
    // 测试卫生（非产品行为）：前置 describe 会把 detectWritingIntent 留成非 none
    //（并可能把 generating 留成 true）——两者都会让本 describe 的 sendMessage 走岔路
    vi.mocked(detectWritingIntent).mockReturnValue({ kind: 'none' })
    useAgentStore.setState({ generating: false })
    setupLlm()
  })

  it('historyMaxTokens 调小 → 同规模历史从「不压」变「压」（偏好真的生效）', async () => {
    // 4 条 × ~1000 tokens ≈ 4000 出头但 < 默认 4000 的触发线？——直接对比两次不同配置更稳
    const a = seed(6, 40)
    configResponse = { compaction: { historyMaxTokens: 32000 } }
    await useAgentStore.getState().sendMessage('新消息')
    expect(useAgentStore.getState().conversations.find(c => c.id === a.id)!.compressed ?? []).toHaveLength(0)

    const b = seed(6, 40)
    configResponse = { compaction: { historyMaxTokens: 1000 } }
    await useAgentStore.getState().sendMessage('新消息')
    expect(useAgentStore.getState().conversations.find(c => c.id === b.id)!.compressed).toHaveLength(1)
  })

  it('minimumChangeTokens 调高 → 跳过压缩并留痕（不静默丢上下文）', async () => {
    const conv = seed(6, 40)
    configResponse = { compaction: { historyMaxTokens: 1000, minimumChangeTokens: 2000 } }
    await useAgentStore.getState().sendMessage('新消息')
    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.compressed ?? []).toHaveLength(0)
    expect(renderLogMock).toHaveBeenCalledWith('warn', 'Agent', expect.any(String))
  })

  it('keepBatches=1 → 只留最新 1 批（更旧的连同分卷释放，卡片消失）', async () => {
    const conv = seed(6, 40, 2)                 // 已有 2 批
    configResponse = { compaction: { historyMaxTokens: 1000, keepBatches: 1 } }
    await useAgentStore.getState().sendMessage('新消息')
    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.compressed).toHaveLength(1)
    expect(after.compressed![0].batch).toBe(3)   // 保留的是新产生的第 3 批
    expect(renderLogMock).toHaveBeenCalledWith('info', 'Agent', expect.any(String))
  })

  it('keepBatches 缺省 0 → 不裁剪（维持「原文永不删」）', async () => {
    const conv = seed(6, 40, 2)
    configResponse = { compaction: { historyMaxTokens: 1000 } }
    await useAgentStore.getState().sendMessage('新消息')
    expect(useAgentStore.getState().conversations.find(c => c.id === conv.id)!.compressed).toHaveLength(3)
  })
})
