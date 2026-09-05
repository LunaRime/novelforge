import { describe, it, expect } from 'vitest'
import { buildSelectionSession } from './selection-session'

describe('buildSelectionSession（A 入口选区对齐，设计 §4.1 定位链路 v1 落点）', () => {
  it('选区文本 vs AI 输出 → MATCH 段 hunk 细分，子 hunk origRange 折算回 doc 坐标', () => {
    const doc = '她抬头望向窗外。\n雨还在下。\n她叹了口气。'
    const from = doc.indexOf('雨还在下。')
    const session = buildSelectionSession(doc, from, from + '雨还在下。'.length, '雨一直在下。')
    expect(session).toBeTruthy()
    expect(session!.baseDocSnapshot).toBe(doc)
    const hunk = session!.hunks[0]
    expect(hunk.kind).toBe('MATCH')
    // 段级 hunk 为整段替换（SessionHunk 无 hunk 级 origRange/origText——
    // doc 坐标定位挂在子 hunk，见 hunk-model Task 2 契约）
    expect(hunk.modText).toBe('雨一直在下。')
    expect(hunk.sub).toHaveLength(1)
    const sub = hunk.sub[0]
    expect(sub.origText).toBe('雨还在下。')
    expect(sub.origRange).toEqual({ from, to: from + '雨还在下。'.length })
    expect(session!.decisions).toEqual({})
  })

  it('AI 输出与选区等价（无改动）→ null', () => {
    const doc = '甲乙丙'
    const session = buildSelectionSession(doc, 0, 3, '甲乙丙')
    expect(session).toBeNull()
  })

  it('AI 输出仅空白/换行差异（trim 等价）→ null（Task 1 reviewer 归一化零重叠用例在此消费）', () => {
    const doc = '雨还在下。'
    expect(buildSelectionSession(doc, 0, doc.length, ' 雨还在下。\n')).toBeNull()
    expect(buildSelectionSession(doc, 0, doc.length, '雨 还 在 下 。')).not.toBeNull() // 实质差异不吞
  })

  it('AI 整段重写（无锚句）→ 单子 hunk 降级（接受即整段替换）', () => {
    const doc = '他走进屋子，放下包，坐下。'
    const session = buildSelectionSession(doc, 0, doc.length, '门被推开，风灌了进来。')
    expect(session).toBeTruthy()
    expect(session!.hunks[0].sub).toHaveLength(1)
    expect(session!.hunks[0].sub[0].origText).toBe(doc)
    expect(session!.hunks[0].sub[0].modText).toBe('门被推开，风灌了进来。')
  })

  it('多句选区局部改动 → 只产出 changed run 子 hunk（锚句不在子 hunk；\\n 归属依 splitSentences 实测）', () => {
    const doc = '天黑了。\n他点亮灯。\n继续写。'
    const aiText = '天黑了。\n他点燃油灯。\n继续写。'
    const session = buildSelectionSession(doc, 0, doc.length, aiText)
    expect(session).toBeTruthy()
    const subs = session!.hunks.flatMap(h => h.sub)
    // 仅第 2 句为 changed run（splitSentences 中 \n 收作空句跳过——锚句不进子 hunk）
    expect(subs.map(s => s.origText)).toEqual(['他点亮灯。'])
    expect(subs[0].modText).toBe('他点燃油灯。')
    const from = doc.indexOf('他点亮灯。')
    expect(subs[0].origRange).toEqual({ from, to: from + '他点亮灯。'.length })
  })

  it('选区偏移折算：选中 doc 中段的替换区间——baseDocSnapshot 为整 doc、子 hunk 区间含 selFrom', () => {
    const doc = '第一章标题。\n\n正文第一段。\n\n雨下了一整夜。天亮了。她推开窗。\n\n结尾段。'
    const selFrom = doc.indexOf('雨下了一整夜。')
    const selTo = selFrom + '雨下了一整夜。天亮了。她推开窗。'.length
    const session = buildSelectionSession(doc, selFrom, selTo, '雨下了一整夜。天终于亮了。她推开窗。')
    expect(session).toBeTruthy()
    expect(session!.baseDocSnapshot).toBe(doc)
    const sub = session!.hunks[0].sub[0]
    const from = doc.indexOf('天亮了。')
    expect(sub.origText).toBe('天亮了。')
    expect(sub.origRange).toEqual({ from, to: from + '天亮了。'.length })
  })
})
