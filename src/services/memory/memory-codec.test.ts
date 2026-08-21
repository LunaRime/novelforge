import { describe, it, expect } from 'vitest'
import { parseMemoryFile, isStale, markStaleFrontmatter, buildChapterSummaryFile } from './memory-codec'

describe('parseMemoryFile', () => {
  it('解析 frontmatter 与正文', () => {
    const parsed = parseMemoryFile('---\nstatus: stale\n---\n正文内容')
    expect(parsed).toEqual({ frontmatter: { status: 'stale' }, body: '正文内容' })
  })

  it('无 frontmatter 视为正常（非 stale）', () => {
    const parsed = parseMemoryFile('纯正文')
    expect(parsed?.frontmatter).toEqual({})
    expect(parsed?.body).toBe('纯正文')
  })

  it('损坏内容返回 null 不抛错', () => {
    expect(parseMemoryFile('')).toBeNull()
  })
})

describe('isStale / markStaleFrontmatter', () => {
  it('status: stale 判定', () => {
    expect(isStale('---\nstatus: stale\n---\n正文')).toBe(true)
    expect(isStale('---\nstatus: ok\n---\n正文')).toBe(false)
  })

  it('markStaleFrontmatter 幂等', () => {
    const once = markStaleFrontmatter('---\nstatus: stale\n---\n正文')
    expect(markStaleFrontmatter(once)).toBe(once)
  })

  it('无 frontmatter 时追加', () => {
    const marked = markStaleFrontmatter('纯正文')
    expect(marked.startsWith('---\nstatus: stale\n---\n')).toBe(true)
  })
})

describe('buildChapterSummaryFile', () => {
  it('组装 frontmatter + 章节条目', () => {
    const content = buildChapterSummaryFile('001-015', [
      { chapterNumber: 1, title: '开局', keyEvents: '主角觉醒', characters: '苏晚晴', foreshadowing: '虚晶', newElements: '武魂', currentState: '筑基' },
    ])
    expect(content).toContain('range: 001-015')
    expect(content).toContain('第 1 章 · 开局')
    expect(content).toContain('主角觉醒')
  })
})
