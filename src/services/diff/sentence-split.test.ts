import { describe, it, expect } from 'vitest'
import { splitSentences, refineHunkWithSentences } from './sentence-split'
import type { AlignedHunk } from './paragraph-align'

const mkHunk = (over: Partial<AlignedHunk> & { origText: string; modText: string; from?: number }): AlignedHunk => {
  const { from, origRange, ...rest } = over
  const range = origRange ?? { from: from ?? 0, to: (from ?? 0) + over.origText.length }
  // origText/modText 经 ...rest 展开（不在基对象重复指定，规避 TS2783）；kind 同理由 rest 覆盖
  return { id: 'h0', kind: 'MATCH', origRange: range, ...rest }
}

describe('splitSentences（设计 §7：句切分）', () => {
  it('中英混排：中文句界（。！？…；）收归句尾，英文句点不切', () => {
    expect(splitSentences('他走了。等等？这…下一条；终').map(x => x.text))
      .toEqual(['他走了。', '等等？', '这…', '下一条；', '终'])
    expect(splitSentences('She left. He stayed。').map(x => x.text))
      .toEqual(['She left. He stayed。']) // '.'/'!' 不是句界，整段收在 '。' 前
  })
  it('\\n 为句界：空行不产空句；\\r\\n 紧随标点句时作为空句被跳过', () => {
    expect(splitSentences('甲。\n\n乙。\r\n丙').map(x => x.text))
      .toEqual(['甲。', '乙。', '丙']) // 空行 '\n' 与标点后的 '\r\n' 均为空句 → 跳过
  })
  it('句子 offsets 相对 para 原文 slice 回读一致', () => {
    const para = '他说：来了。\n她没答话。'
    const s = splitSentences(para)
    expect(s.map(x => x.text)).toEqual(['他说：来了。', '她没答话。'])
    for (const x of s) expect(para.slice(x.start, x.end)).toBe(x.text)
  })
})

describe('refineHunkWithSentences（锚句 LCS，设计 §7）', () => {
  it('局部改一句 → 只产 1 个子 hunk，锚句不在子 hunk 内', () => {
    const orig = '雨下了一整夜。天亮了。她推开窗。'
    const mod = '雨下了一整夜。天终于亮了。她推开窗。'
    const subs = refineHunkWithSentences(mkHunk({ origText: orig, modText: mod, from: 10 }))
    expect(subs).toHaveLength(1)
    expect(subs[0].origText).toBe('天亮了。')
    expect(subs[0].origRange.from).toBe(10 + orig.indexOf('天亮了。'))
    expect(subs[0].modText).toBe('天终于亮了。')
  })
  it('整段重写（无锚句）→ 降级为整段 1 个子 hunk（origRange = 整 hunk 区间）', () => {
    const subs = refineHunkWithSentences(mkHunk({
      origText: '雨下了一整夜。天亮了。', modText: '阳光刺破云层，万物复苏。', from: 30,
    }))
    expect(subs).toHaveLength(1)
    expect(subs[0].origText).toBe('雨下了一整夜。天亮了。')
    expect(subs[0].origRange).toEqual({ from: 30, to: 30 + '雨下了一整夜。天亮了。'.length })
  })
  it('结构类 hunk（SPLIT_1_2）→ 整段单子 hunk（段界分隔符协同超句粒度）', () => {
    const subs = refineHunkWithSentences(mkHunk({
      kind: 'SPLIT_1_2',
      origText: '一段长文。', modText: '一段长文。\n\n新段首句。',
    }))
    expect(subs).toHaveLength(1)
    expect(subs[0].modText).toBe('一段长文。\n\n新段首句。')
  })
  it('句子全同但仅结构差异（重组校验失败）→ 降级整段，防锚句吞掉换行变化', () => {
    const orig = '甲句。乙句。'
    const mod = '甲句。\n\n乙句。' // 仅插入段界——LCS 无 changed run → 重组 ≠ modText → 降级
    const subs = refineHunkWithSentences(mkHunk({ origText: orig, modText: mod }))
    expect(subs).toHaveLength(1)
    expect(subs[0].modText).toBe(mod)
  })
  it('id 确定性：同输入两次调用子 hunk id 一致（决策表跨重挂载）', () => {
    const h = mkHunk({ origText: '甲。乙。丙。', modText: '甲。乙改。丙。' })
    expect(refineHunkWithSentences(h).map(s => s.id))
      .toEqual(refineHunkWithSentences(h).map(s => s.id))
  })
})
