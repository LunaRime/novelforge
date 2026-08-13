import { describe, expect, it } from 'vitest'
import { extractCharactersFromText, extractKvFields, assembleCharacterCards } from './architecture-workflow'
import { stringifyField } from './workflow-utils'

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

  it('P0-1: 嵌套 currentState 保留（JSON 主路径——初始状态此前被整体丢弃）', () => {
    const text = `{"name": "张三", "role": "protagonist", "currentState": {"location": "青云宗", "powerLevel": "筑基期", "keyItems": ["灵剑"], "updatedAtChapter": 0}}`
    const cards = extractCharactersFromText(text)
    expect(cards).toHaveLength(1)
    const st = cards[0].currentState as Record<string, unknown>
    expect(st).toBeDefined()
    expect(st.location).toBe('青云宗')
    expect(st.powerLevel).toBe('筑基期')
    expect(st.updatedAtChapter).toBe(0)
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

  it('P0-1: 降级路径——currentState 内层字段回收到嵌套对象（此前拍平到顶层后丢弃）', () => {
    const text = `"name": "孙七", "role": "minor", "currentState": {"location": "荒山", "powerLevel": "炼气期", "updatedAtChapter": 0}`
    const card = extractKvFields(text)
    expect(card.currentState).toEqual({ location: '荒山', powerLevel: '炼气期', updatedAtChapter: 0 })
    // 内层字段不再以顶层键泄漏
    expect(card.location).toBeUndefined()
    expect(card.powerLevel).toBeUndefined()
  })
})

describe('assembleCharacterCards（P0-1：初始角色卡组装）', () => {
  it('currentState 对象透传（不再丢失）', () => {
    const cards = assembleCharacterCards(
      [{ name: '张三', role: 'protagonist', currentState: { location: '青云宗', updatedAtChapter: 0 } }],
      stringifyField,
    )
    expect(cards[0].currentState).toEqual({ location: '青云宗', updatedAtChapter: 0 })
  })

  it('currentState 非对象形态（字符串/数组）防御性丢弃', () => {
    const cards = assembleCharacterCards(
      [
        { name: '张三', currentState: '青云宗' },
        { name: '李四', currentState: ['青云宗'] },
      ],
      stringifyField,
    )
    expect(cards[0].currentState).toBeUndefined()
    expect(cards[1].currentState).toBeUndefined()
  })

  it('不含 currentState 的卡片不受影响', () => {
    const cards = assembleCharacterCards([{ name: '张三', personality: '冷静' }], stringifyField)
    expect(cards[0]).toEqual({ name: '张三', personality: '冷静' })
  })
})
