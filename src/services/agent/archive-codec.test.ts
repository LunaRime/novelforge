import { describe, it, expect } from 'vitest'
import { selectCompressionBatch, serializeArchive, parseArchive } from './archive-codec'
import type { AgentMessage, AgentConversation } from '../../stores/agent-store'

const makeMsg = (id: string, role: 'user' | 'assistant' | 'system', content: string): AgentMessage => ({
  id, role, content, createdAt: 0,
})

const msgs = (n: number): AgentMessage[] =>
  Array.from({ length: n }, (_, i) => makeMsg(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `第${i}条消息内容`.repeat(20)))

describe('selectCompressionBatch', () => {
  it('总 token 在预算内时 batch 为空', () => {
    const { batch, rest } = selectCompressionBatch(msgs(2), 100_000)
    expect(batch).toHaveLength(0)
    expect(rest).toHaveLength(2)
  })

  it('超预算时最旧消息进入 batch，rest 保留最新消息', () => {
    const { batch, rest } = selectCompressionBatch(msgs(10), 800)
    expect(batch.length).toBeGreaterThan(0)
    expect(rest.length).toBeGreaterThan(0)
    // 顺序保持：batch 在前、rest 在后，拼接回原序
    expect([...batch, ...rest].map(m => m.id)).toEqual(msgs(10).map(m => m.id))
  })

  it('rest 至少保留 1 条最新消息', () => {
    const { rest } = selectCompressionBatch(msgs(10), 1)
    expect(rest.length).toBeGreaterThanOrEqual(1)
  })

  it('跳过 system 消息（不压缩 system，始终留在 rest 尾部）', () => {
    const withSys = [makeMsg('s1', 'system', '系统指令'), ...msgs(10)]
    const { batch } = selectCompressionBatch(withSys, 800)
    expect(batch.some(m => m.role === 'system')).toBe(false)
  })
})

describe('archive 序列化', () => {
  it('round-trip 保持会话完整（含 compressed/rollingSummary）', () => {
    const conv: AgentConversation = {
      id: 'c1', title: '测试会话', messages: msgs(3),
      createdAt: 0, updatedAt: 1, mode: 'balanced', modelId: 'm',
      projectPath: 'E:/p', projectName: 'P',
      compressed: [{ batch: 1, original: [msgs(3)[0]], summary: '摘要', compressedAt: 1, originalTokens: 100 }],
      rollingSummary: '滚动摘要',
    }
    const parsed = parseArchive(serializeArchive(conv))
    expect(parsed).toEqual(conv)
  })

  it('损坏 JSON 返回 null（不抛错）', () => {
    expect(parseArchive('{bad json')).toBeNull()
  })

  it('缺字段降级：messages/compressed/rollingSummary 缺省', () => {
    const parsed = parseArchive('{"id":"c1","title":"T","createdAt":0,"updatedAt":0,"mode":"balanced","modelId":null}')
    expect(parsed).not.toBeNull()
    expect(parsed!.messages).toEqual([])
    expect(parsed!.compressed).toEqual([])
    expect(parsed!.rollingSummary).toBeUndefined()
  })
})
