import { describe, it, expect } from 'vitest'
import { evaluateChapterBatch, evaluateSchedule, buildManualMatch } from './triggers'
import type { TriggerContext, TriggerDefinition } from './types'

const DAY = 86_400_000
function ctx(over: Partial<TriggerContext> = {}): TriggerContext {
  return { now: 10 * DAY, chapters: [], ...over }
}
const trigger = (over: Partial<TriggerDefinition> = {}): TriggerDefinition =>
  ({ id: 't1', type: 'chapter_batch', enabled: true, ...over })

describe('evaluateChapterBatch', () => {
  const chapters = (n: number) => Array.from({ length: n }, (_, i) =>
    ({ number: i + 1, title: `第${i + 1}章`, wordCount: 3000 }))

  it('不足一批不触发', () => {
    expect(evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: chapters(2) }))).toBeNull()
  })

  it('刚好一批 → 触发，指纹含批号与该批章节号', () => {
    const m = evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: chapters(3) }))!
    expect(m.fingerprint).toBe('chapter_batch:t1:1:1,2,3')
    expect(m.summary).toContain('第 1-3 章')
  })

  it('字数 0 的章节不计入批次', () => {
    const ch = [...chapters(3), { number: 4, title: '空章', wordCount: 0 }]
    expect(evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: ch }))!.fingerprint)
      .toBe('chapter_batch:t1:1:1,2,3')
  })

  it('指纹不含字数/标题变化（同批改稿不重复触发）', () => {
    const a = evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: chapters(3) }))!
    const edited = chapters(3).map(c => ({ ...c, wordCount: 9999, title: '改了' }))
    const b = evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: edited }))!
    expect(b.fingerprint).toBe(a.fingerprint)
  })

  it('第 4 章定稿 → 仍取最后一个完整批（指纹不变）', () => {
    const m = evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: chapters(4) }))!
    expect(m.fingerprint).toBe('chapter_batch:t1:1:1,2,3')
  })

  it('第 6 章定稿 → 指纹推进到批 2', () => {
    const m = evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: chapters(6) }))!
    expect(m.fingerprint).toBe('chapter_batch:t1:2:4,5,6')
  })

  it('chapterBatchSize 缺省为 3，非法值回落', () => {
    expect(evaluateChapterBatch(trigger(), ctx({ chapters: chapters(3) }))).not.toBeNull()
    expect(evaluateChapterBatch(trigger({ chapterBatchSize: 0 }), ctx({ chapters: chapters(3) }))).not.toBeNull()
  })

  it('证据逐章给出（供收件箱展示）', () => {
    const m = evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: chapters(3) }))!
    expect(m.evidence).toHaveLength(3)
    expect(m.evidence[0]).toMatchObject({ source: 'chapter', ref: '1' })
  })
})

describe('evaluateSchedule（区间回溯）', () => {
  const daily = trigger({ type: 'schedule', schedule: { kind: 'daily', hour: 9, minute: 0 } })

  it('区间内无命中点 → null', () => {
    const now = new Date('2026-09-26T08:00:00').getTime()
    expect(evaluateSchedule(daily, ctx({ now, lastCheckedAt: now - 3600_000 }))).toBeNull()
  })

  it('区间跨过 09:00 → 触发，指纹含命中点时间戳', () => {
    const last = new Date('2026-09-26T08:50:00').getTime()
    const now = new Date('2026-09-26T09:10:00').getTime()
    const m = evaluateSchedule(daily, ctx({ now, lastCheckedAt: last }))!
    expect(m.fingerprint).toContain('schedule:t1:')
    expect(new Date(Number(m.fingerprint.split(':').pop())).getHours()).toBe(9)
  })

  it('首次评估只回溯一分钟（避免刷出历史触发点）', () => {
    const now = new Date('2026-09-26T09:00:30').getTime()
    expect(evaluateSchedule(daily, ctx({ now }))).not.toBeNull()      // 09:00 在回溯窗内
    const later = new Date('2026-09-26T10:00:00').getTime()
    expect(evaluateSchedule(daily, ctx({ now: later }))).toBeNull()   // 09:00 已超出 1 分钟窗
  })

  it('停机多天只补最近一个命中点（不刷屏）', () => {
    const last = new Date('2026-09-20T09:00:00').getTime()
    const now = new Date('2026-09-26T10:00:00').getTime()
    const m = evaluateSchedule(daily, ctx({ now, lastCheckedAt: last }))!
    expect(new Date(Number(m.fingerprint.split(':').pop())).getDate()).toBe(26)
  })

  it('hourly：跨过整点间隔才触发', () => {
    const hourly = trigger({ type: 'schedule', schedule: { kind: 'hourly', everyHours: 2 } })
    const now = new Date('2026-09-26T10:00:00').getTime()
    expect(evaluateSchedule(hourly, ctx({ now, lastCheckedAt: now - 3600_000 }))).toBeNull()
    expect(evaluateSchedule(hourly, ctx({ now, lastCheckedAt: now - 3 * 3600_000 }))).not.toBeNull()
  })
})

describe('buildManualMatch', () => {
  it('手动触发指纹唯一（每次运行都可执行）', () => {
    const a = buildManualMatch(trigger({ type: 'manual' }), ctx())
    const b = buildManualMatch(trigger({ type: 'manual' }), ctx())
    expect(a.fingerprint).not.toBe(b.fingerprint)
    expect(a.fingerprint.startsWith('manual:t1:')).toBe(true)
  })
})
