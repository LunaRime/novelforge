import { describe, it, expect } from 'vitest'
import { detectWritingIntent } from './writing-intent'

describe('detectWritingIntent 命中表', () => {
  it('写第三章 → chapter_creation(3)', () => {
    expect(detectWritingIntent('帮我写第三章')).toEqual({ kind: 'chapter_creation', chapter: 3 })
  })
  it('创作 5-8 章 → chapter_creation(range)', () => {
    expect(detectWritingIntent('创作 5-8 章')).toEqual({ kind: 'chapter_creation', chapter: { from: 5, to: 8 } })
  })
  it('写 → ambiguous（缺章号，hint 提示）', () => {
    const r = detectWritingIntent('帮我写')
    expect(r.kind).toBe('ambiguous')
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
})
