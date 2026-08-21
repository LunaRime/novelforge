import { describe, it, expect } from 'vitest'
import { computeContextUsage } from './context-usage'

describe('computeContextUsage', () => {
  it('各段独立计数，记忆段不与基础段双计', () => {
    const usage = computeContextUsage({
      base: '身份L0L1Tool'.repeat(100),
      memory: '记忆内容'.repeat(20),
      historyMessages: [{ role: 'user', content: '历史' }],
      currentContent: '当前消息',
      modelMax: 131072,
    })
    expect(usage.base).toBeGreaterThan(0)
    expect(usage.memory).toBeGreaterThan(0)
    // total = 四段之和（无双计）
    expect(usage.total).toBe(usage.base + usage.memory + usage.history + usage.current)
    expect(usage.modelMax).toBe(131072)
  })

  it('modelMax: 0 时正常计算且 total 仍为各段之和（不除零不 NaN）', () => {
    const usage = computeContextUsage({
      base: '基础段', memory: '记忆段',
      historyMessages: [{ role: 'user', content: '历史' }],
      currentContent: '当前',
      modelMax: 0,
    })
    expect(usage.modelMax).toBe(0)
    expect(usage.total).toBe(usage.base + usage.memory + usage.history + usage.current)
    expect(Number.isNaN(usage.total)).toBe(false)
  })

  it('空段（空字符串/空历史）时 total = 0', () => {
    const usage = computeContextUsage({
      base: '', memory: '', historyMessages: [], currentContent: '',
      modelMax: 131072,
    })
    expect(usage.base).toBe(0)
    expect(usage.total).toBe(0)
    expect(usage.history).toBe(0)
  })
})
