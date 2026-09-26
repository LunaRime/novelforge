import { describe, it, expect, vi } from 'vitest'
import { buildSemanticContext, parseSemanticEvaluation, evaluateSemantic } from './semantic-trigger'
import {
  SEMANTIC_CHAPTER_TRUNCATE,
  SEMANTIC_CONFIDENCE_THRESHOLD,
  type TriggerContext,
  type TriggerDefinition,
} from './types'

const trigger = (over: Partial<TriggerDefinition> = {}): TriggerDefinition => ({
  id: 's1', type: 'semantic', enabled: true, semanticCondition: '有未回收伏笔', ...over,
})

const chapters = [
  { number: 1, title: '第1章', wordCount: 3000 },
  { number: 2, title: '第2章', wordCount: 3000 },
]

function ctx(over: Partial<TriggerContext> = {}): TriggerContext {
  return {
    now: 1000,
    chapters,
    readChapterText: n => `正文${n}`,
    callModel: async () => JSON.stringify({
      matched: true, confidence: 0.9, reason: '存在两条未回收伏笔',
      title: '伏笔提醒', evidence_refs: ['2'],
    }),
    ...over,
  }
}

describe('buildSemanticContext（有界上下文）', () => {
  it('取最新章节、单章截断、refs 含章节号与标题', () => {
    const long = 'x'.repeat(SEMANTIC_CHAPTER_TRUNCATE + 500)
    const c = buildSemanticContext(chapters, () => long)
    expect(c.text.length).toBeLessThanOrEqual(SEMANTIC_CHAPTER_TRUNCATE * chapters.length)
    expect(c.allowedRefs.has('1')).toBe(true)
    expect(c.allowedRefs.has('第2章')).toBe(true)
  })

  it('倒序取最新（最近的章节排在前面）', () => {
    const c = buildSemanticContext(chapters, n => `正文${n}`)
    expect(c.text.indexOf('正文2')).toBeLessThan(c.text.indexOf('正文1'))
  })

  it('总预算内不超限（章节多时截断）', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ number: i + 1, title: `第${i + 1}章`, wordCount: 3000 }))
    const c = buildSemanticContext(many, () => 'y'.repeat(SEMANTIC_CHAPTER_TRUNCATE))
    expect(c.text.length).toBeLessThanOrEqual(64 * 1024 + SEMANTIC_CHAPTER_TRUNCATE)
  })
})

describe('parseSemanticEvaluation（解析与校验）', () => {
  it('合法 JSON → 解析出字段', () => {
    const ev = parseSemanticEvaluation('```json\n{"matched":true,"confidence":0.8,"reason":"r","title":"t","evidence_refs":["1"]}\n```')
    expect(ev?.confidence).toBe(0.8)
    expect(ev?.evidenceRefs).toEqual(['1'])
  })

  it('非法 JSON → null 且不抛', () => {
    expect(parseSemanticEvaluation('这不是 JSON')).toBeNull()
    expect(parseSemanticEvaluation('')).toBeNull()
  })

  it('confidence 越界 → null', () => {
    expect(parseSemanticEvaluation('{"matched":true,"confidence":1.7,"reason":"r","title":"t","evidence_refs":[]}')).toBeNull()
  })
})

describe('evaluateSemantic（端到端）', () => {
  it('匹配成功 → 产出 TriggerMatch，指纹含条件与章节身份', async () => {
    const m = await evaluateSemantic(trigger(), ctx())
    expect(m).not.toBeNull()
    expect(m!.fingerprint.startsWith('semantic:s1:')).toBe(true)
    expect(m!.evidence[0]).toMatchObject({ ref: '2' })
  })

  it('confidence 低于阈值 → 不触发', async () => {
    const low = (SEMANTIC_CONFIDENCE_THRESHOLD - 0.01).toString()
    const m = await evaluateSemantic(trigger(), ctx({
      callModel: async () => `{"matched":true,"confidence":${low},"reason":"r","title":"t","evidence_refs":["2"]}`,
    }))
    expect(m).toBeNull()
  })

  it('matched=false → 不触发', async () => {
    const m = await evaluateSemantic(trigger(), ctx({
      callModel: async () => '{"matched":false,"confidence":0.99,"reason":"r","title":"t","evidence_refs":[]}',
    }))
    expect(m).toBeNull()
  })

  it('证据引用上下文之外的 ref → 整条丢弃（不得降级为无证据触发）', async () => {
    const m = await evaluateSemantic(trigger(), ctx({
      callModel: async () => '{"matched":true,"confidence":0.99,"reason":"r","title":"t","evidence_refs":["999"]}',
    }))
    expect(m).toBeNull()
  })

  it('模型调用抛错 → null（不阻断其他触发器）', async () => {
    const m = await evaluateSemantic(trigger(), ctx({ callModel: async () => { throw new Error('boom') } }))
    expect(m).toBeNull()
  })

  it('无 callModel 或无条件 → null（不误触发）', async () => {
    expect(await evaluateSemantic(trigger(), ctx({ callModel: undefined }))).toBeNull()
    expect(await evaluateSemantic(trigger({ semanticCondition: '' }), ctx())).toBeNull()
  })

  it('提示词包含四条安全约束', async () => {
    // 泛型声明参数类型（供 mock.calls 取用），实现不读取参数以避免 unused-vars
    const spy = vi.fn<(prompt: string) => Promise<string>>(
      async () => '{"matched":false,"confidence":0,"reason":"","title":"","evidence_refs":[]}',
    )
    await evaluateSemantic(trigger(), ctx({ callModel: spy }))
    const prompt = String(spy.mock.calls[0][0])
    expect(prompt).toContain('matched')
    expect(prompt).toContain('0.55')
    expect(prompt).toContain('evidence_refs')
  })
})
