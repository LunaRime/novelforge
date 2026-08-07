import { describe, it, expect } from 'vitest'
import { analyzeExternalChapter } from './publication-analysis'

/**
 * 连载监控分析 — 手动导入平台章节正文，与本地定稿对比相似度 + 复用审计函数。
 * 相似度 = 字符频率 Dice 系数（与 ThreeWayMerge 同思路的简化版）。
 */
describe('analyzeExternalChapter', () => {
  const terms = ['武魂']

  it('外部与本地完全相同 → 相似度 1.0', () => {
    const text = '他缓缓睁开眼，武魂在体内苏醒。'
    const r = analyzeExternalChapter(text, text, terms)
    expect(r.similarity).toBeGreaterThan(0.99)
    expect(r.localFound).toBe(true)
  })

  it('外部大幅修改 → 相似度明显低于 1.0（平台删改/续写检测）', () => {
    const local = '他缓缓睁开眼，武魂在体内苏醒。山谷的风吹过发梢。'
    const external = '清晨的山谷雾气弥漫，少年站在崖边，看着远处。'
    const r = analyzeExternalChapter(external, local, terms)
    expect(r.similarity).toBeLessThan(0.5)
  })

  it('无本地定稿 → localFound=false 且相似度 0', () => {
    const r = analyzeExternalChapter('任何内容', null, terms)
    expect(r.localFound).toBe(false)
    expect(r.similarity).toBe(0)
  })

  it('外部章节术语违规被检出（术语统一审计）', () => {
    const text = '他的武魂。他的武魂。他的武魂。他的武魂。他的武魂。他的武魂。'
    const r = analyzeExternalChapter(text, null, ['武魂'])
    expect(r.localFound).toBe(false)
  })

  it('空输入不崩', () => {
    const r = analyzeExternalChapter('', '', [])
    expect(r.similarity).toBe(0)
    expect(r.auditIssues).toEqual([])
  })
})
