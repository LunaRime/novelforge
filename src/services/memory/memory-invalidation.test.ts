// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { affectedFiles, invalidateMemoryFiles } from './memory-invalidation'

describe('affectedFiles（失效区间）', () => {
  it('卷成员变更 → 变更卷起始窗口 + 相邻滚动窗口双失效', () => {
    const files = affectedFiles(8, [{ volumeNumber: 1, chapterStart: 1, chapterEnd: 15 }])
    const names = files.map(f => f.file)
    expect(names).toContain('chapters-001-015.md')
    expect(files.every(f => f.reason === 'volume-change')).toBe(true)
  })

  it('第 15 章 → 相邻窗口起始为 16（公式修正：15 的倍数不错位）', () => {
    const files = affectedFiles(15, [])
    const names = files.map(f => f.file)
    expect(names).toContain('chapters-001-015.md')
    expect(names).toContain('chapters-016-030.md')
  })

  it('卷边界变更（卷 1 结束 15→12）→ 涉及新边界所在窗口', () => {
    const files = affectedFiles(12, [{ volumeNumber: 1, chapterStart: 1, chapterEnd: 12 }, { volumeNumber: 2, chapterStart: 13, chapterEnd: 0 }])
    const names = files.map(f => f.file)
    expect(names).toContain('chapters-001-012.md')
  })
})

describe('invalidateMemoryFiles（批量失效标记）', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'velaAPI', { value: { invoke: vi.fn() }, configurable: true })
  })

  it('逐文件调用 memory:mark-stale，返回成功数', async () => {
    const invoke = vi.fn(async () => ({ success: true }))
    Object.defineProperty(window, 'velaAPI', { value: { invoke }, configurable: true })
    const ok = await invalidateMemoryFiles(['chapters-001-015.md', 'chapters-016-030.md'])
    expect(ok).toBe(2)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenNthCalledWith(1, 'memory:mark-stale', 'chapters-001-015.md')
    expect(invoke).toHaveBeenNthCalledWith(2, 'memory:mark-stale', 'chapters-016-030.md')
  })

  it('失败文件不计入成功数，不中断后续文件', async () => {
    const invoke = vi.fn(async (_ch: string, file: string) => ({ success: file !== 'chapters-016-030.md' }))
    Object.defineProperty(window, 'velaAPI', { value: { invoke }, configurable: true })
    const ok = await invalidateMemoryFiles(['chapters-001-015.md', 'chapters-016-030.md'])
    expect(ok).toBe(1)
  })
})
