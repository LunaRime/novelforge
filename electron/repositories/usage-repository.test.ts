/**
 * UsageRepository 跨项目聚合测试
 *
 * better-sqlite3 编译目标为 Electron (NODE_MODULE_VERSION 145)，
 * vitest 运行环境为 Node.js，无法构造数据库连接 —— 与 activity-repository.test.ts 同策略：
 * 此处验证纯函数逻辑（SQL 构建契约/项目过滤/降级分支），逐项目运行时聚合由 Electron 集成验证。
 */
import { describe, it, expect } from 'vitest'
import { buildGlobalAggregationQuery, filterAvailableProjects } from './usage-repository'

describe('buildGlobalAggregationQuery', () => {
  it('purpose 维度分组聚合（与当前项目面板 getUsageStats 同口径）', () => {
    const sql = buildGlobalAggregationQuery()
    expect(sql).toContain('GROUP BY purpose')
    expect(sql).toContain('SUM(prompt_tokens)')
    expect(sql).toContain('SUM(completion_tokens)')
    expect(sql).toContain('SUM(cached_tokens)')
    expect(sql).toContain('SUM(cost)')
    expect(sql).toContain('COUNT(*) as calls')
  })

  it('仅统计成功调用（success=1，与 LLMHistoryRepository 口径一致）', () => {
    const sql = buildGlobalAggregationQuery()
    expect(sql).toContain('FROM llm_calls')
    expect(sql).toContain('success = 1')
  })

  it('缺 cached_tokens 列降级：SQL 不引用该列（按 0 聚合）', () => {
    const sql = buildGlobalAggregationQuery(false)
    expect(sql).not.toContain('SUM(cached_tokens)')
    expect(sql).toContain('0 as cachedTokens')
  })

  it('缺 cost 列降级：SQL 不引用该列（按 0 聚合）', () => {
    const sql = buildGlobalAggregationQuery(true, false)
    expect(sql).not.toContain('SUM(cost)')
    expect(sql).toContain('0 as cost')
  })
})

describe('filterAvailableProjects', () => {
  it('仅保留真实存在的路径', () => {
    expect(filterAvailableProjects([{ path: 'E:/不存在/x', name: 'x' }])).toEqual([])
  })

  it('保留存在的项目', () => {
    const projects = filterAvailableProjects([
      { path: '.', name: 'cwd' },
      { path: 'E:/不存在/x', name: 'x' },
    ])
    expect(projects.map(p => p.name)).toEqual(['cwd'])
  })
})
