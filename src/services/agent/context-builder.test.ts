// @vitest-environment jsdom
/**
 * context-builder — Agent system prompt 输出语言约束测试（#30）
 * 此前仅 identityRuleLanguage 弱约束（"Reply in the user's language" 不指明具体语言），
 * 英文界面下 Agent 仍回中文。修复后末尾追加 appendOutputLanguage 明确语言指令。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildAgentSystemPrompt, buildAgentSystemSegments, buildAgentSystemSegmentsAsync } from './context-builder'
import { useAgentStore } from '../../stores/agent-store'

describe('buildAgentSystemPrompt 输出语言约束', () => {
  it('末尾包含明确输出语言指令', () => {
    const prompt = buildAgentSystemPrompt('quick')
    expect(prompt).toContain('[System] 请始终使用')
    expect(prompt).toContain('Do not respond in any other language')
    // 语言指令位于末尾（优先级最高）
    expect(prompt.trim().endsWith('Do not respond in any other language.')).toBe(true)
  })
})

describe('buildAgentSystemSegments M1 会话摘要', () => {
  it('无滚动摘要时不注入记忆节', () => {
    useAgentStore.setState({ conversations: [], activeConversationId: null })
    const { memory } = buildAgentSystemSegments('quick')
    expect(memory).toBe('')
  })

  it('有滚动摘要时注入「自动生成」标注节', () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, rollingSummary: '用户要求写甜文，已确认主角性格' } : c),
    }))
    const { memory } = buildAgentSystemSegments('quick')
    expect(memory).toContain('用户要求写甜文，已确认主角性格')
    expect(memory).toContain('自动生成') // 标注非用户输入
  })

  it('超 300 tokens 预算时记忆节被裁剪', () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, rollingSummary: '长摘要'.repeat(400) } : c),
    }))
    const { memory } = buildAgentSystemSegments('quick')
    expect(memory.length).toBeLessThan(600)
  })

  it('语言指令保持在最终 prompt 最末尾（#30 语义不变）', () => {
    const prompt = buildAgentSystemPrompt('quick')
    expect(prompt.trim().endsWith('Do not respond in any other language.')).toBe(true)
  })
})

describe('M2 作品记忆节（P1）', () => {
  const mockInvoke = vi.fn(async (ch: string) => {
    if (ch === 'memory:list') return [{ file: 'chapters-001-015.md', kind: 'chapters', stale: false, mtime: 1 }]
    if (ch === 'memory:read') return '---\nrange: 001-015\n---\n\n## 第 1 章 · 开局\n- 关键事件：主角觉醒'
    return null
  })

  beforeEach(() => {
    Object.defineProperty(window, 'velaAPI', { value: { invoke: mockInvoke }, configurable: true })
    useAgentStore.setState({ conversations: [], activeConversationId: null })
  })

  it('有记忆文件时 memory 段含 M2 节', async () => {
    const { memory } = await buildAgentSystemSegmentsAsync('quick')
    expect(memory).toContain('作品记忆')
    expect(memory).toContain('主角觉醒')
  })

  it('读取失败降级：memory 段仅含 M1（不阻塞）', async () => {
    mockInvoke.mockResolvedValue(null)
    const { memory } = await buildAgentSystemSegmentsAsync('quick')
    expect(memory).not.toContain('作品记忆')
  })
})
