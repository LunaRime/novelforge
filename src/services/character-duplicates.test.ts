import { describe, it, expect } from 'vitest'
import { levenshtein, findDuplicatePairs, findPairsForCharacter } from './character-duplicates'

describe('levenshtein', () => {
  it('相同字符串距离 0', () => {
    expect(levenshtein('苏晚', '苏晚')).toBe(0)
  })

  it('单个字符差异距离 1', () => {
    expect(levenshtein('苏晚', '苏婉')).toBe(1)
    expect(levenshtein('李雷', '李雪')).toBe(1)
  })

  it('插入/删除距离', () => {
    expect(levenshtein('苏晚', '苏晚晴')).toBe(1)
    expect(levenshtein('', '苏晚')).toBe(2)
  })

  it('多个字符差异', () => {
    expect(levenshtein('苏晚', '王五')).toBe(2)
  })
})

describe('findDuplicatePairs', () => {
  const chars = [
    { name: '苏晚', aliases: '["阿晚"]' },
    { name: '苏婉' },
    { name: '阿晚' },
    { name: '苏晚晴' }, // 前缀关系：真实存在的不同角色，不算重复
    { name: '李雷' },
    { name: '李雪' },
    { name: '王五', aliases: '["李雷"]' },
  ]

  it('别名等于对方名称 → 强疑似（0.9）', () => {
    const pairs = findDuplicatePairs(chars)
    // 阿晚 = 苏晚 的别名 → 强疑似
    const p = pairs.find(x => x.a === '苏晚' && x.b === '阿晚')
    expect(p?.reason).toBe('alias-equals-name')
    expect(p?.score).toBe(0.9)
  })

  it('共享别名 → 疑似（0.8）', () => {
    const p = findDuplicatePairs(chars).find(x => x.a === '李雷' && x.b === '王五')
    // 王五 的别名恰为 李雷 的名字 → 属于 alias-equals-name（比共享别名更强）
    expect(p?.reason).toBe('alias-equals-name')
    expect(p?.score).toBe(0.9)
  })

  it('等长一字之差 → 疑似（0.6）', () => {
    // 字典序规范化：晚(U+665A) > 婉(U+5A49) → a=苏婉；雷(U+96F7) > 雪(U+96EA) → a=李雪
    const p1 = findDuplicatePairs(chars).find(x => x.a === '苏婉' && x.b === '苏晚')
    expect(p1?.reason).toBe('name-similar')
    expect(p1?.score).toBe(0.6)
    const p2 = findDuplicatePairs(chars).find(x => x.a === '李雪' && x.b === '李雷')
    expect(p2?.reason).toBe('name-similar')
  })

  it('包含关系（苏晚/苏晚晴）不判重复——前缀名是真实角色', () => {
    const pairs = findDuplicatePairs(chars)
    expect(pairs.some(p => p.a === '苏晚' && p.b === '苏晚晴')).toBe(false)
  })

  it('pair 规范化排序且不重复，置信度降序', () => {
    const pairs = findDuplicatePairs(chars)
    for (const p of pairs) {
      expect(p.a < p.b).toBe(true)
    }
    const keys = new Set(pairs.map(p => `${p.a}|${p.b}`))
    expect(keys.size).toBe(pairs.length)
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i - 1].score).toBeGreaterThanOrEqual(pairs[i].score)
    }
  })

  it('无重复数据 → 空数组', () => {
    expect(findDuplicatePairs([{ name: '苏晚' }, { name: '李雷' }])).toEqual([])
  })

  it('空/无名字 → 空数组', () => {
    expect(findDuplicatePairs([])).toEqual([])
    expect(findDuplicatePairs([{ name: '' }])).toEqual([])
  })
})

describe('findPairsForCharacter', () => {
  const chars = [
    { name: '苏晚', aliases: '["阿晚"]' },
    { name: '阿晚' },
    { name: '李雷' },
  ]

  it('只返回与指定角色相关的对', () => {
    const pairs = findPairsForCharacter(chars, '苏晚')
    expect(pairs).toHaveLength(1)
    // 字典序：阿(U+963F) > 苏(U+82CF) → a=苏晚, b=阿晚
    expect(pairs[0].a).toBe('苏晚')
    expect(pairs[0].b).toBe('阿晚')
  })

  it('无关角色 → 空', () => {
    expect(findPairsForCharacter(chars, '李雷')).toEqual([])
  })
})
