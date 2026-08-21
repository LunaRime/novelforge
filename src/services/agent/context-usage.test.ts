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
})
