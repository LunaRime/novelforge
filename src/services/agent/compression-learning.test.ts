/**
 * compression-learning — 自学习压缩 v1（TACO 式本地规则引擎）纯函数测试：
 * 坏形状防御 / 倍率边界与迟滞 / 规则激活-退役-复活 / 提示组合 / 重置 / 统计。
 */
import { describe, it, expect } from 'vitest'
import {
  defaultCompressionLearning, resolveCompressionLearning, resetCompressionLearning,
  effectiveMinChangeTokens, composeLearningHints, activeRuleLabels,
  applyCompressionOutcome, recordCompressionRevert, recordCompressionRegeneration,
  FACTOR_MAX, FACTOR_MIN, LOW_GAIN_RATIO,
  type CompressionLearningState,
} from './compression-learning'
import { t } from '../../shared/locale'

const enabled = (over: Partial<CompressionLearningState> = {}): CompressionLearningState =>
  ({ ...defaultCompressionLearning(true), ...over })

const outcome = (over: Partial<Parameters<typeof applyCompressionOutcome>[1]> = {}) =>
  ({ attempted: true, skipped: false, success: false, truncationDropped: 0, ...over })

describe('resolveCompressionLearning：坏形状防御（fail-safe 回默认）', () => {
  it('缺段 / 非对象 → 默认（enabled=false、倍率 1、规则齐全未激活）', () => {
    for (const raw of [undefined, null, 42, 'x', []]) {
      const s = resolveCompressionLearning(raw)
      expect(s.enabled).toBe(false)
      expect(s.minChangeFactor).toBe(1)
      expect(s.rules).toHaveLength(4)
      expect(s.rules.every(r => !r.active)).toBe(true)
    }
  })

  it('version 失配 → 整段回默认（不做部分解析）；缺 version 仍宽容解析', () => {
    // 显式写了别的版本号 = 形状已不属于本实现：部分解析会把未知字段当本版本语义，故整段回默认
    const mismatched = resolveCompressionLearning({
      version: 2, enabled: true, minChangeFactor: 1.4, stats: { compressions: 9 },
    })
    expect(mismatched.enabled).toBe(false)
    expect(mismatched.minChangeFactor).toBe(1)
    expect(mismatched.stats.compressions).toBe(0)
    // 缺 version（早期写入 / 手工编辑）→ 按本文形状宽容解析，不因缺字段丢用户状态
    const noVersion = resolveCompressionLearning({ enabled: true, minChangeFactor: 1.4 })
    expect(noVersion.enabled).toBe(true)
    expect(noVersion.minChangeFactor).toBe(1.4)
  })

  it('坏字段逐项回默认；倍率钳制 [0.5, 1.5]；未知规则 id 不进池', () => {
    const s = resolveCompressionLearning({
      enabled: true,
      minChangeFactor: 99,
      stats: { compressions: 3, skipped: -1 },
      rules: [{ id: 'keep-characters', active: true, evidence: 5 }, { id: 'evil-rule', active: true }],
    })
    expect(s.enabled).toBe(true)
    expect(s.minChangeFactor).toBe(FACTOR_MAX)
    expect(s.stats.compressions).toBe(3)
    expect(s.stats.skipped).toBe(0)
    expect(s.rules.find(r => r.id === 'keep-characters')).toMatchObject({ active: true, evidence: 5 })
    expect(s.rules.map(r => r.id)).toEqual(['keep-write-targets', 'keep-characters', 'keep-chapter-refs', 'omit-read-noise'])
  })
})

describe('effectiveMinChangeTokens：只调判定，不写回用户值', () => {
  it('关闭 → 逐字用户值（行为零变化）', () => {
    expect(effectiveMinChangeTokens(200, defaultCompressionLearning(false))).toBe(200)
  })

  it('开启 → user × factor，钳制 [0, 2000]', () => {
    expect(effectiveMinChangeTokens(200, enabled({ minChangeFactor: 0.5 }))).toBe(100)
    expect(effectiveMinChangeTokens(2000, enabled({ minChangeFactor: FACTOR_MAX }))).toBe(2000) // 1.5× 不越上限
    expect(effectiveMinChangeTokens(0, enabled({ minChangeFactor: FACTOR_MAX }))).toBe(0)
  })
})

