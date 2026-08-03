import { describe, it, expect, beforeEach } from 'vitest'
import { parseMentions, mentionsToToolCalls, getAllMentionTargets, searchProjectFiles, searchMentionTargets } from './intent-router'
import { useProjectStore } from '../../stores/project-store'

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

// ===== 项目文件 @ 提及（2026-08-03 新增） =====

const TEST_TREE = [
  { name: '世界观.md', path: '世界观.md', isDir: false },
  { name: '02_架构', path: '02_架构', isDir: true, children: [
    { name: '故事线.md', path: '02_架构/故事线.md', isDir: false },
    { name: '设定.json', path: '02_架构/设定.json', isDir: false },
    { name: '封面.png', path: '02_架构/封面.png', isDir: false }, // 非可读扩展名
  ] },
  { name: '.vela', path: '.vela', isDir: true, children: [
    { name: 'vela.db', path: '.vela/vela.db', isDir: false }, // 内部目录应排除
  ] },
]

beforeEach(() => {
  useProjectStore.setState({ fileTree: TEST_TREE as never })
})

describe('searchProjectFiles', () => {
  it('仅返回可读文本文件', () => {
    const files = searchProjectFiles('', 20)
    const paths = files.map(f => f.value)
    expect(paths).toContain('世界观.md')
    expect(paths).toContain('02_架构/故事线.md')
    expect(paths).not.toContain('02_架构/封面.png') // 非文本
    expect(paths).not.toContain('.vela/vela.db')     // 内部目录
  })

  it('按文件名模糊匹配', () => {
    const files = searchProjectFiles('故事线')
    expect(files.length).toBe(1)
    expect(files[0].value).toBe('02_架构/故事线.md')
  })

  it('文件目标插入文本为相对路径', () => {
    const files = searchProjectFiles('世界观')
    expect(files[0].insertText).toBe('世界观.md')
    expect(files[0].type).toBe('file')
  })

  it('固定目标排在文件之前', () => {
    const results = searchMentionTargets('')
    const firstFileIdx = results.findIndex(r => r.type === 'file')
    const lastFixedIdx = results.findIndex(r => r.type !== 'file' && firstFileIdx >= 0)
    expect(firstFileIdx).toBeGreaterThanOrEqual(0)
    expect(lastFixedIdx).toBeLessThan(firstFileIdx)
  })
})

describe('parseMentions 文件提及', () => {
  it('@路径 解析回文件目标', () => {
    const mentions = parseMentions('请参考 @02_架构/故事线.md 来写')
    expect(mentions.length).toBe(1)
    expect(mentions[0].target.type).toBe('file')
    expect(mentions[0].target.value).toBe('02_架构/故事线.md')
  })

  it('文件提及映射到 read_file', () => {
    const mentions = parseMentions('@世界观.md 的内容是什么')
    const calls = mentionsToToolCalls(mentions)
    expect(calls.length).toBe(1)
    expect(calls[0].toolName).toBe('read_file')
    expect(calls[0].args).toEqual({ file_path: '世界观.md' })
  })
})

describe('parseMentions 项目外文件（绝对路径）', () => {
  it('Windows 盘符路径解析为 file 目标', () => {
    const mentions = parseMentions('参考一下 @C:\\笔记\\设定.md 的内容')
    expect(mentions.length).toBe(1)
    expect(mentions[0].target.type).toBe('file')
    expect(mentions[0].target.value).toBe('C:\\笔记\\设定.md')
    expect(mentions[0].target.displayName).toBe('设定.md')
  })

  it('正斜杠绝对路径解析', () => {
    const mentions = parseMentions('参考 @D:/文档/世界观.txt')
    expect(mentions.length).toBe(1)
    expect(mentions[0].target.value).toBe('D:/文档/世界观.txt')
  })

  it('绝对路径映射到 read_file（原样传递）', () => {
    const mentions = parseMentions('@C:\\桌面\\灵感.md 里有一条好点子')
    const calls = mentionsToToolCalls(mentions)
    expect(calls[0].toolName).toBe('read_file')
    expect(calls[0].args).toEqual({ file_path: 'C:\\桌面\\灵感.md' })
  })

  it('非绝对路径不误判（项目内相对路径保持项目内匹配）', () => {
    const mentions = parseMentions('@02_架构/故事线.md')
    expect(mentions[0].target.value).toBe('02_架构/故事线.md')
  })
})
