import { describe, expect, it } from 'vitest'
import { buildNamePositions, hasProximity, detectChapterInteractions } from './relation-utils'

describe('buildNamePositions', () => {
  it('收集名字在正文中的所有出现位置', () => {
    const text = '苏晚走进门，苏晚坐下，李雷随后进来。'
    const positions = buildNamePositions(text, ['苏晚', '李雷'])
    expect(positions.get('苏晚')).toEqual([0, 6])
    expect(positions.get('李雷')).toEqual([11])
  })

  it('名字不存在于正文时返回空数组', () => {
    const positions = buildNamePositions('这里没有角色名', ['张三'])
    expect(positions.get('张三')).toEqual([])
  })

  it('空名字列表返回空 Map', () => {
    expect(buildNamePositions('任意文本', []).size).toBe(0)
  })

  it('名字是另一名字子串时各自独立收集', () => {
    const text = '苏晚晴看着苏晚。'
    const positions = buildNamePositions(text, ['苏晚', '苏晚晴'])
    expect(positions.get('苏晚')?.length).toBe(2)
    expect(positions.get('苏晚晴')?.length).toBe(1)
  })
})

describe('hasProximity', () => {
  it('两个名字存在间距小于窗口的位置 → true', () => {
    expect(hasProximity([0], [300], 500)).toBe(true)
  })

  it('两个名字最小间距大于等于窗口 → false', () => {
    expect(hasProximity([0], [500], 500)).toBe(false)
    expect(hasProximity([0], [501], 500)).toBe(false)
  })

  it('单方无出现位置 → false', () => {
    expect(hasProximity([], [300], 500)).toBe(false)
    expect(hasProximity([0], [], 500)).toBe(false)
  })

  it('双指针找到全局最小间距（非首位置间距）', () => {
    // 首位置间距 1000，但 a 的第二个位置与 b 间距仅 100
    expect(hasProximity([0, 1000], [1100], 500)).toBe(true)
  })
})

describe('detectChapterInteractions', () => {
  const text = '开头是苏晚独自一人。……（分隔）……结尾处李雷走近苏晚。'

  it('两角色在窗口内同现 → 判定互动', () => {
    const pairs = detectChapterInteractions(text, ['苏晚', '李雷'], 500)
    expect(pairs.get('苏晚')).toContain('李雷')
    expect(pairs.get('李雷')).toContain('苏晚')
  })

  it('两角色从未同现 → 无互动', () => {
    const farText = '第一段只有苏晚。第二段只有李雷。第三段只有王五。'
    const pairs = detectChapterInteractions(farText, ['苏晚', '李雷'], 5)
    expect(pairs.get('苏晚') ?? []).not.toContain('李雷')
  })

  it('结果不含自身', () => {
    const pairs = detectChapterInteractions(text, ['苏晚'], 500)
    expect(pairs.get('苏晚')).toBeUndefined()
  })
})
