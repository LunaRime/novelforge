import { describe, it, expect } from 'vitest'
import { splitMentionRefs, type MessageSegment } from './mention-refs'

/** 把段落拼回纯文本——用于断言「不丢字符」 */
const join = (segs: MessageSegment[]): string =>
  segs.map(s => (s.kind === 'text' ? s.text : s.raw)).join('')

/** 取出所有引用目标 */
const targets = (segs: MessageSegment[]): string[] =>
  segs.filter((s): s is Extract<MessageSegment, { kind: 'ref' }> => s.kind === 'ref').map(s => s.target)

describe('splitMentionRefs', () => {
  it('无 @ 时原样返回单个 text 段', () => {
    const segs = splitMentionRefs('普通消息，没有引用')
    expect(segs).toEqual([{ kind: 'text', text: '普通消息，没有引用' }])
  })

  it('空串返回空 text 段（不崩）', () => {
    expect(splitMentionRefs('')).toEqual([{ kind: 'text', text: '' }])
  })

  it('单个 @ 引用切出 ref + 两侧 text', () => {
    const segs = splitMentionRefs('帮我看看 @章节3.md 的节奏')
    expect(targets(segs)).toEqual(['章节3.md'])
    // raw 保留 @ 前缀（渲染 chip 用原文）
    expect(segs.find(s => s.kind === 'ref')).toEqual({ kind: 'ref', raw: '@章节3.md', target: '章节3.md' })
  })

  it('中文标点终止引用，且标点归入 text（不吞标点）', () => {
    const segs = splitMentionRefs('@故事架构，帮我规划一下')
    expect(targets(segs)).toEqual(['故事架构'])
    expect(join(segs)).toBe('@故事架构，帮我规划一下')
    // 逗号必须在 text 段里
    expect(segs.some(s => s.kind === 'text' && s.text.startsWith('，'))).toBe(true)
  })

  it('多个引用全部切出', () => {
    const segs = splitMentionRefs('对比 @架构 和 @蓝图 的差异')
    expect(targets(segs)).toEqual(['架构', '蓝图'])
  })

  it('绝对路径（含空格）不被空格截断', () => {
    const segs = splitMentionRefs('看 @C:\\My Documents\\笔记.md 这个文件')
    expect(targets(segs)).toEqual(['C:\\My Documents\\笔记.md'])
  })

  it('绝对路径尾部的中文句读被剥离', () => {
    const segs = splitMentionRefs('@C:\\a\\b.md，然后呢')
    expect(targets(segs)).toEqual(['C:\\a\\b.md'])
    expect(join(segs)).toBe('@C:\\a\\b.md，然后呢')
  })

  it('一行内绝对路径与通用提及可共存', () => {
    const segs = splitMentionRefs('@C:\\a.md 然后 @架构')
    expect(targets(segs)).toEqual(['C:\\a.md', '架构'])
  })

  it('邮箱形态不被切成引用（@ 前必须是行首或空白）', () => {
    const segs = splitMentionRefs('联系 foo@bar.com 谢谢')
    expect(targets(segs)).toEqual([])
    expect(segs).toEqual([{ kind: 'text', text: '联系 foo@bar.com 谢谢' }])
  })

  it('行首的 @ 可正常切出（@ 前无字符不算邮箱）', () => {
    expect(targets(splitMentionRefs('@架构'))).toEqual(['架构'])
  })

  it('段落拼回后与输入逐字相等（不丢字符）', () => {
    const cases = [
      '帮我看看 @章节3.md 的节奏',
      '@故事架构，帮我规划一下',
      '看 @C:\\My Documents\\笔记.md 这个文件',
      '@C:\\a.md 然后 @架构',
      '无引用',
      '@开头',
      '结尾是@',
    ]
    for (const c of cases) {
      expect(join(splitMentionRefs(c))).toBe(c)
    }
  })

  it('引用在行尾时不产生多余空段', () => {
    const segs = splitMentionRefs('参考 @架构')
    expect(segs).toEqual([
      { kind: 'text', text: '参考 ' },
      { kind: 'ref', raw: '@架构', target: '架构' },
    ])
  })

  it('单独一个 @ 不产生引用（无内容可切）', () => {
    const segs = splitMentionRefs('@')
    expect(targets(segs)).toEqual([])
    expect(join(segs)).toBe('@')
  })
})