describe('applyCompressionOutcome：时机倍率（有界 + 回中）', () => {
  it('关闭 → 状态引用不变、changed=false（零副作用）', () => {
    const s = defaultCompressionLearning(false)
    const r = applyCompressionOutcome(s, outcome({ skipped: true }))
    expect(r.changed).toBe(false)
    expect(r.state).toBe(s)
  })

  it('跳过（无收益）→ 倍率上调，统计 +1，事件留痕', () => {
    const r = applyCompressionOutcome(enabled(), outcome({ skipped: true }))
    expect(r.changed).toBe(true)
    expect(r.state.minChangeFactor).toBeCloseTo(1.1)
    expect(r.state.stats.skipped).toBe(1)
    expect(r.events[0].message).toContain(t('ccr.learnFactorAdjusted').split('{')[0])
  })

  it('压缩后仍被硬截断 → 倍率下调（截断方向优先于跳过）', () => {
    const r = applyCompressionOutcome(enabled(), outcome({ skipped: true, truncationDropped: 4 }))
    expect(r.state.minChangeFactor).toBeCloseTo(0.9)
    expect(r.state.stats.truncations).toBe(1)
    expect(r.state.stats.skipped).toBe(1) // 跳过统计照记
  })

  it('倍率有界：连续跳过封顶 1.5；连续截断触底 0.5', () => {
    let s = enabled()
    for (let i = 0; i < 10; i++) s = applyCompressionOutcome(s, outcome({ skipped: true })).state
    expect(s.minChangeFactor).toBe(FACTOR_MAX)
    for (let i = 0; i < 20; i++) s = applyCompressionOutcome(s, outcome({ truncationDropped: 2 })).state
    expect(s.minChangeFactor).toBe(FACTOR_MIN)
  })

  it('成功 → 向 1.0 回中（收敛信号）；倍率触底后截断计数仍会落盘', () => {
    const recentered = applyCompressionOutcome(enabled({ minChangeFactor: 1.5 }), outcome({ success: true }))
    expect(recentered.state.minChangeFactor).toBeLessThan(1.5)
    expect(recentered.state.minChangeFactor).toBeGreaterThan(1.0)
    expect(recentered.state.stats.compressions).toBe(1)

    // 倍率已触底：截断不改倍率，但**计数必须落盘**——修复前被排除在 changed 之外，
    // 导致「只发生硬截断」的会话里设置页「截断 N」永远停在旧值（本批主旨是观测，不能失真）
    const floored = applyCompressionOutcome(enabled({ minChangeFactor: FACTOR_MIN }), outcome({ success: false, truncationDropped: 3 }))
    expect(floored.changed).toBe(true)
    expect(floored.state.stats.truncations).toBe(1)
    // 健康会话（dropped=0）不因截断写盘
    const healthy = applyCompressionOutcome(enabled({ minChangeFactor: FACTOR_MIN }), outcome({ success: false }))
    expect(healthy.changed).toBe(false)
  })
})

