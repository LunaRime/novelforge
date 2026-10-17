// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAgentStore } from './agent-store'
import { useProjectStore } from './project-store'
import { useLLMStore } from './llm-store'
import { useCharacterStore } from './character-store'
import { readFileTool, clearReadState } from '../services/agent/tools/read-file.tool'
import { detectWritingIntent } from '../services/agent/writing-intent'
import { startChapterWorkflow } from '../services/workflows/workflow-starter'
import { runAgentLoop, type AgentEngineCallbacks, type ToolCallInfo } from '../services/agent/agent-engine'
import { registerBuiltinTools } from '../services/agent/tools'
import { skillRegistry } from '../services/agent/skill-registry'
import { serializeArchive, parseArchive } from '../services/agent/archive-codec'
import {
  getLastPrefixText, updatePrefixBaseline, peekPrefixChange, resetPrefixBaseline,
} from '../services/agent/prefix-baseline'
import { t } from '../shared/locale'
import type { AgentConversation } from './agent-store'
import type { ModelProfile } from '../shared/ipc-channels'

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
/** 分卷原文仿真（convId → JSON 文本）；供「分卷真的被释放」的断言 */
const originals = new Map<string, string>()
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
    // 分卷存储仿真（评审 Minor 7：不仿真就读不出「删了」与「从没写过」的区别）
    case 'fs:agent-archive-original-write': {
      originals.set(String(args[0]), String(args[1]))
      return { success: true }
    }
    case 'fs:agent-archive-original-read':
      return { success: true, content: originals.get(String(args[0])) ?? null }
    case 'fs:agent-archive-original-delete':
      originals.delete(String(args[0]))
      return { success: true }
    default:
      return null
  }
})

/** §7.1-C2：config:get 的返回值（逐用例覆写） */
let configResponse: unknown = null

/** DeepSeek V4.1 原生 DSML 工具调用真实形态（双全角竖线 U+FF5C；开标签 calls> 前有空格） */
const dsmlSample = [
  '<｜｜DSML｜｜ calls>',
  '<｜｜DSML｜｜ invoke name="read_file">',
  '<｜｜DSML｜｜ parameter name="file_path" string="true">a.txt</｜｜DSML｜｜ parameter>',
  '</｜｜DSML｜｜ invoke>',
  '</｜｜DSML｜｜ calls>',
].join('\n')

beforeEach(() => {
  archiveFiles.clear()
  originals.clear()
  configResponse = null
  deleteCalls = []
  // 测试卫生：mockInvoke 是模块级 vi.fn —— 不清历史时，后文用 .find() 扫「config:set」的断言
  // 会被**前序用例**的调用满足（假通过）。全局 beforeEach 清一次即可（用例内断言都在动作之后）。
  mockInvoke.mockClear()
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

  it('方案 B：强命中写稿意图不再本地启动——落 ReAct，无 workflow_started 产物', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'chapter_creation', chapter: 3 })

    await useAgentStore.getState().sendMessage('写第3章')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    // 直出退场（方案 B）：不经本地工作流启动；由模型经 start_workflow 工具（确认后）处理
    expect(mockStartChapter).not.toHaveBeenCalled()
    expect(after.messages.some(m => m.artifacts?.some(a => a.type === 'workflow_started'))).toBe(false)
    // 原文恰好 1 次（ReAct 主流程 append）+ 首条标题合同保持
    const userMsgs = after.messages.filter(m => m.role === 'user')
    expect(userMsgs).toHaveLength(1)
    expect(userMsgs[0].content).toBe('写第3章')
    expect(after.title).toBe('写第3章')
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1)
  })

  it('方案 B：refine 强命中（含无章号）落 ReAct——本地澄清一并退场', async () => {
    // 有章号
    useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'refine', chapter: 2 })
    await useAgentStore.getState().sendMessage('润色第2章')
    expect(mockStartChapter).not.toHaveBeenCalled()
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1)

    // 无章号：不再本地回 intentClarifyRefine（拍板 2026-10-02），同样落 ReAct
    useAgentStore.getState().createConversation({ title: 'T' })
    mockDetect.mockReturnValue({ kind: 'refine', chapter: null })
    await useAgentStore.getState().sendMessage('润色一下')
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(2)
  })

  it('方案 B：architecture 强命中落 ReAct（不再本地启动蓝图/架构工作流）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'architecture', target: 'blueprint' })

    await useAgentStore.getState().sendMessage('生成大纲')

    expect(mockStartChapter).not.toHaveBeenCalled()
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1)
    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.messages.some(m => m.artifacts?.some(a => a.type === 'workflow_started'))).toBe(false)
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

  // 注：原「直出 ERR_GUARD / ERR_NO_BLUEPRINT / ERR_NO_DRAFT → 文案映射」四例随方案 B（2026-10-02）删除——
  // 直出退场后启动工作流的唯一入口是 start_workflow 工具，其错误语义映射由 start-workflow.tool.test.ts 覆盖。

  it('预路由异常兜底（I2 沿用）：handleWritingIntent 直抛 → 注入异常消息不 reject', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'ambiguous', hint: 'chapter' })
    // 触发源随方案 B 退役（原 startWorkflow 直抛）——本用例以被 mock 的 handleWritingIntent 直抛验证 sendMessage 兜底契约
    const original = useAgentStore.getState().handleWritingIntent
    useAgentStore.setState({
      handleWritingIntent: vi.fn().mockRejectedValue(new Error('pre-router 直抛：工作流实例内部异常')),
    })

    try {
      // 此前 sendMessage 直接 reject（无错误消息、无用户消息、generating 未置位）——兜底后正常 resolve
      await expect(useAgentStore.getState().sendMessage('帮我写')).resolves.toBeUndefined()

      const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
      const last = after.messages[after.messages.length - 1]
      expect(last.role).toBe('assistant')
      // 线②：错误改走专用 error 字段（Turn 级错误行），不再写正文
      expect(last.error?.message).toBe('Error: pre-router 直抛：工作流实例内部异常')
      expect(mockRunAgentLoop).not.toHaveBeenCalled()
      expect(useAgentStore.getState().generating).toBe(false)
    } finally {
      useAgentStore.setState({ handleWritingIntent: original })
    }
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
import { readBatchOriginal, writeBatchOriginal } from '../services/agent/compaction-originals'

