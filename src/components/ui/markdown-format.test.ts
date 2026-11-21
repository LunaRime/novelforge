import { describe, expect, it } from 'vitest'
import { markdownFormatChange } from './markdown-format'

describe('共用 Markdown 格式动作', () => {
  it('插入强调标记后保留原选区，再次使用同一动作可移除标记', () => {
    const added = markdownFormatChange('潮声', 0, 2, 'bold')
    expect(added).toEqual({ from: 0, to: 2, insert: '**潮声**', anchor: 2, head: 4 })
    expect(markdownFormatChange(added.insert, added.anchor, added.head, 'bold'))
      .toEqual({ from: 0, to: 6, insert: '潮声', anchor: 0, head: 2 })
  })

  it('多行块格式不误改选区末尾的下一行', () => {
    expect(markdownFormatChange('序\n海\n岸\n尾', 2, 6, 'quote'))
      .toEqual({ from: 2, to: 5, insert: '> 海\n> 岸', anchor: 2, head: 9 })
  })
})
