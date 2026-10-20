import { describe, expect, it } from 'vitest'
import { parseBareJsonToolCalls } from './bare-json-tool-calls'

const known = (name: string) => ['read_drafts', 'edit_file'].includes(name)

describe('parseBareJsonToolCalls', () => {
  it('从正文中提取裸 JSON 工具调用并移除该段', () => {
    const r = parseBareJsonToolCalls(
      '我先读草稿。\n{"name":"read_drafts","arguments":{"chapter_number":1}}\n读完再改。',
      known,
    )
    expect(r?.toolCalls).toEqual([{ name: 'read_drafts', arguments: { chapter_number: 1 } }])
    expect(r?.textParts.join('')).toContain('我先读草稿。')
    expect(r?.textParts.join('')).toContain('读完再改。')
    expect(r?.textParts.join('')).not.toContain('"name"')
  })

  it('未知工具 / arguments 非对象不误判', () => {
    expect(parseBareJsonToolCalls('{"name":"unknown","arguments":{}}', known)).toBeNull()
    expect(parseBareJsonToolCalls('{"name":"read_drafts","arguments":"x"}', known)).toBeNull()
  })

  it('支持 tool/parameters 与数组中的对象', () => {
    const r = parseBareJsonToolCalls('[{"tool":"read_drafts","parameters":{"chapter_number":1}}]', known)
    expect(r?.toolCalls[0]).toEqual({ name: 'read_drafts', arguments: { chapter_number: 1 } })
  })
})
