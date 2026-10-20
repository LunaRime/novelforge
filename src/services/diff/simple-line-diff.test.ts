import { describe, expect, it } from 'vitest'
import { simpleLineDiff } from './simple-line-diff'

describe('simpleLineDiff', () => {
  it('标记新增/删除/未变行', () => {
    const lines = simpleLineDiff('第一行\n第二行\n第三行', '第一行\n第二行改\n第三行\n第四行')
    expect(lines.filter((l) => l.type === 'same').map((l) => l.text)).toEqual(['第一行', '第三行'])
    expect(lines.some((l) => l.type === 'del' && l.text === '第二行')).toBe(true)
    expect(lines.some((l) => l.type === 'add' && l.text === '第二行改')).toBe(true)
    expect(lines.some((l) => l.type === 'add' && l.text === '第四行')).toBe(true)
  })

  it('相同文本没有 add/del', () => {
    const lines = simpleLineDiff('a\nb', 'a\nb')
    expect(lines.every((l) => l.type === 'same')).toBe(true)
  })

  it('超大文本降级为截断预览而不是卡死', () => {
    const big = Array.from({ length: 1500 }, (_, i) => `line ${i}`).join('\n')
    const lines = simpleLineDiff(big, big)
    expect(lines.length).toBeLessThan(100)
    expect(lines.some((l) => l.text.includes('truncated'))).toBe(true)
  })
})
