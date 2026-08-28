/**
 * UsageRepository — 跨项目 token 聚合（设置 → 用量 → 全部项目）
 *
 * 项目列表来源：全局配置最近项目（~/.novelforge/config.json 的 recentProjects，渲染进程打开项目时同步）
 * + 当前打开项目（getCurrentProjectPath——新打开尚未写入全局配置的项目也始终纳入）。
 * 逐项目以只读连接打开项目库（{project}/.novelforge/vela.db，连接失败跳过，同 ActivityRepository.openProjectDb），
 * 聚合 llm_calls（success=1 口径，与当前项目面板 LLMHistoryRepository.getUsageStats 一致）。
 * 旧库（user_version < 16）缺 cached_tokens 列时按 0 聚合并在该项目标记 degraded（不抛错不静默缺失）。
 * 60 秒结果缓存（同 ActivityRepository.getDailyActivity）。
 */
import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'

import { ActivityRepository } from './activity-repository'
import { getProjectVelaDir } from '../utils/config-utils'

/** 全局用量统计 — 项目维度行 */
export interface GlobalProjectUsage {
  path: string
  name: string
  calls: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  cost: number
  /** 旧库缺 cached_tokens 列——缓存命中未统计（按 0 聚合，与其它项目不可直接比较） */
  degraded: boolean
}

/** 全局用量统计查询结果 */
export interface GlobalUsageStats {
  projects: GlobalProjectUsage[]
  total: { calls: number; cost: number; cachedTokens: number }
  /** 降级项目路径列表（degraded=true 的项目） */
  degradedProjects: string[]
}

/**
 * 项目内部聚合 SQL（purpose 维度，与 LLMHistoryRepository.getUsageStats 同口径）
 * 跨项目聚合时每项目执行一次：得到各用途行后由调用方横向汇总为项目行与全局合计。
 * @param includeCachedTokens 旧库缺 cached_tokens 列时传 false——该列按 0 汇总（降级）
 * @param includeCost 更旧的库缺 cost 列时传 false——费用按 0 汇总（避免该列缺失导致整个项目查询失败）
 */
export function buildGlobalAggregationQuery(includeCachedTokens = true, includeCost = true): string {
  return `
    SELECT purpose,
      COUNT(*) as calls,
      COALESCE(SUM(prompt_tokens), 0) as promptTokens,
      COALESCE(SUM(completion_tokens), 0) as completionTokens,
      ${includeCachedTokens ? 'COALESCE(SUM(cached_tokens), 0) as cachedTokens' : '0 as cachedTokens'},
      ${includeCost ? 'COALESCE(SUM(cost), 0) as cost' : '0 as cost'}
    FROM llm_calls WHERE success = 1
    GROUP BY purpose
  `
}

/** 项目过滤：仅保留磁盘上真实存在的路径（fs.existsSync） */
export function filterAvailableProjects(projects: Array<{ path: string; name: string }>): Array<{ path: string; name: string }> {
  return projects.filter(p => p?.path && fs.existsSync(p.path))
}

/** 打开一个项目库只读（同 ActivityRepository.openProjectDb：失败返回 null 由调用方跳过） */
function openProjectDb(projectPath: string): Database.Database | null {
  const dbPath = path.join(getProjectVelaDir(projectPath), 'vela.db')
  if (!fs.existsSync(dbPath)) return null
  try {
    return new Database(dbPath, { readonly: true })
  } catch {
    return null
  }
}

/** 60 秒内存缓存（同 ActivityRepository：面板高频刷新时避免反复扫描所有项目库） */
let cache: { key: string; data: GlobalUsageStats; at: number } | null = null
const CACHE_TTL = 60_000

/**
 * 跨项目 token 聚合（所有最近项目 + 当前项目）
 * @param currentProjectPath 当前打开的项目（始终纳入——最近列表只含已写入全局配置且存在的路径）
 */
export function getGlobalUsageStats(currentProjectPath?: string): GlobalUsageStats {
  // 缓存命中（60 秒内同参数）
  const cacheKey = currentProjectPath ?? ''
  if (cache?.key === cacheKey && Date.now() - cache.at < CACHE_TTL) {
    return cache.data
  }

  // 项目列表：全局配置最近项目（仅真实存在路径）+ 当前项目始终纳入（同 getDailyActivity 语义）
  const projects = filterAvailableProjects(ActivityRepository.getRecentProjects())
  if (currentProjectPath && !projects.some(p => p.path === currentProjectPath)) {
    if (fs.existsSync(path.join(getProjectVelaDir(currentProjectPath), 'vela.db'))) {
      projects.push({ path: currentProjectPath, name: path.basename(currentProjectPath) })
    }
  }

  const result: GlobalUsageStats = { projects: [], total: { calls: 0, cost: 0, cachedTokens: 0 }, degradedProjects: [] }

  for (const proj of projects) {
    const db = openProjectDb(proj.path)
    if (!db) continue
    try {
      // 旧库（user_version < 16）缺 cached_tokens 列——SUM(cached_tokens) 会抛 no such column。
      // 先查列再构建 SQL：缺列时按 0 聚合并标记 degraded（不抛错、不静默缺失）
      const cols = (db.prepare('PRAGMA table_info(llm_calls)').all() as Array<{ name: string }>).map(c => c.name)
      const hasCached = cols.includes('cached_tokens')
      // 更旧的库可能缺 cost 列（主进程打开时才补齐）——缺列时费用按 0，避免该项目整体跳过（同 activity-repository 处理）
      const rows = db.prepare(buildGlobalAggregationQuery(hasCached, cols.includes('cost'))).all() as Array<{
        calls: number; promptTokens: number; completionTokens: number; cachedTokens: number; cost: number
      }>
      // purpose 行横向汇总为项目行（SUM 可交换，与无分组聚合等价）
      const agg = rows.reduce(
        (acc, r) => ({
          calls: acc.calls + r.calls,
          promptTokens: acc.promptTokens + r.promptTokens,
          completionTokens: acc.completionTokens + r.completionTokens,
          cachedTokens: acc.cachedTokens + r.cachedTokens,
          cost: acc.cost + r.cost,
        }),
        { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 },
      )
      result.projects.push({ path: proj.path, name: proj.name || path.basename(proj.path), ...agg, degraded: !hasCached })
      if (!hasCached) result.degradedProjects.push(proj.path)
    } catch {
      // 查询失败（更旧的库缺其它列等）——跳过该项目，不中断全局聚合
    } finally {
      db.close()
    }
  }

  // 项目表按调用次数降序（高频项目优先）
  result.projects.sort((a, b) => b.calls - a.calls)
  result.total = result.projects.reduce(
    (acc, p) => ({ calls: acc.calls + p.calls, cost: acc.cost + p.cost, cachedTokens: acc.cachedTokens + p.cachedTokens }),
    { calls: 0, cost: 0, cachedTokens: 0 },
  )

  cache = { key: cacheKey, data: result, at: Date.now() }
  return result
}