describe('压缩保留偏好（§7.1-C2）', () => {
  const renderLogMock = vi.mocked(renderLog)

  /** 构造会话 + 约 `repeat` 规模的历史（repeat=50 → 启发式 ~1000 tokens/条） */
  const seed = async (count: number, repeat: number, batches = 0) => {
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
    // 预置批次也要**真的写分卷**：否则删除是空操作，断言读到的 null 分不清"删了"与"从没写过"
    for (let i = 1; i <= batches; i++) {
      await writeBatchOriginal(conv.id, i, [{ id: `o`, role: 'user', content: `原文`, createdAt: i }])
    }
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
    const a = await seed(6, 40)
    configResponse = { compaction: { historyMaxTokens: 32000 } }
    await useAgentStore.getState().sendMessage('新消息')
    expect(useAgentStore.getState().conversations.find(c => c.id === a.id)!.compressed ?? []).toHaveLength(0)

    const b = await seed(6, 40)
    configResponse = { compaction: { historyMaxTokens: 1000 } }
    await useAgentStore.getState().sendMessage('新消息')
    expect(useAgentStore.getState().conversations.find(c => c.id === b.id)!.compressed).toHaveLength(1)
  })

  it('minimumChangeTokens 调高 → 跳过压缩并留痕（不静默丢上下文）', async () => {
    const conv = await seed(6, 40)
    configResponse = { compaction: { historyMaxTokens: 1000, minimumChangeTokens: 2000 } }
    await useAgentStore.getState().sendMessage('新消息')
    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.compressed ?? []).toHaveLength(0)
    expect(renderLogMock).toHaveBeenCalledWith('warn', 'Agent', expect.any(String))
  })

  it('C1：学习关闭时最小降幅**逐字**等于用户值（不受持久化倍率影响）；开启才缩放', async () => {
    // 1) 先测出本轮真实降幅 C（minimumChangeTokens: 0 → 必然压缩，压缩批次里记着 changeTokens）
    const probe = await seed(6, 40)
    configResponse = { compaction: { historyMaxTokens: 1000, minimumChangeTokens: 0 } }
    await useAgentStore.getState().sendMessage('新消息')
    const C = useAgentStore.getState().conversations
      .find(c => c.id === probe.id)!.compressed?.[0]?.changeTokens
    expect(typeof C).toBe('number')
    const userValue = (C as number) + 1   // 逐字判定 → 必然跳过（差 1 token）

    // 2) 关闭 + 持久化倍率 0.5：阈值必须仍是 userValue。
    //    若哪天误改成"无条件乘倍率"，阈值会变成 ~C/2 < C → 本轮会被压缩 → 用例红。
    const off = await seed(6, 40)
    configResponse = {
      compaction: { historyMaxTokens: 1000, minimumChangeTokens: userValue },
      compactionLearning: { enabled: false, minChangeFactor: 0.5 },
    }
    await useAgentStore.getState().sendMessage('新消息')
    expect(useAgentStore.getState().conversations.find(c => c.id === off.id)!.compressed ?? []).toHaveLength(0)

    // 3) 开启同一倍率：阈值 userValue×0.5 < C → 压缩（证明倍率确实只在开启时生效）
    const on = await seed(6, 40)
    configResponse = {
      compaction: { historyMaxTokens: 1000, minimumChangeTokens: userValue },
      compactionLearning: { enabled: true, minChangeFactor: 0.5 },
    }
    await useAgentStore.getState().sendMessage('新消息')
    expect(useAgentStore.getState().conversations.find(c => c.id === on.id)!.compressed).toHaveLength(1)
  })

  it('P0-2：跳过后历史仍超预算 → 硬截断留痕（条数 + token 数，不再静默）', async () => {
    const conv = await seed(6, 40)
    configResponse = { compaction: { historyMaxTokens: 1000, minimumChangeTokens: 2000 } }
    await useAgentStore.getState().sendMessage('新消息')
    // 压缩跳过 → 硬截断兜底真正丢消息的那一步：新增独立留痕（文案首段 + 数字）
    expect(renderLogMock).toHaveBeenCalledWith('warn', 'Agent',
      expect.stringContaining(t('ccr.historyTruncated').split('{')[0]))
    // P0-1：观测如实分列（实发 < 面板，两者都非零）
    const obs = useAgentStore.getState().sendObservations[conv.id]
    expect(obs).toBeTruthy()
    expect(obs.panelHistoryTokens).toBeGreaterThan(obs.historySentTokens)
    expect(obs.historySentTokens).toBeGreaterThan(0)
  })

  it('keepBatches=1 → 只留最新 1 批（更旧的连同分卷释放，卡片消失）', async () => {
    const conv = await seed(6, 40, 2)                 // 已有 2 批
    configResponse = { compaction: { historyMaxTokens: 1000, keepBatches: 1 } }
    await useAgentStore.getState().sendMessage('新消息')
    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.compressed).toHaveLength(1)
    expect(after.compressed![0].batch).toBe(3)   // 保留的是新产生的第 3 批
    expect(renderLogMock).toHaveBeenCalledWith('info', 'Agent', expect.stringContaining('释放'))
    // ⚠️ 断言**分卷真的被删**（评审 Minor 7：此前的用例只数数组长度，Important 1 的漏删 bug
    //    因此全绿通过——补上这条即可复现）
    expect(await readBatchOriginal(conv.id, 1)).toBeNull()
    expect(await readBatchOriginal(conv.id, 2)).toBeNull()
    expect(await readBatchOriginal(conv.id, 3)).not.toBeNull()   // 保留集不受影响
  })

  it('keepBatches 缺省 0 → 不裁剪（维持「原文永不删」）', async () => {
    const conv = await seed(6, 40, 2)
    configResponse = { compaction: { historyMaxTokens: 1000 } }
    await useAgentStore.getState().sendMessage('新消息')
    expect(useAgentStore.getState().conversations.find(c => c.id === conv.id)!.compressed).toHaveLength(3)
  })
})

