import { describe, it, expect } from 'vitest'
import { parseMemoryFile, isStale, markStaleFrontmatter, buildChapterSummaryFile, isValidMemoryContent, stripStatusFrontmatter } from './memory-codec'

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

describe('isValidMemoryContent（手动编辑保存前结构校验）', () => {
  it('章节文件（frontmatter + 章节块）有效', () => {
    const raw = '---\nrange: 001-003\n---\n\n## 第 1 章 · 开局\n- 关键事件：主角觉醒\n'
    expect(isValidMemoryContent(raw)).toBe(true)
  })

  it('纯章节块无 frontmatter 有效（前置标题行，下游 split 同口径）', () => {
    expect(isValidMemoryContent('# 我的记忆\n\n## 第 3 章 · 转折\n- 关键事件：对决')).toBe(true)
  })

  it('正文首行即章节块（无前置标题）无效——下游 split 也解析不出首块', () => {
    expect(isValidMemoryContent('## 第 3 章 · 转折\n- 关键事件：对决')).toBe(false)
  })

  it('仅 frontmatter 完整（正文空）有效', () => {
    expect(isValidMemoryContent('---\nvolume: 1\nrange: 1-10\n---\n')).toBe(true)
  })

  it('frontmatter 完整 + body 以块前缀开头有效', () => {
    expect(isValidMemoryContent('---\nrange: 001-003\n---\n\n## 第 1 章 · 开局\n- 关键事件：主角觉醒')).toBe(true)
  })

  it('frontmatter 完整但正文首行即章节块（无前导 \\n）无效——下游 split 解析不出首块', () => {
    expect(isValidMemoryContent('---\nrange: 001-003\n---\n## 第 1 章 · 开局\n- 关键事件：主角觉醒')).toBe(false)
  })

  it('frontmatter 完整但正文非空且非块前缀（单标题行）无效', () => {
    expect(isValidMemoryContent('---\nvolume: 1\nrange: 1-10\n---\n# 第 1 卷')).toBe(false)
  })

  it('空内容无效', () => {
    expect(isValidMemoryContent('')).toBe(false)
    expect(isValidMemoryContent('   ')).toBe(false)
  })

  it('无结构文本无效', () => {
    expect(isValidMemoryContent('随便写的文字')).toBe(false)
  })

  it('块头缺「 · 」无效（与下游块解析同口径）', () => {
    expect(isValidMemoryContent('## 第 1 章\n- 关键事件：无')).toBe(false)
  })

  it('frontmatter 损坏但章节块存在 → 有效（块分支生效）', () => {
    expect(isValidMemoryContent('---\nrange: 001-003\n## 第 1 章 · 开局')).toBe(true)
  })

  it('P3：type: shared frontmatter（事实列表文件）有效——编辑保存不被章节校验误拒', () => {
    expect(isValidMemoryContent('---\ntype: shared\n---\n\n# 跨会话可复用事实\n- 事实A\n- 事实B')).toBe(true)
  })
})

describe('stripStatusFrontmatter（编辑保存清除 stale）', () => {
  it('清除 status 保留其余字段', () => {
    const stripped = stripStatusFrontmatter('---\nstatus: stale\nrange: 001-003\n---\n## 第 1 章 · 开局')
    expect(stripped).toBe('---\nrange: 001-003\n---\n\n## 第 1 章 · 开局')
  })

  it('status 为唯一字段时移除整个 frontmatter', () => {
    expect(stripStatusFrontmatter('---\nstatus: stale\n---\n正文')).toBe('正文')
  })

  it('无 status 幂等原样返回', () => {
    const raw = '---\nrange: 001-003\n---\n正文'
    expect(stripStatusFrontmatter(raw)).toBe(raw)
  })

  it('无 frontmatter 原样返回', () => {
    const raw = '纯正文'
    expect(stripStatusFrontmatter(raw)).toBe(raw)
  })
})
