import { describe, it, expect } from 'vitest'
import { buildDraftTab } from './draft-tab'

describe('buildDraftTab', () => {
  it('生成带章节号的草稿 Tab', () => {
    const tab = buildDraftTab({
      draftId: 42, chapterNumber: 3, chapterTitle: '雨夜', version: 2, content: '正文',
    })
    expect(tab).toMatchObject({
      id: 'vela://draft/42',
      filePath: 'vela://draft/42',
      type: 'chapter',
      chapterNumber: 3,
      content: '正文',
    })
    expect(tab.name).toContain('第3章')
    expect(tab.name).toContain('雨夜')
    expect(tab.name).toContain('v2')
  })

  it('标题已带“第N章”前缀时不重复拼接', () => {
    const tab = buildDraftTab({
      draftId: 1, chapterNumber: 2, chapterTitle: '第2章 风起', version: 1, content: '',
    })
    expect(tab.name.match(/第2章/g)).toHaveLength(1)
  })

  it('无标题时只显示章节号与版本', () => {
    const tab = buildDraftTab({
      draftId: 7, chapterNumber: 5, version: 3, content: '',
    })
    expect(tab.name).toBe('第5章 v3')
  })
})