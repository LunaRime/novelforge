import { getProjectDb } from '../database'

/** 单日活动数据（本地时区按天聚合） */
export interface DailyActivityRow {
  day: string                  // 'YYYY-MM-DD'
  writtenWords: number         // 当天人工/导入写作的字数（drafts source='write'）
  writtenCount: number         // 当天创建的草稿版本数
  revisedWords: number         // 当天修改的字数（AI 重写草稿 + 修稿）
  revisedCount: number         // 当天修改次数
  llmCalls: number             // 当天成功模型调用次数
  llmTokens: number            // 当天模型调用消耗 tokens
}

/** 每日活动查询结果 */
export interface DailyActivityData {
  days: DailyActivityRow[]
  startDay: string
  endDay: string
  dayCount: number
}

/**
 * 活动统计 Repository — GitHub 风格每日活动图的数据源
 *
 * 三条数据链按天聚合（毫秒时间戳 → 本地时区日期）：
 * 1. 写作字数：drafts（source='write'，人工/导入写作）
 * 2. 修改量：drafts（source='rewrite'，AI 重写）+ revisions（修稿）
 * 3. 模型调用：llm_calls（success=1）
 */
export class ActivityRepository {
  /** 按天聚合活动数据（最近 days 天，默认 90） */
  static getDailyActivity(days = 90): DailyActivityData {
    const db = getProjectDb()
    if (!db) return { days: [], startDay: '', endDay: '', dayCount: 0 }

    // 起始时间：days 天前的本地零点（毫秒）
    const now = new Date()
    const startMs = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (days - 1),
    ).getTime()

    // 毫秒时间戳 → 本地时区日期字符串（YYYY-MM-DD）
    const dayFmt = (col: string) => `date(${col}/1000, 'unixepoch', 'localtime')`

    // 1. 写作：人工/导入创建的草稿
    const written = db.prepare(`
      SELECT ${dayFmt('created_at')} as day,
             SUM(word_count) as words,
             COUNT(*) as count
      FROM drafts
      WHERE source = 'write' AND created_at >= ?
      GROUP BY day
    `).all(startMs) as Array<{ day: string; words: number; count: number }>

    // 2. 修改：AI 重写草稿 + 修稿
    const revised = db.prepare(`
      SELECT ${dayFmt('created_at')} as day,
             SUM(word_count) as words,
             COUNT(*) as count
      FROM (
        SELECT created_at, word_count FROM drafts WHERE source = 'rewrite' AND created_at >= ?
        UNION ALL
        SELECT created_at, word_count FROM revisions WHERE created_at >= ?
      )
      GROUP BY day
    `).all(startMs, startMs) as Array<{ day: string; words: number; count: number }>

    // 3. 模型调用：成功调用按天聚合
    const llm = db.prepare(`
      SELECT ${dayFmt('created_at')} as day,
             COUNT(*) as calls,
             COALESCE(SUM(total_tokens), 0) as tokens
      FROM llm_calls
      WHERE success = 1 AND created_at >= ?
      GROUP BY day
    `).all(startMs) as Array<{ day: string; calls: number; tokens: number }>

    // 合并为 day → 行
    const map = new Map<string, DailyActivityRow>()
    const merge = (day: string, patch: Partial<DailyActivityRow>) => {
      const cur = map.get(day) ?? {
        day,
        writtenWords: 0,
        writtenCount: 0,
        revisedWords: 0,
        revisedCount: 0,
        llmCalls: 0,
        llmTokens: 0,
      }
      map.set(day, { ...cur, ...patch })
    }
    for (const w of written) merge(w.day, { writtenWords: w.words, writtenCount: w.count })
    for (const r of revised) merge(r.day, { revisedWords: r.words, revisedCount: r.count })
    for (const l of llm) merge(l.day, { llmCalls: l.calls, llmTokens: l.tokens })

    const sorted = Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day))

    const endDay = now.toISOString().slice(0, 10)
    const startDay = sorted[0]?.day ?? endDay
    return { days: sorted, startDay, endDay, dayCount: sorted.length }
  }
}
