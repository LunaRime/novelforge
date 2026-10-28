import { describe, expect, it } from 'vitest'
import { assessDraftQuality, detectRunawayRepetition } from './text-quality-guard'

describe('text-quality-guard', () => {
  it('detects repeated paragraph loops', () => {
    const block = '程述白喉结位置维持在2.4mm极限。声带肌张力17.4kPa。气流初速衰减至0.12m/s。'
    const report = detectRunawayRepetition(Array.from({ length: 8 }, () => block).join('\n'))
    expect(report.runaway).toBe(true)
    expect(report.maxRepeat).toBeGreaterThanOrEqual(5)
  })

  it('does not flag normal prose', () => {
    const text = ['第一段写林见微修复怀表。', '第二段写程望重启旧案。', '第三段写周正海设局。'].join('\n')
    expect(detectRunawayRepetition(text).runaway).toBe(false)
  })

  it('flags drafts outside the target word range', () => {
    const report = assessDraftQuality('太短了。', 2000)
    expect(report.severity).toBe('warn')
    expect(report.minWords).toBe(1800)
    expect(report.maxWords).toBe(2200)
  })

  it('block 级：循环重复的稿子不允许通过', () => {
    const block = '程述白喉结位置维持在2.4mm极限。声带肌张力17.4kPa。气流初速衰减至0.12m/s。'
    const report = assessDraftQuality(Array.from({ length: 8 }, () => block).join('\n'), 2000)
    expect(report.severity).toBe('block')
    expect(report.reason).toContain('循环重复')
  })

  it('block 级：字数膨胀到硬上限（2.5 倍上限且不低于 5000）', () => {
    const text = Array.from({ length: 600 }, (_, i) => `第${i}段推进情节，人物做出不同选择。`).join('\n')
    const report = assessDraftQuality(text, 2000)
    expect(report.words).toBeGreaterThan(5500)
    expect(report.severity).toBe('block')
    expect(report.reason).toContain('字数异常膨胀')
  })

  it('目标字数为 0 时回落 2000 基准，不出现 0 字区间', () => {
    const report = assessDraftQuality('短稿。', 0)
    expect(report.minWords).toBe(1800)
    expect(report.maxWords).toBe(2200)
  })

  it('runaway 判定要求重复次数与占比同时达标', () => {
    const block = '这一段的长度刚好超过十二个字符用于检测。'
    // 只有 3 次重复：不满足 >=5
    expect(detectRunawayRepetition(Array.from({ length: 3 }, () => block).join('\n')).runaway).toBe(false)
  })
})
