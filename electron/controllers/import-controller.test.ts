/**
 * 导入拆章逻辑单元测试
 *
 * 覆盖两个历史 bug 的回归验证：
 * 1. 前言/序章：首行丢失 + 前言被当作"第 1 章"（标题错误）
 * 2. 多文件章号覆盖：跨文件相同章号互相覆盖丢章节
 */
import { describe, it, expect } from 'vitest'
import {
  splitSingleFileContent,
  hasChapterHeadings,
  dedupeInFile,
} from './import-controller'

describe('splitSingleFileContent — 前言/序章处理', () => {
  it('有前言时：前言完整保留（含首行），标题为"前言"，后续章节编号正确', () => {
    const content = [
      '这是引言的第一行',
      '这是引言的第二行',
      '第一章 开端',
      '故事从这里开始',
      '第二章 发展',
      '故事继续',
    ].join('\n')

    const chapters = splitSingleFileContent(content)

    expect(chapters).toHaveLength(3)
    // 前言：首行不丢失
    expect(chapters[0].title).toBe('前言')
    expect(chapters[0].content).toContain('这是引言的第一行')
    expect(chapters[0].content).toContain('这是引言的第二行')
    // 真正的第一章标题不再被前言顶替
    expect(chapters[1].title).toBe('开端')
    expect(chapters[1].content).toBe('故事从这里开始')
    expect(chapters[2].title).toBe('发展')
  })

  it('无前言时：直接按章节标题拆分', () => {
    const content = [
      '第一章 开端',
      '内容A',
      '第二章 发展',
      '内容B',
    ].join('\n')

    const chapters = splitSingleFileContent(content)

    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe('开端')
    expect(chapters[0].number).toBe(1)
    expect(chapters[1].title).toBe('发展')
    expect(chapters[1].number).toBe(2)
  })

  it('无章节标题时：整文件视为前言单章', () => {
    const content = '第一行\n第二行\n第三行'
    expect(hasChapterHeadings(content)).toBe(false)

    const chapters = splitSingleFileContent(content)
    // 无标题 → 单章，首行不丢失
    expect(chapters).toHaveLength(1)
    expect(chapters[0].content).toContain('第一行')
    expect(chapters[0].content).toContain('第三行')
  })

  it('支持英文 Chapter 格式', () => {
    const content = [
      'Chapter 1: The Beginning',
      'content one',
      'Chapter 2: Rising',
      'content two',
    ].join('\n')

    const chapters = splitSingleFileContent(content)
    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe('The Beginning')
    expect(chapters[0].number).toBe(1)
  })
})

describe('dedupeInFile — 文件内去重', () => {
  it('重复章号保留后者（同一文件内）', () => {
    const chapters = [
      { number: 1, title: '第一章 A', content: '旧内容', wordCount: 3 },
      { number: 1, title: '第一章 B', content: '新内容', wordCount: 3 },
      { number: 2, title: '第二章', content: '内容', wordCount: 2 },
    ]
    const deduped = dedupeInFile(chapters)
    expect(deduped).toHaveLength(2)
    expect(deduped[0].title).toBe('第一章 B')
    expect(deduped[1].number).toBe(2)
  })

  it('不同章节号全部保留', () => {
    const chapters = [
      { number: 1, title: '一', content: 'a', wordCount: 1 },
      { number: 2, title: '二', content: 'b', wordCount: 1 },
    ]
    expect(dedupeInFile(chapters)).toHaveLength(2)
  })
})

describe('文件内重复章节标题', () => {
  it('拆章保留重复项，由 dedupeInFile 去重（保留后者）', () => {
    const content = [
      '第一章 开始',
      '第一次内容',
      '第一章 重写',
      '第二次内容',
    ].join('\n')

    const chapters = splitSingleFileContent(content)
    expect(chapters).toHaveLength(2)

    const deduped = dedupeInFile(chapters)
    expect(deduped).toHaveLength(1)
    expect(deduped[0].title).toBe('重写')
    expect(deduped[0].content).toBe('第二次内容')
  })
})
