import { describe, it, expect } from 'vitest'
import { computeTextStats, formatTextStats } from './text-stats'

describe('computeTextStats', () => {
  it('统计中文文本：汉字数 / 标点 / 有效字数', () => {
    const s = computeTextStats('他推开窗，望向远方的山。\n风起了。')
    expect(s.chineseChars).toBe(13) // 他推开窗望向远方的山风起了
    expect(s.punctuationCount).toBe(3) // ，。。共 3 个，\n不算标点
    expect(s.novelWordCount).toBe(13)
    expect(s.lines).toBe(2)
  })

  it('有效字数 = 汉字 + 英文单词（不含标点空白）', () => {
    const s = computeTextStats('Hello 世界！你好，world 123。')
    expect(s.englishWords).toBe(3) // Hello / world / 123
    expect(s.chineseChars).toBe(4) // 世界你好
    expect(s.novelWordCount).toBe(7)
    expect(s.nonWhitespaceChars).toBeGreaterThan(s.novelWordCount)
  })

  it('空文本统计为 0', () => {
    const s = computeTextStats('')
    expect(s.totalChars).toBe(0)
    expect(s.novelWordCount).toBe(0)
    expect(s.lines).toBe(1)
  })
})

describe('formatTextStats', () => {
  it('生成 LLM 可读的结构化统计', () => {
    const out = formatTextStats(computeTextStats('第一章正文内容'), '第 1 章草稿')
    expect(out).toContain('第 1 章草稿 字数统计')
    expect(out).toContain('有效字数：7')
  })
})
