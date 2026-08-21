// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAgentStore } from './agent-store'
import { useProjectStore } from './project-store'

// mock IPC（fs:agent-archive-* 通道）
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
