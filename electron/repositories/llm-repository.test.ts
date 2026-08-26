/**
 * LLMHistoryRepository 用量统计测试
 *
 * better-sqlite3 编译目标为 Electron (NODE_MODULE_VERSION 145)，
 * vitest 运行环境为 Node.js，无法加载原生模块 —— 与 activity-repository.test.ts 同策略：
 * 此处验证无 DB 时的空分支与 SQL 构建逻辑，运行时聚合由 Electron 集成验证。
 */
import { describe, it, expect, vi } from 'vitest'

// mock database 模块，避免加载 better-sqlite3
vi.mock('../database', () => ({
  getProjectDb: () => null,
}))

// 延迟导入（mock 生效后）
const { LLMHistoryRepository } = await import('./llm-repository')

describe('LLMHistoryRepository.getUsageStats', () => {
  it('无项目 DB 时返回空聚合（不抛错）', () => {
    const result = LLMHistoryRepository.getUsageStats(0, Date.now())
    expect(result.byPurpose).toEqual([])
    expect(result.byModel).toEqual([])
    expect(result.total).toEqual({ calls: 0, cost: 0 })
  })

  it('区间参数透传（from/to 毫秒时间戳，不抛错）', () => {
    expect(() => LLMHistoryRepository.getUsageStats(1, 999)).not.toThrow()
    expect(() => LLMHistoryRepository.getUsageStats(0, 0)).not.toThrow()
  })

  it('返回结构字段完整（空态契约）', () => {
    const result = LLMHistoryRepository.getUsageStats(0, 0)
    expect(Array.isArray(result.byPurpose)).toBe(true)
    expect(Array.isArray(result.byModel)).toBe(true)
    expect(result.total).toHaveProperty('calls')
    expect(result.total).toHaveProperty('cost')
  })
})

describe('usage-stats SQL 构建契约（与 database.ts llm_calls 表结构对照）', () => {
  // 提取 SQL 片段检查（通过源码字符串，防止表名/字段拼写漂移）
  const src = LLMHistoryRepository.getUsageStats.toString()

  it('仅统计成功调用（success=1，与 getStats 口径一致）', () => {
    expect(src).toContain('success = 1')
    expect(src).toContain('FROM llm_calls')
  })

  it('purpose 维度：按用途分组合计 + cached_tokens 汇总', () => {
    expect(src).toContain('GROUP BY purpose')
    expect(src).toContain('SUM(prompt_tokens)')
    expect(src).toContain('SUM(completion_tokens)')
    expect(src).toContain('SUM(cached_tokens)')
    expect(src).toContain('SUM(cost)')
    expect(src).toContain('COUNT(*) as calls')
  })

  it('模型维度：按 model_name 分组合计（别名 model）', () => {
    expect(src).toContain('model_name as model')
    expect(src).toContain('GROUP BY model_name')
  })

  it('时间区间过滤：created_at 毫秒时间戳 from/to 双向', () => {
    expect(src).toContain('created_at >= ?')
    expect(src).toContain('created_at <= ?')
  })
})
