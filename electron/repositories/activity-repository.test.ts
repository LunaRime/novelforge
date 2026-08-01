/**
 * ActivityRepository 每日活动聚合测试
 *
 * better-sqlite3 编译目标为 Electron (NODE_MODULE_VERSION 145)，
 * vitest 运行环境为 Node.js，无法加载原生模块 —— 与 database.test.ts 同策略：
 * 此处验证无 DB 时的空分支与 SQL 构建逻辑，运行时聚合由 Electron 集成验证。
 */
import { describe, it, expect, vi } from 'vitest'

// mock database 模块，避免加载 better-sqlite3
vi.mock('../database', () => ({
  getProjectDb: () => null,
}))

// 延迟导入（mock 生效后）
const { ActivityRepository } = await import('./activity-repository')

describe('ActivityRepository.getDailyActivity', () => {
  it('无项目 DB 时返回空结构', () => {
    const result = ActivityRepository.getDailyActivity(90)
    // endDay 恒为今天（本地时区 YYYY-MM-DD），无数据时 days/projects 为空
    expect(result.days).toEqual([])
    expect(result.projects).toEqual([])
    expect(result.dayCount).toBe(0)
    expect(result.endDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('days 参数透传（默认 90）', () => {
    // 无 DB 分支不依赖参数，仅验证 API 签名不抛错
    expect(() => ActivityRepository.getDailyActivity(30)).not.toThrow()
    expect(() => ActivityRepository.getDailyActivity()).not.toThrow()
  })

  it('返回结构字段完整（空态契约）', () => {
    const result = ActivityRepository.getDailyActivity()
    expect(result).toHaveProperty('days')
    expect(result).toHaveProperty('projects')
    expect(result).toHaveProperty('startDay')
    expect(result).toHaveProperty('endDay')
    expect(result).toHaveProperty('dayCount')
    expect(Array.isArray(result.days)).toBe(true)
    expect(Array.isArray(result.projects)).toBe(true)
  })
})

describe('聚合 SQL 构建契约（与 database.ts 表结构对照）', () => {
  // 提取 SQL 片段检查（通过源码字符串，防止表名/字段拼写漂移）
  const src = ActivityRepository.getDailyActivity.toString()

  it('写作聚合：drafts source=write 按天分组', () => {
    expect(src).toContain("FROM drafts")
    expect(src).toContain("source = 'write'")
    expect(src).toContain("GROUP BY day")
    expect(src).toContain('SUM(word_count)')
  })

  it('修改聚合：drafts(rewrite) + revisions 合并', () => {
    expect(src).toContain("source = 'rewrite'")
    expect(src).toContain('UNION ALL')
    expect(src).toContain('FROM revisions')
  })

  it('模型调用聚合：llm_calls 仅成功调用', () => {
    expect(src).toContain('FROM llm_calls')
    expect(src).toContain('success = 1')
    expect(src).toContain('SUM(total_tokens)')
  })

  it('时间戳转换使用本地时区（unixepoch + localtime）', () => {
    // 毫秒时间戳 → 秒 → 本地时区日期
    expect(src).toContain("/1000, 'unixepoch', 'localtime'")
  })

  it('时间范围过滤：created_at >= startMs', () => {
    expect(src).toContain('created_at >= ?')
  })
})
