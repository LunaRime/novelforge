import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPACTION_PREFS, resolveCompactionPrefs, computeHistoryBudget } from './compaction-prefs'

describe('resolveCompactionPrefs（§7.1-C2 保留偏好）', () => {
  it('无配置 / 空段 / null → 全默认（老配置零迁移）', () => {
    expect(resolveCompactionPrefs(null)).toEqual(DEFAULT_COMPACTION_PREFS)
    expect(resolveCompactionPrefs(undefined)).toEqual(DEFAULT_COMPACTION_PREFS)
    expect(resolveCompactionPrefs({})).toEqual(DEFAULT_COMPACTION_PREFS)
    expect(resolveCompactionPrefs({ compaction: {} })).toEqual(DEFAULT_COMPACTION_PREFS)
  })

  it('部分字段：只覆盖给了的，其余回默认', () => {
    const p = resolveCompactionPrefs({ compaction: { historyMaxTokens: 8000 } })
    expect(p.historyMaxTokens).toBe(8000)
    expect(p.minimumChangeTokens).toBe(DEFAULT_COMPACTION_PREFS.minimumChangeTokens)
    expect(p.keepBatches).toBe(0)
  })

  it('超范围两侧都钳制（含 keepBatches 上界）', () => {
    expect(resolveCompactionPrefs({ compaction: { historyMaxTokens: 1 } }).historyMaxTokens).toBe(1000)
    expect(resolveCompactionPrefs({ compaction: { historyMaxTokens: 999_999 } }).historyMaxTokens).toBe(32000)
    expect(resolveCompactionPrefs({ compaction: { minimumChangeTokens: -5 } }).minimumChangeTokens).toBe(0)
    expect(resolveCompactionPrefs({ compaction: { minimumChangeTokens: 5000 } }).minimumChangeTokens).toBe(2000)
    expect(resolveCompactionPrefs({ compaction: { keepBatches: 99 } }).keepBatches).toBe(20)
    expect(resolveCompactionPrefs({ compaction: { keepBatches: -1 } }).keepBatches).toBe(0)
  })

  it('非数字（字符串 / null / NaN / Infinity）→ 回默认，绝不抛', () => {
    const bad = { compaction: { historyMaxTokens: '8000', minimumChangeTokens: null, keepBatches: Number.NaN } }
    expect(resolveCompactionPrefs(bad)).toEqual(DEFAULT_COMPACTION_PREFS)
    expect(resolveCompactionPrefs({ compaction: { historyMaxTokens: Number.POSITIVE_INFINITY } }).historyMaxTokens)
      .toBe(DEFAULT_COMPACTION_PREFS.historyMaxTokens)
  })

  it('小数取整（输入框里粘贴 4000.7 不该变成浮点预算）', () => {
    expect(resolveCompactionPrefs({ compaction: { historyMaxTokens: 4000.7 } }).historyMaxTokens).toBe(4001)
  })

  it('缺省值 = 现状常量（行为零变化的前提）', () => {
    expect(DEFAULT_COMPACTION_PREFS).toEqual({ budgetPercent: 80, historyMaxTokens: 4000, minimumChangeTokens: 200, keepBatches: 0 })
  })
})

describe('computeHistoryBudget（百分比压缩：上下阈值钳制）', () => {
  const prefs = DEFAULT_COMPACTION_PREFS

  it('窗口 × 80% 在范围内 → 直接返回百分比预算', () => {
    expect(computeHistoryBudget(prefs, 32_000)).toBe(25_600)
  })

  it('大窗口 80% 超过上阈值 32000 → 钳制到 32000', () => {
    expect(computeHistoryBudget(prefs, 128_000)).toBe(32_000)
  })

  it('小窗口 80% 低于下阈值 1000 → 钳制到 1000', () => {
    expect(computeHistoryBudget(prefs, 1_000)).toBe(1_000)
    expect(computeHistoryBudget(prefs, 800)).toBe(1_000)
  })

  it('无窗口信息 → 回退固定 historyMaxTokens', () => {
    expect(computeHistoryBudget(prefs, undefined)).toBe(prefs.historyMaxTokens)
    expect(computeHistoryBudget(prefs, 0)).toBe(prefs.historyMaxTokens)
  })

  it('百分比可配置（50% / 95%）', () => {
    expect(computeHistoryBudget({ ...prefs, budgetPercent: 50 }, 32_000)).toBe(16_000)
    expect(computeHistoryBudget({ ...prefs, budgetPercent: 95 }, 32_000)).toBe(30_400)
  })
})
