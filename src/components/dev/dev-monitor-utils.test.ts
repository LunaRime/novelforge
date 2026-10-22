import { describe, it, expect } from 'vitest'
import { successRate, formatDuration, aggregateRecentByModel } from './dev-monitor-utils'

describe('dev-monitor-utils', () => {
  it('成功率与耗时格式化', () => {
    expect(successRate(9, 10)).toBe('90.0%')
    expect(successRate(0, 0)).toBe('—')
    expect(formatDuration(1234)).toBe('1.23s')
    expect(formatDuration(12)).toBe('12.0ms')
  })

  it('按模型聚合最近调用', () => {
    const rows = [
      { modelName: 'a', success: 1, durationMs: 100 },
      { modelName: 'a', success: 0, durationMs: 300 },
      { modelName: 'b', success: 1, durationMs: 50 },
    ]
    expect(aggregateRecentByModel(rows)).toEqual([
      { model: 'a', calls: 2, errors: 1, avgMs: 200 },
      { model: 'b', calls: 1, errors: 0, avgMs: 50 },
    ])
  })
})