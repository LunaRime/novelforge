// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { detectStepKey } from './arch-step-key'
import { parseReport } from './review-report-parser'

describe('P0-1 detectStepKey — vela://core 路径必须识别', () => {
  it('识别侧栏传入的 vela://core/{key}', () => {
    expect(detectStepKey('vela://core/premise')).toBe('premise')
    expect(detectStepKey('vela://core/characters')).toBe('characters')
    expect(detectStepKey('vela://core/worldbuilding')).toBe('worldbuilding')
    expect(detectStepKey('vela://core/synopsis')).toBe('synopsis')
  })

  it('保留旧 .md 路径兼容', () => {
    expect(detectStepKey('/proj/core/premise.md')).toBe('premise')
    expect(detectStepKey('/proj/core/synopsis.md')).toBe('synopsis')
  })

  it('未知 key 与普通路径返回 null', () => {
    expect(detectStepKey('vela://core/unknown')).toBeNull()
    expect(detectStepKey('vela://draft/12')).toBeNull()
    expect(detectStepKey('/proj/notes.txt')).toBeNull()
  })
})

describe('P0-2 parseReport — 解析失败不能算「全部通过」', () => {
  it('可解析的 JSON 报告不算失败', () => {
    const r = parseReport(JSON.stringify({
      items: [{ category: '情节', severity: 'warning', description: '节奏偏慢' }],
      summary: '整体可用',
    }))
    expect(r.parseFailed).toBe(false)
    expect(r.issues).toHaveLength(1)
    expect(r.summary).toBe('整体可用')
  })

  it('非 JSON 的乱码文本标记为 parseFailed', () => {
    const r = parseReport('抱歉，我无法完成这个请求。')
    expect(r.parseFailed).toBe(true)
    expect(r.issues).toHaveLength(0)
  })

  it('空报告也标记为 parseFailed（不能默认通过）', () => {
    expect(parseReport('   ').parseFailed).toBe(true)
  })

  it('旧版 markdown 报告仍能被解析（有汇总行即不算失败）', () => {
    const r = parseReport('## 总体评价\n本章结构完整，节奏尚可。')
    expect(r.parseFailed).toBe(false)
    expect(r.summary.length).toBeGreaterThan(0)
  })
})
