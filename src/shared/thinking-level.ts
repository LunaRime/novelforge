import type { TextKey } from './locale'

/** 四档思考等级（取代旧六档 quick/swift/balanced/reflective/deep/max） */
export type ThinkingLevel = 'off' | 'low' | 'high' | 'max'

/** 复用 Agent 运行时既有模式名；仅使用其中四档 */
export type ThinkingAgentMode = 'quick' | 'balanced' | 'deep' | 'max'

export interface ThinkingLevelSpec {
  id: ThinkingLevel
  temperature: number
  agentMode: ThinkingAgentMode
  labelKey: TextKey
  descKey: TextKey
}

const SPEC_BY_ID: Record<ThinkingLevel, ThinkingLevelSpec> = {
  off: {
    id: 'off',
    temperature: 0.1,
    agentMode: 'quick',
    labelKey: 'agent.thinkingOff',
    descKey: 'agent.thinkingOffDesc',
  },
  low: {
    id: 'low',
    temperature: 0.3,
    agentMode: 'balanced',
    labelKey: 'agent.thinkingLow',
    descKey: 'agent.thinkingLowDesc',
  },
  high: {
    id: 'high',
    temperature: 0.7,
    agentMode: 'deep',
    labelKey: 'agent.thinkingHigh',
    descKey: 'agent.thinkingHighDesc',
  },
  max: {
    id: 'max',
    temperature: 1.2,
    agentMode: 'max',
    labelKey: 'agent.thinkingMax',
    descKey: 'agent.thinkingMaxDesc',
  },
}

/** 展示顺序即强度顺序：off → low → high → max */
export const THINKING_LEVELS: readonly ThinkingLevelSpec[] = [
  SPEC_BY_ID.off,
  SPEC_BY_ID.low,
  SPEC_BY_ID.high,
  SPEC_BY_ID.max,
]

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'high'

export function isThinkingLevel(v: unknown): v is ThinkingLevel {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPEC_BY_ID, v)
}

export function thinkingLevelSpec(level: ThinkingLevel): ThinkingLevelSpec {
  // 防御旧六档值（swift/reflective/deep）或脏数据：回退默认档规格
  const spec = (SPEC_BY_ID as Record<string, ThinkingLevelSpec | undefined>)[level]
  return spec ?? SPEC_BY_ID[DEFAULT_THINKING_LEVEL]
}
