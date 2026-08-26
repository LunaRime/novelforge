import { describe, it, expect } from 'vitest'
import { computeFTSRelevance, parseChapterNumberForBackfill } from './vector-store'

describe('computeFTSRelevance（P1-1 FTS 相关性打分）', () => {
  it('空输入返回基础分 0.5', () => {
    expect(computeFTSRelevance('', '查询')).toBe(0.5)
    expect(computeFTSRelevance('文本', '')).toBe(0.5)
    expect(computeFTSRelevance('', '')).toBe(0.5)
  })

  it('分数范围恒在 [0.5, 1.0]', () => {
    for (let i = 0; i < 20; i++) {
      const s = computeFTSRelevance(`测试文本 ${i} 内容`, '测试')
      expect(s).toBeGreaterThanOrEqual(0.5)
      expect(s).toBeLessThanOrEqual(1)
    }
  })

  it('完全命中（query 全在 text）比部分命中分数高', () => {
    const full = computeFTSRelevance('知识库支持搜索与向量检索功能', '搜索')
    const partial = computeFTSRelevance('今天天气不错', '搜索')
    expect(full).toBeGreaterThan(partial)
  })

  it('连续片段命中比同字符散落分数高', () => {
    // '搜索知识' 在 text1 连续出现，text2 只零散含 搜/索/知/识
    const contiguous = computeFTSRelevance('本章讲解搜索知识库的方法', '搜索知识')
    const scattered = computeFTSRelevance('搜遍全书才知道知识的用处', '搜索知识')
    expect(contiguous).toBeGreaterThan(scattered)
  })

  it('命中位置靠前的文本分数更高（同命中率时）', () => {
    const early = computeFTSRelevance('搜索功能在开头，后面是无关内容……'.padEnd(60, '填充'), '搜索功能')
    const late = computeFTSRelevance('前面全是无关内容……'.padEnd(60, '填充') + '搜索功能在结尾', '搜索功能')
    expect(early).toBeGreaterThan(late)
  })

  it('中文标点/英文混合 query 不崩溃', () => {
    expect(() => computeFTSRelevance('这是 hero 的剑', 'hero')).not.toThrow()
    expect(computeFTSRelevance('这是 hero 的剑', 'hero')).toBeGreaterThan(0.5)
  })
})

describe('存量回填章节号解析（真实定稿导入格式）', () => {
  it('第N章 标题.txt（真实格式：定稿导入文件名）→ 章节号', () => {
    expect(parseChapterNumberForBackfill('第9章 破坛换晶.txt')).toBe(9)
    expect(parseChapterNumberForBackfill('第 9 章 破坛换晶.txt')).toBe(9)
  })

  it('无匹配 → null（回填 NULL，scopeFilter 容忍）', () => {
    expect(parseChapterNumberForBackfill('设定集.md')).toBeNull()
    expect(parseChapterNumberForBackfill('chapter_9.txt')).toBeNull()
    expect(parseChapterNumberForBackfill('第9章 正文.md')).toBeNull() // 旧格式（正文/要点/蓝图.md）非定稿导入
  })
})
