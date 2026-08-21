// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { affectedFiles, collectAffectedFiles, invalidateMemoryFiles } from './memory-invalidation'

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

describe('collectAffectedFiles（diff 式失效区间——reviewer F1 修正）', () => {
  it('单侧边界编辑：成员变更章节所在文件被失效（欠失效回归）', () => {
    const oldVolumes = [{ volumeNumber: 1, chapterStart: 1, chapterEnd: 15 }]
    const newVolumes = [{ volumeNumber: 1, chapterStart: 1, chapterEnd: 12 }, { volumeNumber: 2, chapterStart: 13, chapterEnd: 0 }]
    // 受影响区间 = 变更卷旧范围 ∪ 新范围（1..15 ∪ 1..12）
    const files = collectAffectedFiles(oldVolumes, newVolumes, 1, 15)
    expect(files).toContain('chapters-001-015.md') // 13-15 章滚动窗口（旧归属）——欠失效场景必标
    expect(files).toContain('chapters-001-012.md') // 新卷窗口
  })

  it('删除进行中卷（31+ 章）→ 其滚动窗口文件被失效（欠失效回归）', () => {
    const oldVolumes = [{ volumeNumber: 1, chapterStart: 31, chapterEnd: 0 }]
    // 进行中卷（end=0）保守上限 start..start+30
    const files = collectAffectedFiles(oldVolumes, [], 31, 61)
    expect(files).toContain('chapters-031-045.md')
    expect(files).toContain('chapters-046-060.md')
    expect(files).toContain('chapters-061-075.md')
  })

  it('去重且顺序稳定（同章在变更前后映射同一文件不重复）', () => {
    const files = collectAffectedFiles(
      [{ volumeNumber: 1, chapterStart: 1, chapterEnd: 15 }],
      [{ volumeNumber: 1, chapterStart: 1, chapterEnd: 12 }, { volumeNumber: 2, chapterStart: 13, chapterEnd: 0 }],
      1, 15,
    )
    expect(new Set(files).size).toBe(files.length)
    expect(files[0]).toBe('chapters-001-015.md')
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
