// @vitest-environment jsdom
/**
 * rag-context-provider 注入链测试（P2-3）——此前只有 kb 层的 FTS 豁免断言，
 * 这是上下文链上测试最薄的一段。五条纯函数用例：
 * 0.6 相似度阈值 / FTS 豁免 / ±10 章范围 / 800 token 总预算 / 句子边界截断。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.hoisted(() => vi.fn())
vi.mock('../ipc-client', () => ({ ipc: { invoke: mockInvoke } }))

import { retrieveContextForQuery, DEFAULT_RAG_CONFIG } from './rag-context-provider'
import { estimateTokens } from './token-budget'

const chunk = (text: string, score: number, source?: 'vector' | 'fts', fileName = 'f.md') =>
  ({ text, score, fileName, source })

beforeEach(() => {
  mockInvoke.mockReset()
})

describe('RAG 注入链（P2-3）', () => {
  it('相似度阈值：低于 0.6 的 vector 结果被丢弃，达标的保留', async () => {
    mockInvoke.mockResolvedValue([
      chunk('低分片段', 0.59),
      chunk('达标片段', 0.6),
    ])
    const res = await retrieveContextForQuery('q', DEFAULT_RAG_CONFIG)
    expect(res?.chunks.map(c => c.text)).toEqual(['达标片段'])
    expect(res?.formattedContext).not.toContain('低分片段')
  })

  it('FTS 豁免：来源为 fts 的低分结果不被阈值过滤（否则无 Embedding 时 RAG 静默失效）', async () => {
    mockInvoke.mockResolvedValue([chunk('精确命中', 0.5, 'fts')])
    const res = await retrieveContextForQuery('q', DEFAULT_RAG_CONFIG)
    expect(res?.chunks).toHaveLength(1)
    expect(res?.formattedContext).toContain('精确命中')
  })

  it('章节范围：无显式 scope 时用「当前章 ±10」，走 kb:search-with-scope（下界钳到 1）', async () => {
    mockInvoke.mockResolvedValue([chunk('x', 0.9)])
    await retrieveContextForQuery('q', DEFAULT_RAG_CONFIG, 20)
    expect(mockInvoke).toHaveBeenCalledWith('kb:search-with-scope', 'q', 10, 30, DEFAULT_RAG_CONFIG.maxChunks)

    mockInvoke.mockClear()
    mockInvoke.mockResolvedValue([chunk('x', 0.9)])
    await retrieveContextForQuery('q', DEFAULT_RAG_CONFIG, 1)
    expect(mockInvoke).toHaveBeenCalledWith('kb:search-with-scope', 'q', 1, 11, DEFAULT_RAG_CONFIG.maxChunks)
  })

  it('800 token 总预算：超预算的 chunk 截断、预算耗尽后 break；无章号时走 kb:search', async () => {
    mockInvoke.mockResolvedValue([
      chunk('甲'.repeat(500), 0.9),   // 启发式 ≈750 / tiktoken 500 —— 两种口径下都进
      chunk('乙'.repeat(500), 0.9),
      chunk('丙'.repeat(500), 0.9),
    ])
    const res = await retrieveContextForQuery('q', DEFAULT_RAG_CONFIG)
    expect(mockInvoke).toHaveBeenCalledWith('kb:search', 'q', DEFAULT_RAG_CONFIG.maxChunks)
    expect(res!.formattedContext).toContain('[1]')
    expect(res!.formattedContext).toContain('[2]')
    expect(res!.formattedContext).not.toContain('[3]')   // 预算耗尽 → break，不再注入
    // 总预算不越界（允许「…」一个字符的近似溢出——截断比例按字符算）
    expect(res!.tokenCount).toBeLessThanOrEqual(DEFAULT_RAG_CONFIG.maxTokens + estimateTokens('…'))
    expect(res!.chunks).toHaveLength(3)                  // chunks 是过滤结果，不是截断结果
  })

  it('句子边界：截断点前移到最近句读，不把半句给模型', async () => {
    const text = '甲'.repeat(400) + '。' + '乙'.repeat(400)
    mockInvoke.mockResolvedValue([chunk(text, 0.9)])
    const res = await retrieveContextForQuery('q', DEFAULT_RAG_CONFIG)
    expect(res!.formattedContext).toContain('。…')       // 截在句读处，而非「乙」串中间
    expect(res!.formattedContext).not.toContain('乙')
  })

  it('无结果 / 检索异常 → 一律 null（不阻断主流程）', async () => {
    mockInvoke.mockResolvedValue([])
    expect(await retrieveContextForQuery('q', DEFAULT_RAG_CONFIG)).toBeNull()
    mockInvoke.mockRejectedValue(new Error('kb down'))
    expect(await retrieveContextForQuery('q', DEFAULT_RAG_CONFIG)).toBeNull()
  })
})