describe('Minor 8：短对话不读配置（省掉无谓的 config:get）', () => {
  beforeEach(() => {
    vi.mocked(detectWritingIntent).mockReturnValue({ kind: 'none' })
    useAgentStore.setState({ generating: false })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    useLLMStore.setState({ generate: vi.fn(async () => ({ success: true, content: 'S', usage: undefined })) as never })
  })

  it('历史远低于任何偏好的下界（1000）→ 压缩路径不读配置（对比长历史那次调用差 ≥1）', async () => {
    // sendMessage 里另有别处也会读 config（RAG 等）→ 用「短 vs 长」两次发送的差值隔离本优化
    const count = (): number => mockInvoke.mock.calls.filter(c => c[0] === 'config:get').length
    const short = useAgentStore.getState().createConversation({ title: 'S' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === short.id
        ? { ...c, messages: [{ id: 'p0', role: 'user' as const, content: '短消息', createdAt: 0 }] } : c),
    }))
    const before = count()
    await useAgentStore.getState().sendMessage('新消息')
    const shortDelta = count() - before

    const long = useAgentStore.getState().createConversation({ title: 'L' })
    // 6 条 × ~400 tokens ≈ 2400 > 钳制下限 1000（够得着任何偏好）
    const longMsgs = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`, role: 'user' as const, content: '历史消息占位。'.repeat(40), createdAt: i,
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === long.id ? { ...c, messages: longMsgs } : c),
    }))
    const before2 = count()
    await useAgentStore.getState().sendMessage('新消息')
    expect(count() - before2).toBeGreaterThan(shortDelta)
  })
})

describe('appendWorkflowCompletion（线② 2b D5：完成回执对话内卡片为主）', () => {
  it('往活跃会话追加 workflow_completed 产物消息（assistant + artifacts）', () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.getState().appendWorkflowCompletion('第1章创作', 'success')
    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const last = after.messages[after.messages.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.artifacts).toHaveLength(1)
    expect(last.artifacts![0].type).toBe('workflow_completed')
    expect(last.artifacts![0].name).toBe('第1章创作')
    expect(last.artifacts![0].metadata).toEqual({ status: 'success' })
  })

  it('无活跃会话（自动化 headless）→ 静默 no-op，不新建会话', () => {
    useAgentStore.setState({ conversations: [], activeConversationId: null })
    useAgentStore.getState().appendWorkflowCompletion('x', 'success')
    expect(useAgentStore.getState().conversations).toHaveLength(0)
  })
})

// ===== P0-1：实发口径观测（预算条「面板 X · 实发 Y」的数据源） =====
describe('P0-1：sendObservations（实发口径，仅内存态）', () => {
  beforeEach(() => {
    vi.mocked(detectWritingIntent).mockReturnValue({ kind: 'none' })
    useAgentStore.setState({ generating: false })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    useLLMStore.setState({ generate: vi.fn(async () => ({ success: true, content: 'S', usage: undefined })) as never })
  })

  /** 构造会话 + 未超预算历史（6×~420 启发式 tokens < 默认 4000 → 无压缩无截断，两口径相等） */
  const seedShort = async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    const msgs = Array.from({ length: 6 }, (_, i) => ({
      id: `o${i}`, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: '历史消息占位。'.repeat(40), createdAt: i,
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: msgs } : c),
    }))
    return conv
  }

  it('发送后写入实发/面板口径；切会话与新建会话后清空（不串数据）', async () => {
    const conv = await seedShort()
    await useAgentStore.getState().sendMessage('新消息')
    const obs = useAgentStore.getState().sendObservations[conv.id]
    expect(obs).toBeTruthy()
    expect(obs.historySentTokens).toBeGreaterThan(0)
    // 未截断：两口径相等（同源数据）；首轮无上轮基线 → 不带 prefix
    expect(obs.panelHistoryTokens).toBe(obs.historySentTokens)
    expect(obs.prefix).toBeUndefined()

    // 切会话（选中另一条）→ 清空
    const other = useAgentStore.getState().createConversation({ title: 'T2' })
    expect(useAgentStore.getState().sendObservations).toEqual({})
    useAgentStore.getState().selectConversation(conv.id)
    expect(useAgentStore.getState().sendObservations).toEqual({})
    useAgentStore.getState().selectConversation(other.id)
    expect(useAgentStore.getState().sendObservations).toEqual({})
  })

  it('前缀基线随会话生命周期重置（新建 / 切换 / 删除 / 全清）——不拿上一会话的前缀比较', () => {
    resetPrefixBaseline()
    const a = useAgentStore.getState().createConversation({ title: 'A' })
    updatePrefixBaseline('AAA-system', 321)
    expect(getLastPrefixText()).toBe('AAA-system')
    expect(peekPrefixChange('BBB-system')).toEqual({ changed: true, sharedChars: 0 })

    useAgentStore.getState().selectConversation(a.id)          // 切换 → 重置
    expect(getLastPrefixText()).toBe('')
    expect(peekPrefixChange('BBB-system')).toBeUndefined()     // 无基线 → 面板不渲染前缀行

    updatePrefixBaseline('AAA-system-2', 1)
    const b = useAgentStore.getState().createConversation({ title: 'B' })   // 新建 → 重置
    expect(getLastPrefixText()).toBe('')

    updatePrefixBaseline('SYSTEM-A3', 1)
    useAgentStore.getState().deleteConversation(b.id)          // 删除 → 重置
    expect(getLastPrefixText()).toBe('')

    updatePrefixBaseline('SYSTEM-A4', 1)
    useAgentStore.getState().clearAll()                        // 全清 → 重置
    expect(getLastPrefixText()).toBe('')
    resetPrefixBaseline()
  })

  it('/clear 清空观测；rewind 等历史变更同样清空', async () => {
    const conv = await seedShort()
    await useAgentStore.getState().sendMessage('新消息')
    expect(useAgentStore.getState().sendObservations[conv.id]).toBeTruthy()
    await useAgentStore.getState().sendMessage('/clear')
    expect(useAgentStore.getState().sendObservations).toEqual({})

    // 历史变更路径：invalidateCompactions（rewind/恢复原文共用入口）也清空
    await useAgentStore.getState().sendMessage('再来一条')
    expect(Object.keys(useAgentStore.getState().sendObservations).length).toBeGreaterThan(0)
    useAgentStore.getState().invalidateCompactions()
    expect(useAgentStore.getState().sendObservations).toEqual({})
  })
})

// ===== W1 批 2：档位策略进入发送链路（真实接线，而非仅纯函数） =====
describe('W1：上下文策略按模型档位进入发送链路', () => {
  const profile = (id: string, contextWindow: number): ModelProfile => ({
    id, name: id, provider: 'openai', protocol: 'openai', modelName: id,
    baseUrl: 'https://example.invalid', temperature: 0.7, maxTokens: 4096, contextWindow,
    purposes: ['generation'],
  })

  beforeEach(() => {
    vi.mocked(detectWritingIntent).mockReturnValue({ kind: 'none' })
    useAgentStore.setState({ generating: false })
    useLLMStore.setState({ generate: vi.fn(async () => ({ success: true, content: 'S', usage: undefined })) as never })
  })

  /** 取最后一次 runAgentLoop 调用的 options（第 8 个实参） */
  const lastEngineOptions = () => {
    const calls = vi.mocked(runAgentLoop).mock.calls
    return calls[calls.length - 1]?.[7] as { maxMessageBudgetTokens?: number; budgetPercent?: number } | undefined
  }

  it('大窗口模型（200k）→ 强档：预算上限按窗口挡位 300K、历史百分比 90', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ models: [profile('big', 200_000)] as never, defaultModelId: 'big' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, modelId: 'big' } : c),
    }))
    vi.mocked(runAgentLoop).mockClear()
    await useAgentStore.getState().sendMessage('写第 1 章')
    const options = lastEngineOptions()
    expect(options?.maxMessageBudgetTokens).toBe(300_000)
    expect(options?.budgetPercent).toBe(90)
  })

  // 2026-10-17 百万上下文时代：预算上限按模型窗口自动分档（<600K→300K、600K–1M→600K、≥1M→1M）
  it('600K 窗口模型 → 600K 挡位；1M 窗口模型 → 1M 挡位', async () => {
    for (const [windowSize, expected] of [[600_000, 600_000], [1_000_000, 1_000_000]] as const) {
      const conv = useAgentStore.getState().createConversation({ title: 'T' })
      const id = `gear-${windowSize}`
      useLLMStore.setState({ models: [profile(id, windowSize)] as never, defaultModelId: id })
      useAgentStore.setState(state => ({
        conversations: state.conversations.map(c => c.id === conv.id ? { ...c, modelId: id } : c),
      }))
      vi.mocked(runAgentLoop).mockClear()
      await useAgentStore.getState().sendMessage('写第 1 章')
      expect(lastEngineOptions()?.maxMessageBudgetTokens, id).toBe(expected)
    }
  })

  it('小窗口模型（32k）→ 弱档：预算上限仍取该窗口带挡位 300K、历史百分比 60', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ models: [profile('small', 32_000)] as never, defaultModelId: 'small' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, modelId: 'small' } : c),
    }))
    vi.mocked(runAgentLoop).mockClear()
    await useAgentStore.getState().sendMessage('写第 1 章')
    const options = lastEngineOptions()
    expect(options?.maxMessageBudgetTokens).toBe(300_000)
    expect(options?.budgetPercent).toBe(60)
  })

  it('用户显式配置优先：手写 budgetPercent 70 不被强档的 90 覆盖', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ models: [profile('big', 200_000)] as never, defaultModelId: 'big' })
    // ⚠️ 必须喂够历史：`config:get` 只在 totalHistoryTokens > 1000 时才读（评审 Minor 8 的性能优化，
    //    短对话每次发消息多一次同步 readFileSync+parse 纯属浪费）——历史太短时策略缺省生效属预期
    const msgs = Array.from({ length: 8 }, (_, i) => ({
      id: `h${i}`, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: '历史消息占位。'.repeat(60), createdAt: i,
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, modelId: 'big', messages: msgs } : c),
    }))
    configResponse = { compaction: { budgetPercent: 70 } }
    vi.mocked(runAgentLoop).mockClear()
    await useAgentStore.getState().sendMessage('写第 1 章')
    expect(lastEngineOptions()?.budgetPercent).toBe(70)
    // 上限仍按窗口挡位（上限是安全边界，不是用户偏好）
    expect(lastEngineOptions()?.maxMessageBudgetTokens).toBe(300_000)
  })

  it('短对话不读配置（性能优化）：策略缺省生效，不因此报错', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ models: [profile('big', 200_000)] as never, defaultModelId: 'big' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, modelId: 'big' } : c),
    }))
    configResponse = { compaction: { budgetPercent: 70 } }
    vi.mocked(runAgentLoop).mockClear()
    await useAgentStore.getState().sendMessage('写第 1 章')
    expect(lastEngineOptions()?.budgetPercent).toBe(90)   // 未读配置 → 用强档缺省
  })
})

// ===== P1-3：regenerateBatchSummary（移除压缩 / rewind 后的摘要修复路径） =====
describe('P1-3：regenerateBatchSummary', () => {
  beforeEach(() => {
    vi.mocked(detectWritingIntent).mockReturnValue({ kind: 'none' })
    useAgentStore.setState({ generating: false })
    useLLMStore.setState({ defaultModelId: 'test-model' })
  })

  /** 构造带 2 个可恢复批次 + 分卷原文的会话 */
  const seedBatches = async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    const compressed = [1, 2].map(i => ({
      batch: i, original: [], summary: `旧摘要${i}`, compressedAt: i, originalTokens: 500, recoverable: true,
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id
        ? {
            ...c,
            compressed,
            rollingSummary: '链式旧摘要',
            messages: [{ id: 'm0', role: 'user' as const, content: '现存历史', createdAt: 0 }],
          }
        : c),
    }))
    for (const i of [1, 2]) {
      await writeBatchOriginal(conv.id, i, [{ id: `o${i}`, role: 'user', content: `第${i}批原文`, createdAt: i }])
    }
    return conv
  }

  it('移除批次 → 摘要失效 → 重生成：以分卷原文为唯一输入，恢复 M1 注入', async () => {
    const conv = await seedBatches()
    await useAgentStore.getState().removeCompaction(2)
    let after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.rollingSummaryInvalidated).toBe(true)   // 移除后摘要失效（不再注入）

    const generateMock = vi.fn(
      async (messages: Array<{ role: string; content: string }>, modelId?: string, opts?: unknown) => {
        void modelId
        void opts
        return { success: messages.length > 0, content: '重生成摘要 v2', usage: undefined }
      },
    )
    useLLMStore.setState({ generate: generateMock as never })
    const err = await useAgentStore.getState().regenerateBatchSummary(1)
    expect(err).toBeNull()   // 成功 → null（卡片据此清除内联提示）

    after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.compressed).toHaveLength(1)
    expect(after.compressed![0].summary).toBe('重生成摘要 v2')
    expect(after.compressed![0].invalidated).toBe(false)
    expect(after.rollingSummary).toBe('重生成摘要 v2')          // 摘要恢复注入（失效标记清除）
    expect(after.rollingSummaryInvalidated).toBe(false)
    // 唯一输入语义：prompt 含该批原文、不含其余批次内容
    const messagesArg = generateMock.mock.calls[0][0] as Array<{ content: string }>
    expect(messagesArg[0].content).toContain('第1批原文')
    expect(messagesArg[0].content).not.toContain('第2批原文')
    // 历史未被改动（重生成只动摘要）
    expect(after.messages.some(m => m.content === '现存历史')).toBe(true)
  })

  it('生成失败 → 留痕且不污染状态（批次摘要保持原样）', async () => {
    const conv = await seedBatches()
    const renderLogMock = vi.mocked(renderLog)
    useLLMStore.setState({ generate: vi.fn(async () => { throw new Error('LLM 挂了') }) as never })
    const err = await useAgentStore.getState().regenerateBatchSummary(1)
    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.compressed![0].summary).toBe('旧摘要1')
    // 失败必须**返回可展示文案**（卡片内联提示；此前只能去 LogsView 找）+ 留痕
    // 断言用错误正文（语言无关）而非按中文标点切前缀
    expect(err).toContain('LLM 挂了')
    expect(renderLogMock).toHaveBeenCalledWith('error', 'Agent', expect.stringContaining('LLM 挂了'))
  })

  it('分卷不可用（recoverable=false）→ 可读错误，不产生状态变化', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id
        ? { ...c, compressed: [{ batch: 1, original: [], summary: '旧', compressedAt: 0, originalTokens: 500, recoverable: false }] }
        : c),
    }))
    const renderLogMock = vi.mocked(renderLog)
    const err = await useAgentStore.getState().regenerateBatchSummary(1)
    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.compressed![0].summary).toBe('旧')
    expect(renderLogMock).toHaveBeenCalledWith('error', 'Agent', t('ccr.regenerateNoOriginal'))
    expect(err).toBe(t('ccr.regenerateNoOriginal'))   // 失败文案返回给卡片内联展示
  })

  it('自学习：重生成同样注入激活规则提示（规则此前只作用于自动压缩）', async () => {
    await seedBatches()
    configResponse = {
      compactionLearning: { enabled: true, rules: [{ id: 'keep-characters', active: true, evidence: 2 }] },
    }
    const generateMock = vi.fn(
      async (messages: Array<{ role: string; content: string }>) =>
        ({ success: messages.length > 0, content: '带提示摘要', usage: undefined }),
    )
    useLLMStore.setState({ generate: generateMock as never })

    await useAgentStore.getState().regenerateBatchSummary(1)

    const prompt = (generateMock.mock.calls[0][0] as Array<{ content: string }>)[0].content
    expect(prompt).toContain(t('ccr.learnedHintsHeader'))
    expect(prompt).toContain(t('ccr.learnHintKeepCharacters'))
  })

  it('自学习：移除压缩 / 重生成 → 统计积分并落盘（开启时；此前零覆盖）', async () => {
    await seedBatches()
    configResponse = { compactionLearning: { enabled: true, stats: { reverts: 0, regenerations: 0 } } }
    useLLMStore.setState({ generate: vi.fn(async () => ({ success: true, content: '重生成摘要 x', usage: undefined })) as never })

    await useAgentStore.getState().removeCompaction(2)
    await useAgentStore.getState().regenerateBatchSummary(1)

    await vi.waitFor(() => {
      const writes = mockInvoke.mock.calls
        .filter(c => c[0] === 'config:set'
          && (c[1] as Record<string, unknown> | undefined)?.compactionLearning !== undefined)
        .map(c => (c[1] as {
          compactionLearning: { stats: { reverts: number; regenerations: number } }
        }).compactionLearning)
      expect(writes.some(w => w.stats.reverts === 1)).toBe(true)
      expect(writes.some(w => w.stats.regenerations === 1)).toBe(true)
    })
  })

  it('生成中（generating）不可重生成（与 rewind 同款守卫）', async () => {
    const conv = await seedBatches()
    useAgentStore.setState({ generating: true })
    const generateMock = vi.fn(async () => ({ success: true, content: 'X', usage: undefined }))
    useLLMStore.setState({ generate: generateMock as never })
    await useAgentStore.getState().regenerateBatchSummary(1)
    expect(generateMock).not.toHaveBeenCalled()
    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.compressed![0].summary).toBe('旧摘要1')
  })
})

// ===== P1-2：压缩保真检查（实体保留率，只告警不拦截） =====
describe('P1-2：压缩保真检查', () => {
  beforeEach(() => {
    vi.mocked(detectWritingIntent).mockReturnValue({ kind: 'none' })
    useAgentStore.setState({ generating: false })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    useCharacterStore.setState({ characters: [] })
  })

  it('摘要漏掉批内实体（角色/章节/写入目标）→ 留痕告警 + 批次记录，且历史仍正常替换', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    // 角色卡项目：名字只在出现在批次文本里时才被抽取
    useCharacterStore.setState({ characters: [{ name: '苏晚晴' }] as never })
    const msgs = Array.from({ length: 12 }, (_, i) => ({
      id: `f${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: i === 0 ? `苏晚晴要写第 3 章。${'历史消息占位。'.repeat(40)}` : '历史消息占位。'.repeat(40),
      createdAt: i,
      // i=1 挂一个写类工具调用 → 写入目标实体（drafts/c3.md）
      ...(i === 1
        ? { toolCalls: [{ id: 'tc1', toolName: 'write_file', arguments: { file_path: 'drafts/c3.md' }, status: 'completed' as const }] }
        : {}),
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: msgs } : c),
    }))
    useLLMStore.setState({ generate: vi.fn(async () => ({ success: true, content: '短摘要', usage: undefined })) as never })
    configResponse = { compaction: { historyMaxTokens: 1000 } }
    const renderLogMock = vi.mocked(renderLog)

    await useAgentStore.getState().sendMessage('新消息')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const batch = after.compressed?.[0]
    expect(batch).toBeTruthy()
    // 三实体：写入目标 / 角色 / 章节号；写入目标因**回执段（B5）按设计保留**而命中，
    // 角色与章节号缺失 → 保留率 1/3 < 0.6 → 告警
    expect(batch!.fidelity).toEqual({ extracted: 3, retained: 1, ratio: 1 / 3 })
    expect(renderLogMock).toHaveBeenCalledWith('warn', 'Agent',
      expect.stringContaining(t('ccr.fidelityWarn').split('：')[0]))
    // 只告警不拦截：历史仍按降幅判定正常替换
    expect(after.messages.length).toBeLessThan(msgs.length)
  })

  it('实体被摘要保留 → 不告警（零成本检查的正路径）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useCharacterStore.setState({ characters: [{ name: '苏晚晴' }] as never })
    const msgs = Array.from({ length: 12 }, (_, i) => ({
      id: `g${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: i === 0 ? `苏晚晴要写第 3 章。${'历史消息占位。'.repeat(40)}` : '历史消息占位。'.repeat(40),
      createdAt: i,
      ...(i === 1
        ? { toolCalls: [{ id: 'tc2', toolName: 'write_file', arguments: { file_path: 'drafts/c3.md' }, status: 'completed' as const }] }
        : {}),
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: msgs } : c),
    }))
    useLLMStore.setState({
      generate: vi.fn(async () => ({
        success: true,
        content: '苏晚晴负责第三章，已写入 drafts/c3.md。',
        usage: undefined,
      })) as never,
    })
    configResponse = { compaction: { historyMaxTokens: 1000 } }
    const renderLogMock = vi.mocked(renderLog)
    renderLogMock.mockClear()

    await useAgentStore.getState().sendMessage('新消息')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const batch = after.compressed?.[0]
    expect(batch!.fidelity).toEqual({ extracted: 3, retained: 3, ratio: 1 })
    // 摘要比原文短得多 → 正常替换；且无保真告警
    expect(renderLogMock).not.toHaveBeenCalledWith('warn', 'Agent',
      expect.stringContaining(t('ccr.fidelityWarn').split('：')[0]))
  })
})

// ===== 自学习压缩 v1：接线（默认关闭零副作用；开启后提示/统计/落盘） =====
describe('自学习压缩 v1：接线', () => {
  beforeEach(() => {
    vi.mocked(detectWritingIntent).mockReturnValue({ kind: 'none' })
    useAgentStore.setState({ generating: false })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    useCharacterStore.setState({ characters: [] })
  })

  const seedLongHistory = async (withEntities = false) => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    if (withEntities) useCharacterStore.setState({ characters: [{ name: '苏晚晴' }] as never })
    const msgs = Array.from({ length: 12 }, (_, i) => ({
      id: `sl${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: withEntities && i === 0
        ? `苏晚晴要写第 3 章。${'历史消息占位。'.repeat(40)}`
        : '历史消息占位。'.repeat(40),
      createdAt: i,
      ...(withEntities && i === 1
        ? { toolCalls: [{ id: 'sltc', toolName: 'write_file', arguments: { file_path: 'drafts/c3.md' }, status: 'completed' as const }] }
        : {}),
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: msgs } : c),
    }))
    return conv
  }

  it('默认关闭：不注入学习提示、不写 compactionLearning（行为零变化）', async () => {
    await seedLongHistory()
    configResponse = { compaction: { historyMaxTokens: 1000 } }
    const generateMock = vi.fn(async (messages: Array<{ role: string; content: string }>, modelId?: string, opts?: unknown) => {
      void modelId
      void opts
      return { success: messages.length > 0, content: '短摘要', usage: undefined }
    })
    useLLMStore.setState({ generate: generateMock as never })

    await useAgentStore.getState().sendMessage('新消息')

    const prompt = generateMock.mock.calls[0][0][0].content
    expect(prompt).not.toContain(t('ccr.learnedHintsHeader'))
    const setCalls = mockInvoke.mock.calls.filter(c => c[0] === 'config:set')
    expect(setCalls.some(c => (c[1] as Record<string, unknown> | undefined)?.compactionLearning !== undefined)).toBe(false)
  })

  it('开启 + 预置激活规则：摘要 prompt 携带学习提示；成功后写回统计', async () => {
    await seedLongHistory()
    configResponse = {
      compaction: { historyMaxTokens: 1000 },
      compactionLearning: {
        enabled: true,
        rules: [{ id: 'keep-characters', active: true, evidence: 2, backfire: 0, evidenceAtLastDecision: 0, backfireAtActivation: 0 }],
      },
    }
    const generateMock = vi.fn(async (messages: Array<{ role: string; content: string }>, modelId?: string, opts?: unknown) => {
      void modelId
      void opts
      return { success: messages.length > 0, content: '短摘要', usage: undefined }
    })
    useLLMStore.setState({ generate: generateMock as never })

    await useAgentStore.getState().sendMessage('新消息')

    const prompt = generateMock.mock.calls[0][0][0].content
    expect(prompt).toContain(t('ccr.learnedHintsHeader'))
    expect(prompt).toContain(t('ccr.learnHintKeepCharacters'))

    await vi.waitFor(() => {
      const call = mockInvoke.mock.calls.find(c =>
        c[0] === 'config:set' && (c[1] as Record<string, unknown> | undefined)?.compactionLearning !== undefined)
      expect(call).toBeTruthy()
      const written = (call![1] as { compactionLearning: { stats: { compressions: number }; rules: Array<{ id: string; active: boolean }> } }).compactionLearning
      expect(written.stats.compressions).toBe(1)
      expect(written.rules.find(r => r.id === 'keep-characters')!.active).toBe(true)
    })
  })

  it('保真缺失累计到门槛 → 规则激活并落盘 + LogsView 留痕', async () => {
    await seedLongHistory(true)
    configResponse = {
      compaction: { historyMaxTokens: 1000 },
      // 预置 1 条证据：本轮缺失再次 +1 → 达到门槛（2）激活
      compactionLearning: { enabled: true, rules: [{ id: 'keep-characters', evidence: 1 }] },
    }
    useLLMStore.setState({ generate: vi.fn(async () => ({ success: true, content: '短摘要', usage: undefined })) as never })
    const renderLogMock = vi.mocked(renderLog)
    renderLogMock.mockClear()

    await useAgentStore.getState().sendMessage('新消息')

    // 断言用**规则名**（i18n 值本身）而非按中文标点切前缀——后者在文案/语言变更下会假失败
    expect(renderLogMock).toHaveBeenCalledWith('info', 'Agent',
      expect.stringContaining(t('ccr.ruleKeepCharacters')))
    await vi.waitFor(() => {
      const call = mockInvoke.mock.calls.find(c =>
        c[0] === 'config:set' && (c[1] as Record<string, unknown> | undefined)?.compactionLearning !== undefined)
      const written = (call![1] as { compactionLearning: { rules: Array<{ id: string; active: boolean; evidence: number }> } }).compactionLearning
      const rule = written.rules.find(r => r.id === 'keep-characters')!
      expect(rule.active).toBe(true)
      expect(rule.evidence).toBe(2)
    })
  })
})

