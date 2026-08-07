/**
 * 年度写作报告 — 数据聚合 + 分享卡 HTML 生成（纯函数，可单测）
 *
 * 链路：ActivityView 全量拉取 DailyActivityRow（已有 db:get-daily-activity）
 * → buildYearlySummary 按年聚合 → buildYearlyReportHTML 生成 1200px 宽分享卡
 * → 主进程 report:render-html 离屏截图 → PNG 保存。
 *
 * 报告卡片独立于 UI 主题（品牌渐变固定色）——分享卡要"好看"而非"适配暗色"。
 */

import { t, type SupportedLocale } from '../shared/locale'
import type { DailyActivityRow } from '../shared/ipc-channels'

/** 年度聚合结果 */
export interface YearlySummary {
  year: number
  totalWrittenWords: number
  totalRevisedWords: number
  totalChapters: number
  totalCalls: number
  totalTokens: number
  totalCost: number
  activeDays: number
  /** 1-12 月每月写作字数 */
  monthlyWords: number[]
  /** 写作字数最多的项目名（无数据为 null） */
  topProject: string | null
}

/** 按年聚合每日活动数据（年份过滤 + 统计 + 月度分布 + top 项目） */
export function buildYearlySummary(days: DailyActivityRow[], year: number): YearlySummary {
  const prefix = `${year}-`
  const yearDays = days.filter(d => d.day.startsWith(prefix))

  const monthlyWords = Array<number>(12).fill(0)
  let totalWrittenWords = 0
  let totalRevisedWords = 0
  let totalChapters = 0
  let totalCalls = 0
  let totalTokens = 0
  let totalCost = 0
  let activeDays = 0

  const projectWords = new Map<string, number>()
  let topProject: string | null = null

  for (const d of yearDays) {
    totalWrittenWords += d.writtenWords
    totalRevisedWords += d.revisedWords
    totalChapters += d.writtenCount
    totalCalls += d.llmCalls
    totalTokens += d.llmTokens
    totalCost += d.llmCost
    if (d.writtenWords > 0 || d.revisedWords > 0) activeDays++

    const month = parseInt(d.day.slice(5, 7), 10)
    if (month >= 1 && month <= 12) monthlyWords[month - 1] += d.writtenWords

    if (d.writtenWords > 0) {
      const acc = (projectWords.get(d.projectName) ?? 0) + d.writtenWords
      projectWords.set(d.projectName, acc)
    }
  }
  if (projectWords.size > 0) {
    topProject = [...projectWords.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  return {
    year,
    totalWrittenWords,
    totalRevisedWords,
    totalChapters,
    totalCalls,
    totalTokens,
    totalCost: Math.round(totalCost * 1000) / 1000,
    activeDays,
    monthlyWords,
    topProject,
  }
}

/** HTML 转义（项目名/文本可能含用户输入） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 数字千分位（报告语言跟随界面语言） */
function fmt(n: number, locale: SupportedLocale): string {
  return n.toLocaleString(locale)
}

/** 费用美元格式 */
function fmtCost(cost: number, locale: SupportedLocale): string {
  return `$${cost.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * 生成 1200px 宽年度报告分享卡 HTML（内联样式，零外部依赖——
 * 主进程离屏截图窗口通过 data URL 加载）。
 */
export function buildYearlyReportHTML(summary: YearlySummary, locale: SupportedLocale): string {
  const maxMonth = Math.max(...summary.monthlyWords, 1)
  const bars = summary.monthlyWords.map((words, i) => {
    const h = Math.max(words > 0 ? 4 : 1, Math.round((words / maxMonth) * 100))
    return `
      <div class="bar-col">
        <div class="bar" style="height:${h}%">
          ${words > 0 ? `<span class="bar-val">${fmt(words, locale)}</span>` : ''}
        </div>
        <span class="bar-label">${i + 1}月</span>
      </div>`
  }).join('')

  const card = (label: string, value: string, sub?: string) => `
    <div class="stat-card">
      <div class="stat-value">${value}</div>
      <div class="stat-label">${label}</div>
      ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
    </div>`

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, sans-serif;
    background: linear-gradient(135deg, #0A1628 0%, #13233D 55%, #1A2A4A 100%);
    color: #E8EEF7;
    padding: 48px 56px;
  }
  .header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 36px; }
  .brand { font-size: 22px; font-weight: 700; letter-spacing: 1px;
    background: linear-gradient(90deg, #7EC8E3, #9B8EC8, #C9A76C);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .title { font-size: 34px; font-weight: 800; margin-top: 6px; }
  .year-badge { font-size: 20px; font-weight: 700; color: #9B8EC8; border: 2px solid rgba(155,142,200,.45);
    padding: 6px 18px; border-radius: 999px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 36px; }
  .stat-card { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09);
    border-radius: 16px; padding: 20px; }
  .stat-value { font-size: 30px; font-weight: 800; color: #7EC8E3; }
  .stat-label { font-size: 13px; color: rgba(232,238,247,.65); margin-top: 4px; }
  .stat-sub { font-size: 11px; color: rgba(232,238,247,.4); margin-top: 2px; }
  .section-title { font-size: 15px; font-weight: 700; color: rgba(232,238,247,.85); margin-bottom: 14px; }
  .chart { display: flex; align-items: flex-end; gap: 10px; height: 220px;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07);
    border-radius: 16px; padding: 18px 20px 12px; }
  .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }
  .bar { width: 70%; border-radius: 6px 6px 0 0;
    background: linear-gradient(180deg, #7EC8E3, #9B8EC8); position: relative; min-height: 1px; }
  .bar-val { position: absolute; top: -18px; left: 50%; transform: translateX(-50%);
    font-size: 10px; color: rgba(232,238,247,.55); white-space: nowrap; }
  .bar-label { font-size: 11px; color: rgba(232,238,247,.5); margin-top: 8px; }
  .footer { display: flex; justify-content: space-between; align-items: center; margin-top: 30px;
    font-size: 12px; color: rgba(232,238,247,.4); }
  .top-project { font-size: 13px; color: #C9A76C; font-weight: 600; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">NovelForge</div>
      <div class="title">${escapeHtml(t('report.title'))}</div>
    </div>
    <div class="year-badge">${summary.year}</div>
  </div>

  <div class="stats">
    ${card(t('activity.totalWritten'), fmt(summary.totalWrittenWords, locale), t('report.subWords').replace('{n}', fmt(summary.totalRevisedWords, locale)))}
    ${card(t('report.chapters'), fmt(summary.totalChapters, locale), t('report.subDays').replace('{n}', String(summary.activeDays)))}
    ${card(t('activity.totalCalls'), fmt(summary.totalCalls, locale), t('report.subTokens').replace('{n}', fmt(summary.totalTokens, locale)))}
    ${card(t('report.cost'), fmtCost(summary.totalCost, locale), t('report.subCalls'))}
  </div>

  <div class="section-title">${escapeHtml(t('report.monthlyChart'))}</div>
  <div class="chart">${bars}</div>

  <div class="footer">
    <span>${summary.topProject ? t('report.topProject').replace('{name}', escapeHtml(summary.topProject)) : escapeHtml(t('report.noData'))}</span>
    <span>NovelForge · ${new Date().getFullYear()}</span>
  </div>
</body>
</html>`
}
