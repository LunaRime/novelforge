/**
 * 前缀记账测试（B 档第二轮 T3）
 *
 * 靶点：`rollingSummary` 注入 system 尾部 → 每轮压缩都改写前缀、缓存必然失效；
 * 而引擎注释声称"前缀稳定"却无任何校验。本模块只**记账**（不做硬拒绝）。
 */
import { describe, it, expect } from 'vitest'
import { computePrefixFingerprint, comparePrefix } from './prefix-accounting'

describe('computePrefixFingerprint', () => {
  it('同一文本 → 指纹相同且稳定（长度 12）', () => {
    const a = computePrefixFingerprint('你是 NovelForge 助手')
    const b = computePrefixFingerprint('你是 NovelForge 助手')
    expect(a).toBe(b)
    expect(a).toHaveLength(12)
  })

  it('文本变化 → 指纹变化', () => {
    expect(computePrefixFingerprint('前缀 A'))
      .not.toBe(computePrefixFingerprint('前缀 B'))
  })

  it('空文本 → 空指纹（调用方据此跳过记账）', () => {
    expect(computePrefixFingerprint('')).toBe('')
  })
})

describe('comparePrefix', () => {
  it('无上轮指纹（首轮）→ changed=false（不告警）', () => {
    expect(comparePrefix('', 'abc')).toEqual({ changed: false, sharedChars: 0 })
  })

  it('相同前缀 → changed=false', () => {
    expect(comparePrefix('abcdef12', 'abcdef12')).toEqual({ changed: false, sharedChars: 0 })
  })
})

describe('comparePrefix（明文口径）', () => {
  it('尾部追加 → sharedChars 等于公共前缀字符数', () => {
    const r = comparePrefix('身份提示词', '身份提示词\n\n[摘要] 新内容')
    expect(r.changed).toBe(true)
    expect(r.sharedChars).toBe('身份提示词'.length)
  })

  it('完全相同 → changed=false', () => {
    expect(comparePrefix('同一段', '同一段')).toEqual({ changed: false, sharedChars: 0 })
  })
})