// ===== 进度接线（约束③「计划步骤有序、有状态」）=====
describe('agentProgress 接线与竞态守卫', () => {
  const mockRunAgentLoop = vi.mocked(runAgentLoop)
  /** 捕获每次 runAgentLoop 收到的回调对象，供用例按需手动触发 */
  let cbSeen: AgentEngineCallbacks[] = []

  const progress = (description: string, completedSteps: number) => ({
    phase: 'tool_execution' as const,
    toolIndex: 1,
    totalTools: 1,
    completedSteps,
    totalSteps: 8,
    tokensUsed: 0,
    elapsedMs: 0,
    percentage: 0,
    description,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    cbSeen = []
    // 桩：不抛错、不 resolve —— 由用例手动触发 onProgress / onDone
    mockRunAgentLoop.mockImplementation(((...args: unknown[]) => {
      cbSeen.push(args[5] as AgentEngineCallbacks)
      return new Promise(() => {})
    }) as never)
  })

  afterEach(() => {
    useAgentStore.getState().cancelGeneration()
  })

  it('onProgress 写入 agentProgress（此前引擎在发、store 未接）', async () => {
    useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })

    void useAgentStore.getState().sendMessage('你好')
    await vi.waitFor(() => expect(cbSeen.length).toBe(1))
    expect(useAgentStore.getState().agentProgress).toBeNull()

    cbSeen[0].onProgress?.(progress('正在执行工具: read_file', 3))

    expect(useAgentStore.getState().agentProgress?.completedSteps).toBe(3)
    expect(useAgentStore.getState().agentProgress?.description).toBe('正在执行工具: read_file')
  })

  it('旧请求的晚到 progress 不覆盖新请求（seq 守卫）', async () => {
    useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })

    // 第 1 轮：捕获其回调（桩不 resolve，保持「生成中」）
    void useAgentStore.getState().sendMessage('第一轮')
    await vi.waitFor(() => expect(cbSeen.length).toBe(1))

    // 取消第 1 轮（否则 sendMessage 被「已在生成中」守卫拦下）
    await useAgentStore.getState().cancelGeneration()

    // 第 2 轮：generationSeq 自增 → 第 1 轮的回调变陈旧
    void useAgentStore.getState().sendMessage('第二轮')
    await vi.waitFor(() => expect(cbSeen.length).toBe(2))

    // 新请求先写入自己的进度
    cbSeen[1].onProgress?.(progress('正在执行工具: write_file', 5))
    expect(useAgentStore.getState().agentProgress?.completedSteps).toBe(5)

    // 旧请求的 progress 晚到 —— 必须被丢弃，不得回退成 3
    cbSeen[0].onProgress?.(progress('正在执行工具: read_file', 3))
    expect(useAgentStore.getState().agentProgress?.completedSteps).toBe(5)
    expect(useAgentStore.getState().agentProgress?.description).toBe('正在执行工具: write_file')
  })

  it('子 agent 进度写入 subAgentProgress，且不进入 subSessions（不落盘）', () => {
    useAgentStore.getState().setSubAgentProgress('task-1', progress('正在执行工具: read_task', 2))

    const state = useAgentStore.getState()
    expect(state.subAgentProgress['task-1']?.completedSteps).toBe(2)
    // 硬约束 4：progress 绝不进 subSessions（session 整体 JSON 落盘）
    const serialized = JSON.stringify(state.conversations)
    expect(serialized).not.toContain('subAgentProgress')
  })

  // 2026-10-17 DeepSeek V4.1 DSML 文本泄漏：引擎层已过滤，store 落盘侧再兜一道（旧版/异常路径）
  it('DSML 落盘防线：onTextChunk/onDone 含原生 DSML 标记 → content 不含原文，正文保留', async () => {
    useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })

    void useAgentStore.getState().sendMessage('你好')
    await vi.waitFor(() => expect(cbSeen.length).toBe(1))

    cbSeen[0].onTextChunk?.(`先读文件。\n${dsmlSample}`)
    cbSeen[0].onDone?.(`先读文件。\n${dsmlSample}`, [], [])

    const conv = useAgentStore.getState().conversations[0]!
    const last = conv.messages[conv.messages.length - 1]!
    expect(last.role).toBe('assistant')
    expect(last.content).not.toContain('DSML')
    expect(last.content).not.toContain('｜')
    expect(last.content).toContain('先读文件。')
  })
})
