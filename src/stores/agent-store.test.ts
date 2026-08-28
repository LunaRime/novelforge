// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAgentStore } from './agent-store'
import { useProjectStore } from './project-store'
import { useLLMStore } from './llm-store'
import { readFileTool, clearReadState } from '../services/agent/tools/read-file.tool'
import { detectWritingIntent } from '../services/agent/writing-intent'
import { startChapterWorkflow, WorkflowStartError } from '../services/workflows/workflow-starter'
import { runAgentLoop } from '../services/agent/agent-engine'
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
    default:
      return null
  }
})

beforeEach(() => {
  archiveFiles.clear()
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
    // P0-4：预路由命中时不 append 用户消息——会话中仅有一条助手汇报消息
    expect(after.messages.filter(m => m.role === 'user')).toHaveLength(0)
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

  it('工作流启动失败 ERR_GUARD：注入 intentGuardFail 文案（不做 ReAct 兜底）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'chapter_creation', chapter: 3 })
    mockStartChapter.mockRejectedValue(new WorkflowStartError('ERR_GUARD', '前置条件失败（guard 明细）'))

    await useAgentStore.getState().sendMessage('写第3章')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    const last = after.messages[after.messages.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toBe(t('agent.intentGuardFail'))
    expect(mockRunAgentLoop).not.toHaveBeenCalled()
    expect(useAgentStore.getState().generating).toBe(false)
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

  it('预路由异常兜底：非 WorkflowStartError（startWorkflow 直抛）→ 注入异常消息不 reject、无用户消息（I2）', async () => {
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
    expect(after.messages.filter(m => m.role === 'user')).toHaveLength(0)
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
