import { describe, it, expect } from 'vitest'
import { parseMentions, mentionsToToolCalls, getAllMentionTargets } from './intent-router'

describe('parseMentions', () => {
  it('解析纯 @ 提及', () => {
    const mentions = parseMentions('帮我看看 @故事架构')
    expect(mentions.length).toBe(1)
    expect(mentions[0].target.type).toBe('architecture')
  })

  it('中文标点紧跟提及时仍能解析（修复：\\S+ 吞标点导致失效）', () => {
    const mentions = parseMentions('@故事架构，帮我规划一下')
    expect(mentions.length).toBe(1)
    expect(mentions[0].target.type).toBe('architecture')
  })

  it('句号结尾的提及可解析', () => {
    const mentions = parseMentions('请参考@角色卡。')
    expect(mentions.length).toBe(1)
    expect(mentions[0].target.type).toBe('character')
  })

  it('多个 @ 全部解析', () => {
    const mentions = parseMentions('对比 @故事架构 和 @章节蓝图 的差异')
    expect(mentions.length).toBe(2)
    expect(mentions.map(m => m.target.type).sort()).toEqual(['blueprint', 'architecture'].sort())
  })

  it('未知提及不解析（邮箱等场景）', () => {
    const mentions = parseMentions('联系我 @user123 谢谢')
    expect(mentions.length).toBe(0)
  })

  it('中文提及后可跟空格继续输入', () => {
    const mentions = parseMentions('看看 @故事架构 第三章的安排')
    expect(mentions.length).toBe(1)
  })
})

describe('mentionsToToolCalls', () => {
  it('映射到预取工具', () => {
    const mentions = parseMentions('@故事架构 @角色卡 @章节蓝图 @知识库 @当前章节')
    const calls = mentionsToToolCalls(mentions)
    expect(calls.map(c => c.toolName).sort()).toEqual(
      ['read_architecture', 'read_characters', 'read_blueprint', 'search_knowledge', 'list_chapters'].sort(),
    )
  })

  it('不包含已移除的 file 目标', () => {
    const targets = getAllMentionTargets()
    expect(targets.some(t => t.type === 'file')).toBe(false)
  })
})