describe('applyCompressionOutcome：keep 规则（激活 / 退役 / 复活防抖）', () => {
  it('保真缺失累计 2 次 → 激活对应规则，提示进入 composeLearningHints', () => {
    const s = enabled()
    const r1 = applyCompressionOutcome(s, outcome({ success: true, missingKinds: ['character'] }))
    expect(r1.state.rules.find(r => r.id === 'keep-characters')!.active).toBe(false) // 1 条证据不够
    const r2 = applyCompressionOutcome(r1.state, outcome({ success: true, missingKinds: ['character'] }))
    expect(r2.state.rules.find(r => r.id === 'keep-characters')!.active).toBe(true)
    expect(r2.events.some(e => e.message.includes(t('ccr.ruleKeepCharacters')))).toBe(true)
    expect(composeLearningHints(r2.state)).toContain(t('ccr.learnHintKeepCharacters'))
    expect(activeRuleLabels(r2.state)).toContain(t('ccr.ruleKeepCharacters'))
  })

  it('三类缺失各映射各的规则（角色 / 章节 / 写入目标）', () => {
    let s = enabled()
    for (let i = 0; i < 2; i++) {
      s = applyCompressionOutcome(s, outcome({ success: true, missingKinds: ['character', 'chapter', 'write-target'] })).state
    }
    expect(s.rules.filter(r => r.active).map(r => r.id).sort()).toEqual(
      ['keep-chapter-refs', 'keep-characters', 'keep-write-targets'],
    )
  })

  it('激活后继续缺失 3 次 → 退役；退役后需再攒 2 条证据才复活（防抖）', () => {
    let s = enabled()
    for (let i = 0; i < 2; i++) s = applyCompressionOutcome(s, outcome({ success: true, missingKinds: ['character'] })).state
    expect(s.rules.find(r => r.id === 'keep-characters')!.active).toBe(true)
    for (let i = 0; i < 3; i++) s = applyCompressionOutcome(s, outcome({ success: true, missingKinds: ['character'] })).state
    expect(s.rules.find(r => r.id === 'keep-characters')!.active).toBe(false) // 提示无效 → 退役
    // 1 条新证据不足复活
    s = applyCompressionOutcome(s, outcome({ success: true, missingKinds: ['character'] })).state
    expect(s.rules.find(r => r.id === 'keep-characters')!.active).toBe(false)
    // 第 2 条 → 复活
    s = applyCompressionOutcome(s, outcome({ success: true, missingKinds: ['character'] })).state
    expect(s.rules.find(r => r.id === 'keep-characters')!.active).toBe(true)
  })
})

describe('applyCompressionOutcome：omit 规则（低增益激活 / 告警退役）', () => {
  it('低增益 3 次激活省略提示；激活期间保真告警 2 次退役', () => {
    let s = enabled()
    for (let i = 0; i < 3; i++) {
      s = applyCompressionOutcome(s, outcome({ success: true, gainRatio: LOW_GAIN_RATIO - 0.01 })).state
    }
    expect(s.rules.find(r => r.id === 'omit-read-noise')!.active).toBe(true)
    expect(composeLearningHints(s)).toContain(t('ccr.learnHintOmitReadNoise'))

    s = applyCompressionOutcome(s, outcome({ success: true, gainRatio: 0.5, fidelityWarned: true })).state
    expect(s.rules.find(r => r.id === 'omit-read-noise')!.active).toBe(true)  // 1 次反证不够
    s = applyCompressionOutcome(s, outcome({ success: true, gainRatio: 0.5, fidelityWarned: true })).state
    expect(s.rules.find(r => r.id === 'omit-read-noise')!.active).toBe(false)
  })

  it('增益正常（≥ 阈值）不产生省略证据', () => {
    let s = enabled()
    for (let i = 0; i < 5; i++) {
      s = applyCompressionOutcome(s, outcome({ success: true, gainRatio: 0.6 })).state
    }
    expect(s.rules.find(r => r.id === 'omit-read-noise')!.active).toBe(false)
    expect(s.rules.find(r => r.id === 'omit-read-noise')!.evidence).toBe(0)
  })
})

describe('重置与用户反馈统计', () => {
  it('重置：清统计与规则、保留开关', () => {
    let s = enabled({ minChangeFactor: 1.4 })
    s = applyCompressionOutcome(s, outcome({ success: true, missingKinds: ['character'] })).state
    s = applyCompressionOutcome(s, outcome({ success: true, missingKinds: ['character'] })).state
    expect(s.stats.compressions).toBe(2) // 前置确有状态
    const r = resetCompressionLearning(true)
    expect(r.enabled).toBe(true)
    expect(r.minChangeFactor).toBe(1)
    expect(r.stats.compressions).toBe(0)
    expect(r.rules.every(x => !x.active && x.evidence === 0)).toBe(true)
  })

  it('移除 / 重生成：仅统计（关闭时零变化）', () => {
    const off = defaultCompressionLearning(false)
    expect(recordCompressionRevert(off).changed).toBe(false)
    expect(recordCompressionRegeneration(off).changed).toBe(false)

    const on = enabled()
    const r1 = recordCompressionRevert(on)
    expect(r1.changed).toBe(true)
    expect(r1.state.stats.reverts).toBe(1)
    const r2 = recordCompressionRegeneration(r1.state)
    expect(r2.state.stats.regenerations).toBe(1)
  })
})
