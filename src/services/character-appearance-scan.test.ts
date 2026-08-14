import { describe, it, expect } from 'vitest'
import { scanCharacterAppearances, DEPARTED_GAP } from './character-appearance-scan'
import type { ChapterContent } from './character-archive'

const mkChapter = (n: number, content: string): ChapterContent => ({ chapterNumber: n, content })

describe('scanCharacterAppearances（P2-1 出场统计扫描）', () => {
  const chapters = [
    mkChapter(1, '苏晚走进大殿，李雷跟在身后。'),
    mkChapter(2, '阿晚在练剑。'), // 苏晚的别名
    mkChapter(3, '李雷独自修行。'),
    mkChapter(4, '苏晚与李雷对坐饮茶。'),
    mkChapter(25, '只有王五出场。'),
  ]

  it('统计出场章/首末章/次数（含别名形态）', () => {
    const result = scanCharacterAppearances(chapters, [
      { name: '苏晚', aliases: '["阿晚"]' },
      { name: '李雷' },
      { name: '王五' },
    ])
    const su = result.stats.find(s => s.name === '苏晚')!
    expect(su.appearCount).toBe(3) // 第1/2/4章（第2章经别名）
    expect(su.firstChapter).toBe(1)
    expect(su.lastChapter).toBe(4)
    expect(su.chapters).toEqual([1, 2, 4])
    const li = result.stats.find(s => s.name === '李雷')!
    expect(li.chapters).toEqual([1, 3, 4])
  })

  it('未出场角色统计为 0', () => {
    const result = scanCharacterAppearances(chapters, [{ name: '赵六' }])
    expect(result.stats[0]).toMatchObject({ appearCount: 0, firstChapter: 0, lastChapter: 0, chapters: [] })
  })

  it('疑似退场：最近出场距最新章 ≥ DEPARTED_GAP 章', () => {
    // 最新章 25；李雷最近 4 → 差距 21 ≥ 20 → 疑似退场；苏晚最近 4 同样（都用第4章，为隔离测试单独构造）
    const result = scanCharacterAppearances(chapters, [{ name: '李雷' }, { name: '王五' }])
    expect(result.departed).toContain('李雷')
    expect(result.departed).not.toContain('王五')
    expect(result.maxChapter).toBe(25)
  })

  it('前缀碰撞过滤：苏晚不统计苏晚晴的出场', () => {
    const result = scanCharacterAppearances(
      [mkChapter(1, '苏晚晴看着远方。')],
      [{ name: '苏晚' }, { name: '苏晚晴' }],
    )
    const su = result.stats.find(s => s.name === '苏晚')!
    const suq = result.stats.find(s => s.name === '苏晚晴')!
    expect(su.appearCount).toBe(0)
    expect(suq.appearCount).toBe(1)
  })

  it('空章节/空角色 → 空结果', () => {
    expect(scanCharacterAppearances([], []).stats).toEqual([])
  })

  it('DEPARTED_GAP 常量存在且合理', () => {
    expect(DEPARTED_GAP).toBeGreaterThan(0)
  })
})
