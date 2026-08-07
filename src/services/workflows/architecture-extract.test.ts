import { describe, expect, it } from 'vitest'
import { extractCharactersFromText } from './architecture-workflow'

describe('extractCharactersFromText 主路径（对象扫描 + 类 JSON 提取）', () => {
  it('提取字符串字段', () => {
    const text = `{"name": "张三", "role": "protagonist", "personality": "冷静果敢"}`
    const cards = extractCharactersFromText(text)
    expect(cards).toHaveLength(1)
    expect(cards[0].name).toBe('张三')
    expect(cards[0].role).toBe('protagonist')
  })

  it('数字/布尔字段不丢失（P2 修复回归锁定）', () => {
    const text = `{"name": "李四", "role": "antagonist", "age": 25, "alive": true}`
    const cards = extractCharactersFromText(text)
    expect(cards).toHaveLength(1)
    expect(cards[0].age).toBe(25)
    expect(cards[0].alive).toBe(true)
  })

  it('值中带转义引号与换行', () => {
    const text = `{"name": "王五", "appearance": "外号\\"刀客\\"\\n高个"}`
    const cards = extractCharactersFromText(text)
    expect(cards).toHaveLength(1)
    expect(cards[0].appearance).toContain('"刀客"')
  })
})

describe('extractCharactersFromText 降级路径（无大括号结构 → extractByNamePattern）', () => {
  it('字符串字段提取', () => {
    const text = `"name": "赵六", "role": "supporting", "motivation": "复仇"`
    const cards = extractCharactersFromText(text)
    expect(cards).toHaveLength(1)
    expect(cards[0].name).toBe('赵六')
    expect(cards[0].motivation).toBe('复仇')
  })

  it('数字/布尔字段不丢失（与主路径行为一致——本次修复）', () => {
    const text = `"name": "孙七", "role": "minor", "age": 30, "alive": false`
    const cards = extractCharactersFromText(text)
    expect(cards).toHaveLength(1)
    expect(cards[0].age).toBe(30)
    expect(cards[0].alive).toBe(false)
  })
})
