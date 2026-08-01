import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'

import { readJsonFile, GLOBAL_CONFIG_PATH } from '../utils/config-utils'

/** 单日活动数据（本地时区按天聚合） */
export interface DailyActivityRow {
  day: string                  // 'YYYY-MM-DD'
  writtenWords: number         // 当天人工/导入写作的字数（drafts source='write'）
  writtenCount: number         // 当天创建的草稿版本数
  revisedWords: number         // 当天修改的字数（AI 重写草稿 + 修稿）
  revisedCount: number         // 当天修改次数
  llmCalls: number             // 当天成功模型调用次数
  llmTokens: number            // 当天模型调用消耗 tokens
  llmCost: number              // 当天模型调用费用（美元）
  projectPath: string          // 来源项目
  projectName: string          // 来源项目名
}

/** 每日活动查询结果 */
export interface DailyActivityData {
  days: DailyActivityRow[]
  projects: Array<{ path: string; name: string }>
  startDay: string
  endDay: string
  dayCount: number
}

/** 全局配置中的最近项目（与渲染进程 project-store 同步） */
interface ConfigRecentProject {
  name: string
  path: string
  updatedAt?: number
}

/**
 * 活动统计 Repository — GitHub 风格每日活动图的数据源
 *
 * 跨项目聚合（最近项目列表来自全局配置 ~/.vela/config.json，
 * 由渲染进程打开项目时同步）：
 * 1. 写作字数：drafts（source='write'）
 * 2. 修改量：drafts（source='rewrite'）+ revisions
 * 3. 模型调用：llm_calls（success=1，含费用 cost）
 */
export class ActivityRepository {
  /** 获取最近项目列表（全局配置） */
  static getRecentProjects(): ConfigRecentProject[] {
    const cfg = readJsonFile<{ recentProjects?: ConfigRecentProject[] }>(GLOBAL_CONFIG_PATH, { recentProjects: [] })
    return (cfg?.recentProjects ?? []).filter(p => p?.path && fs.existsSync(p.path))
  }

  /** 打开一个项目 DB 只读查询（当前项目用共享连接，其余临时只读打开） */
  private static openProjectDb(projectPath: string): Database.Database | null {
    const dbPath = path.join(projectPath, '.vela', 'vela.db')
    if (!fs.existsSync(dbPath)) return null
    try {
      return new Database(dbPath, { readonly: true })
    } catch {
      return null
    }
  }

  /** 60 秒内存缓存（避免活动面板高频刷新时反复扫描所有项目 DB） */
  private static cache: { key: string; data: DailyActivityData; at: number } | null = null
  private static readonly CACHE_TTL = 60_000

  /**
   * 按天聚合活动数据（最近 days 天，跨所有最近项目）
   * @param filterPath 仅查指定项目（''/undefined = 全部）
   * @param currentProjectPath 当前打开的项目（始终纳入，即使尚未写入最近列表）
   */
  static getDailyActivity(days = 90, filterPath?: string, currentProjectPath?: string): DailyActivityData {
    // 缓存命中（60 秒内同参数）
    const cacheKey = `${days}|${filterPath ?? ''}|${currentProjectPath ?? ''}`
    if (ActivityRepository.cache?.key === cacheKey && Date.now() - ActivityRepository.cache.at < ActivityRepository.CACHE_TTL) {
      return ActivityRepository.cache.data
    }

    const now = new Date()
    const startMs = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (days - 1),
    ).getTime()

    // 项目列表：全部最近项目 或 指定项目；当前项目始终纳入
    let projects = ActivityRepository.getRecentProjects()
    if (filterPath) {
      projects = projects.filter(p => p.path === filterPath)
    }
    if (currentProjectPath) {
      const exists = projects.some(p => p.path === currentProjectPath)
      if (!exists && fs.existsSync(path.join(currentProjectPath, '.vela', 'vela.db'))) {
        projects.push({ name: path.basename(currentProjectPath), path: currentProjectPath })
      }
    }
    if (projects.length === 0) {
      return { days: [], projects: [], startDay: '', endDay: '', dayCount: 0 }
    }

    const dayFmt = (col: string) => `date(${col}/1000, 'unixepoch', 'localtime')`

    const allDays: DailyActivityRow[] = []
    const projectMeta: Array<{ path: string; name: string }> = []

    for (const proj of projects) {
      const db = ActivityRepository.openProjectDb(proj.path)
      if (!db) continue
      try {
        projectMeta.push({ path: proj.path, name: proj.name || path.basename(proj.path) })

        // 1. 写作
        const written = db.prepare(`
          SELECT ${dayFmt('created_at')} as day, SUM(word_count) as words, COUNT(*) as count
          FROM drafts WHERE source = 'write' AND created_at >= ?
          GROUP BY day
        `).all(startMs) as Array<{ day: string; words: number; count: number }>

        // 2. 修改
        const revised = db.prepare(`
          SELECT ${dayFmt('created_at')} as day, SUM(word_count) as words, COUNT(*) as count
          FROM (
            SELECT created_at, word_count FROM drafts WHERE source = 'rewrite' AND created_at >= ?
            UNION ALL
            SELECT created_at, word_count FROM revisions WHERE created_at >= ?
          )
          GROUP BY day
        `).all(startMs, startMs) as Array<{ day: string; words: number; count: number }>

        // 3. 模型调用（含费用）
        // 兼容旧库：cost 列由主进程打开项目时迁移补齐，但这里用只读连接打开
        // 其他项目 DB（不执行迁移）——旧库可能没有 cost 列，查询时检测降级
        const hasCost = (db.prepare(`PRAGMA table_info(llm_calls)`).all() as Array<{ name: string }>)
          .some(c => c.name === 'cost')
        const llm = db.prepare(`
          SELECT ${dayFmt('created_at')} as day, COUNT(*) as calls,
                 COALESCE(SUM(total_tokens), 0) as tokens,
                 ${hasCost ? 'COALESCE(SUM(cost), 0) as cost' : '0 as cost'}
          FROM llm_calls WHERE success = 1 AND created_at >= ?
          GROUP BY day
        `).all(startMs) as Array<{ day: string; calls: number; tokens: number; cost: number }>

        const byDay = new Map<string, DailyActivityRow>()
        const merge = (day: string, patch: Partial<DailyActivityRow>) => {
          const cur = byDay.get(day) ?? {
            day, writtenWords: 0, writtenCount: 0, revisedWords: 0, revisedCount: 0,
            llmCalls: 0, llmTokens: 0, llmCost: 0,
            projectPath: proj.path, projectName: proj.name || path.basename(proj.path),
          }
          byDay.set(day, { ...cur, ...patch })
        }
        for (const w of written) merge(w.day, { writtenWords: w.words, writtenCount: w.count })
        for (const r of revised) merge(r.day, { revisedWords: r.words, revisedCount: r.count })
        for (const l of llm) merge(l.day, { llmCalls: l.calls, llmTokens: l.tokens, llmCost: l.cost })

        allDays.push(...byDay.values())
      } finally {
        db.close()
      }
    }

    allDays.sort((a, b) => a.day.localeCompare(b.day) || a.projectPath.localeCompare(b.projectPath))

    const endDay = now.toISOString().slice(0, 10)
    const startDay = allDays[0]?.day ?? endDay
    const result: DailyActivityData = { days: allDays, projects: projectMeta, startDay, endDay, dayCount: allDays.length }
    ActivityRepository.cache = { key: cacheKey, data: result, at: Date.now() }
    return result
  }
}
