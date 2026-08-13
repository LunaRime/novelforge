import { describe, expect, it } from 'vitest'
import { buildNamePositions, hasProximity, closestNamePair, hasDialogueMarker, detectChapterInteractions } from './relation-utils'

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

  it('名字是另一名字子串时各自独立收集（P0-3：前缀碰撞过滤——「苏晚」命中「苏晚晴」开头处被跳过）', () => {
    const text = '苏晚晴看着苏晚。'
    const positions = buildNamePositions(text, ['苏晚', '苏晚晴'])
    // 位置0 是「苏晚晴」的开头（更长注册名覆盖）→ 跳过；位置5 为独立「苏晚」
    expect(positions.get('苏晚')).toEqual([5])
    expect(positions.get('苏晚晴')).toEqual([0])
  })

  it('无更长注册名时短名全部保留（无碰撞信息时不做猜测）', () => {
    const text = '苏晚晴看着苏晚。'
    const positions = buildNamePositions(text, ['苏晚'])
    expect(positions.get('苏晚')).toEqual([0, 5])
  })

  it('#34 双形态：带括号名同时命中正文无括号形态，位置去重', () => {
    const text = '无名老乞丐（前魂师）出手，无名老乞丐退到一旁。无名老乞丐再次上前。'
    const positions = buildNamePositions(text, ['无名老乞丐（前魂师）'])
    // 完整名 1 处（位置0，含剥离形态子串）+ 正文独立无括号形态 2 处 → 去重后 3 处
    expect(positions.get('无名老乞丐（前魂师）')?.length).toBe(3)
  })

  it('#34 双形态：正文含完整名时位置不重复', () => {
    const text = '无名老乞丐（前魂师）缓缓起身。'
    const positions = buildNamePositions(text, ['无名老乞丐（前魂师）'])
    expect(positions.get('无名老乞丐（前魂师）')).toEqual([0])
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

describe('closestNamePair', () => {
  it('返回最小间距位置对', () => {
    expect(closestNamePair([0, 1000], [1100])).toEqual([1000, 1100])
  })

  it('任一方为空 → null', () => {
    expect(closestNamePair([], [300])).toBeNull()
    expect(closestNamePair([0], [])).toBeNull()
  })

  it('间距 0 → 立即返回', () => {
    expect(closestNamePair([5, 10], [10])).toEqual([10, 10])
  })
})

describe('hasDialogueMarker（P1-5 互动过滤）', () => {
  it('区间内含引号/说/道 → true', () => {
    expect(hasDialogueMarker('苏晚说：「走吧。」李雷点头。', 0, 12)).toBe(true)
    expect(hasDialogueMarker('苏晚问李雷去路。', 0, 10)).toBe(true)
  })

  it('区间内无对话标记 → false', () => {
    expect(hasDialogueMarker('苏晚走过长廊，李雷在远处练剑。', 0, 18)).toBe(false)
  })

  it('空/非法区间 → false', () => {
    expect(hasDialogueMarker('任意文本', 5, 5)).toBe(false)
    expect(hasDialogueMarker('任意文本', 8, 3)).toBe(false)
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
