// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAgentStore } from './agent-store'
import { useProjectStore } from './project-store'
import { useLLMStore } from './llm-store'
import { readFileTool, clearReadState } from '../services/agent/tools/read-file.tool'

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
})
