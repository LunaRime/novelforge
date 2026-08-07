import { describe, it, expect } from 'vitest'
import { buildYearlySummary, buildYearlyReportHTML } from './yearly-report'
import type { DailyActivityRow } from '../shared/ipc-channels'

function day(day: string, patch: Partial<DailyActivityRow> = {}): DailyActivityRow {
  return {
    day,
    writtenWords: 0, writtenCount: 0, revisedWords: 0, revisedCount: 0,
    llmCalls: 0, llmTokens: 0, llmCost: 0,
    projectPath: '/p/a', projectName: '项目A',
    ...patch,
  }
}

/**
 * 年度写作报告 — 数据聚合 + 分享卡 HTML 生成（纯函数）
 */
describe('buildYearlySummary', () => {
  const days = [
    day('2026-01-05', { writtenWords: 2000, writtenCount: 1, llmCalls: 5, llmTokens: 10000, llmCost: 0.05 }),
    day('2026-03-10', { writtenWords: 3000, writtenCount: 2, revisedWords: 500, llmCalls: 8, llmTokens: 20000, llmCost: 0.12 }),
    day('2026-12-31', { writtenWords: 1000, writtenCount: 1, llmCalls: 3, llmTokens: 5000, llmCost: 0.02 }),
    day('2025-12-31', { writtenWords: 99999, writtenCount: 9 }), // 其他年份不纳入
    day('2027-01-01', { writtenWords: 88888, writtenCount: 8 }),
  ]

  it('按年份过滤并聚合字数/章节/调用/费用', () => {
    const s = buildYearlySummary(days, 2026)
    expect(s.totalWrittenWords).toBe(6000)
    expect(s.totalRevisedWords).toBe(500)
    expect(s.totalChapters).toBe(4)
    expect(s.totalCalls).toBe(16)
    expect(s.totalTokens).toBe(35000)
    expect(s.totalCost).toBeCloseTo(0.19)
    expect(s.activeDays).toBe(3)
  })

  it('月份分布按 1-12 月归位', () => {
    const s = buildYearlySummary(days, 2026)
    expect(s.monthlyWords[0]).toBe(2000)   // 1 月
    expect(s.monthlyWords[2]).toBe(3000)   // 3 月
    expect(s.monthlyWords[11]).toBe(1000)  // 12 月
    expect(s.monthlyWords[5]).toBe(0)      // 6 月无数据
    expect(s.monthlyWords).toHaveLength(12)
  })

  it('top 项目为写作字数最多的项目', () => {
    const s = buildYearlySummary([
      day('2026-01-01', { writtenWords: 100, projectName: '小项目' }),
      day('2026-01-02', { writtenWords: 900, projectName: '大项目' }),
    ], 2026)
    expect(s.topProject).toBe('大项目')
  })

  it('无该年数据时返回全零', () => {
    const s = buildYearlySummary(days, 2030)
    expect(s.totalWrittenWords).toBe(0)
    expect(s.totalChapters).toBe(0)
    expect(s.totalCalls).toBe(0)
    expect(s.activeDays).toBe(0)
    expect(s.topProject).toBeNull()
  })
})

describe('buildYearlyReportHTML', () => {
  const summary = buildYearlySummary([
    day('2026-01-05', { writtenWords: 2000, writtenCount: 1, llmCalls: 5, llmTokens: 10000, llmCost: 0.05, projectName: '斗罗大陆' }),
  ], 2026)

  it('包含年份与统计数据（数字千分位格式化）', () => {
    const html = buildYearlyReportHTML(summary, 'zh-CN')
    expect(html).toContain('2026')
    expect(html).toContain('2,000')
    expect(html).toContain('斗罗大陆')
  })

  it('HTML 转义：项目名中的 HTML 不被注入', () => {
    const evil = buildYearlySummary([
      day('2026-01-01', { writtenWords: 100, projectName: '<script>alert(1)</script>' }),
    ], 2026)
    const html = buildYearlyReportHTML(evil, 'zh-CN')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
