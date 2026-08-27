import { describe, it, expect } from 'vitest'
import { detectWritingIntent } from './writing-intent'

describe('detectWritingIntent 命中表', () => {
  it('写第三章 → chapter_creation(3)', () => {
    expect(detectWritingIntent('帮我写第三章')).toEqual({ kind: 'chapter_creation', chapter: 3 })
  })
  it('创作 5-8 章 → chapter_creation(range)', () => {
    expect(detectWritingIntent('创作 5-8 章')).toEqual({ kind: 'chapter_creation', chapter: { from: 5, to: 8 } })
  })
  it('写 → ambiguous（缺章号，hint=chapter；I3 回归：祈使句不被查询护栏误伤）', () => {
    expect(detectWritingIntent('帮我写')).toEqual({ kind: 'ambiguous', hint: 'chapter' })
  })
  it('润色第2章 → refine(2)', () => {
    expect(detectWritingIntent('把第2章润色一下')).toEqual({ kind: 'refine', chapter: 2 })
  })
  it('修改这段 → refine(null)', () => {
    expect(detectWritingIntent('修改这段文字')).toEqual({ kind: 'refine', chapter: null })
  })
  it('创建一个叫苏晚晴的角色 → character(苏晚晴, create)', () => {
    expect(detectWritingIntent('创建一个叫苏晚晴的角色')).toEqual({ kind: 'character', name: '苏晚晴', action: 'create' })
  })
  it('修改苏晚晴的角色设定 → character(苏晚晴, update)', () => {
    expect(detectWritingIntent('修改苏晚晴的角色设定')).toEqual({ kind: 'character', name: '苏晚晴', action: 'update' })
  })
  it('生成大纲 → architecture(blueprint)', () => {
    expect(detectWritingIntent('生成大纲')).toEqual({ kind: 'architecture', target: 'blueprint' })
  })
  it('重新规划剧情 → architecture(architecture)', () => {
    expect(detectWritingIntent('重新规划剧情')).toEqual({ kind: 'architecture', target: 'architecture' })
  })
  it('纯聊天 → none（查询类不预路由）', () => {
    expect(detectWritingIntent('苏晚晴的性格是什么')).toEqual({ kind: 'none' })
  })
  it('带 @提及的消息 → none（@由既有链路处理，预路由不抢）', () => {
    expect(detectWritingIntent('@故事架构 帮我看看')).toEqual({ kind: 'none' })
  })
  it('第二十章 → chapter_creation(20)；二十章 → 20（十位组合，评审覆盖缺口修订）', () => {
    expect(detectWritingIntent('帮我写第二十章')).toEqual({ kind: 'chapter_creation', chapter: 20 })
    expect(detectWritingIntent('写二十章')).toEqual({ kind: 'chapter_creation', chapter: 20 })
  })
  it('「第 3 章」带空格 → chapter_creation(3)（空格容忍，评审覆盖缺口修订）', () => {
    expect(detectWritingIntent('帮我写第 3 章')).toEqual({ kind: 'chapter_creation', chapter: 3 })
  })
  it('「创建角色」无名字 → ambiguous（澄清而非静默 none，评审覆盖缺口修订）', () => {
    expect(detectWritingIntent('创建角色')).toMatchObject({ kind: 'ambiguous' })
  })
  it('「润色一下」→ refine(null)（「一下」不当作章号，A1 评审实测修正）', () => {
    expect(detectWritingIntent('润色一下')).toEqual({ kind: 'refine', chapter: null })
  })
  it('「修改一下」→ refine(null)（同上）', () => {
    expect(detectWritingIntent('修改一下')).toEqual({ kind: 'refine', chapter: null })
  })
  it('「优化一下」→ refine(null)（同上）', () => {
    expect(detectWritingIntent('优化一下')).toEqual({ kind: 'refine', chapter: null })
  })
  it('「修改角色设定」无名字 → 回落 refine(null)（不触发垃圾名角色更新，A1 评审实测修正）', () => {
    expect(detectWritingIntent('修改角色设定')).toEqual({ kind: 'refine', chapter: null })
  })
  it('「修改一下角色设定」→ 回落 refine(null)（「一下」是助词非名字，A1 评审二轮实测修正）', () => {
    expect(detectWritingIntent('修改一下角色设定')).toEqual({ kind: 'refine', chapter: null })
  })
  it('「调整一下角色设定」→ 回落 none（调整非 refine 动词；无章节语义归 ReAct 兜底，同上）', () => {
    expect(detectWritingIntent('调整一下角色设定')).toEqual({ kind: 'none' })
  })
  it('「更新一下角色设定」→ 回落 none（更新非 refine 动词，同上）', () => {
    expect(detectWritingIntent('更新一下角色设定')).toEqual({ kind: 'none' })
  })
  it('「修改一下苏晚晴的角色设定」→ character(苏晚晴, update)（「一下」助词消费，名字正常，A1 评审二轮需求）', () => {
    expect(detectWritingIntent('修改一下苏晚晴的角色设定')).toEqual({ kind: 'character', name: '苏晚晴', action: 'update' })
  })
  it('「写作风格是什么」→ none（查询护栏：宽写动词不拦截查询类，I3）', () => {
    expect(detectWritingIntent('写作风格是什么')).toEqual({ kind: 'none' })
  })
  it('「怎么写出更精彩的对话」→ none（疑问句护栏：查询类留给 ReAct，I3）', () => {
    expect(detectWritingIntent('怎么写出更精彩的对话')).toEqual({ kind: 'none' })
  })
  it('「写作手法怎么练」→ none（怎么写/写作形态护栏变体，I3）', () => {
    expect(detectWritingIntent('写作手法怎么练')).toEqual({ kind: 'none' })
  })
  it('「写第3章」→ chapter_creation(3)（带章号先于护栏返回，不受查询护栏影响，I3）', () => {
    expect(detectWritingIntent('写第3章')).toEqual({ kind: 'chapter_creation', chapter: 3 })
  })
  it('「修改 一下角色设定」→ 不 character（空格变体：守卫前瞻容忍前导空格，M1）', () => {
    expect(detectWritingIntent('修改 一下角色设定')).toEqual({ kind: 'refine', chapter: null })
  })
})
