import { describe, it, expect } from 'vitest'
import {
  THINKING_LEVELS, DEFAULT_THINKING_LEVEL, isThinkingLevel, thinkingLevelSpec,
} from './thinking-level'

describe('thinking-level', () => {
  it('四档温度映射固定', () => {
    expect(THINKING_LEVELS.map(l => [l.id, l.temperature])).toEqual([
      ['off', 0.1], ['low', 0.3], ['high', 0.7], ['max', 1.2],
    ])
  })

  it('默认 High', () => {
    expect(DEFAULT_THINKING_LEVEL).toBe('high')
  })

  it('isThinkingLevel 拒绝旧六档值与非法值', () => {
    expect(isThinkingLevel('high')).toBe(true)
    expect(isThinkingLevel('deep')).toBe(false)
    expect(isThinkingLevel(3)).toBe(false)
  })

  it('映射到现有 AgentMode', () => {
    expect(thinkingLevelSpec('off').agentMode).toBe('quick')
    expect(thinkingLevelSpec('low').agentMode).toBe('balanced')
    expect(thinkingLevelSpec('high').agentMode).toBe('deep')
    expect(thinkingLevelSpec('max').agentMode).toBe('max')
  })
})
