/**
 * 容量 K/M 纯函数（模型管理 v3 T7，契约见 task-7-brief Step 1）。
 *
 * 词汇量刻意只有两个后缀：`K` = 1000、`M` = 1e6（**不是** 1024/1048576 —— 模型容量
 * 在业界就是按 10 进制报的），与 dsh `parseCapacity`/`formatCapacity` 同型。
 * 两个函数互为往返：`parseCapacity(formatCapacity(n)) === n`。
 */
import { describe, it, expect } from 'vitest'
import { formatCapacity, parseCapacity } from './capacity'

describe('parseCapacity —— 输入原文 → token 数', () => {
  it('256K = 256000 / 1m = 1000000（大小写不敏感，K = 1000 而非 1024）', () => {
    expect(parseCapacity('256K')).toBe(256_000)
    expect(parseCapacity('256k')).toBe(256_000)
    expect(parseCapacity('1m')).toBe(1_000_000)
    expect(parseCapacity('1M')).toBe(1_000_000)
  })

  it('裸数字原样：131072 → 131072（不缩放）', () => {
    expect(parseCapacity('131072')).toBe(131_072)
    expect(parseCapacity('8192')).toBe(8_192)
  })

  it('空串 / 纯空白 = undefined（= 继承，不是 0，也不是非法）', () => {
    expect(parseCapacity('')).toBeUndefined()
    expect(parseCapacity('   ')).toBeUndefined()
  })

  it('乱串 = NaN（区别于「空 = 继承」—— 两者必须可分辨，否则非法值会被当成继承静默放行）', () => {
    expect(parseCapacity('256KK')).toBeNaN()
    expect(parseCapacity('abc')).toBeNaN()
    expect(parseCapacity('K')).toBeNaN()
    expect(parseCapacity('12 8')).toBeNaN()
    expect(parseCapacity('1e6')).toBeNaN()
    expect(parseCapacity('-5')).toBeNaN()
    expect(parseCapacity('1.2.3')).toBeNaN()
  })

  it('小数后缀：0.5K = 500；2.3M 落回整数 2300000（二进制浮点不能把用户的整值意图带偏）', () => {
    expect(parseCapacity('0.5K')).toBe(500)
    expect(parseCapacity('2.3M')).toBe(2_300_000)
  })

  it('边缘空白是粘贴噪声，trim 后照常解析', () => {
    expect(parseCapacity('  256K ')).toBe(256_000)
  })
})

describe('formatCapacity —— token 数 → 最短往返写法', () => {
  it('整百万 → "1M"；整千 → "256K"；其余原样', () => {
    expect(formatCapacity(1_000_000)).toBe('1M')
    expect(formatCapacity(2_000_000)).toBe('2M')
    expect(formatCapacity(256_000)).toBe('256K')
    expect(formatCapacity(131_072)).toBe('131072')
    expect(formatCapacity(8_192)).toBe('8192')
  })

  it('非整数 / 非正值原样（0 → "0"）：不产出 "0.5K" 这类解析得回但读着别扭的写法', () => {
    expect(formatCapacity(0)).toBe('0')
    expect(formatCapacity(-1)).toBe('-1')
    expect(formatCapacity(1500.5)).toBe('1500.5')
  })

  it('往返：parseCapacity(formatCapacity(n)) === n（整千/整百万/原样三条路都验）', () => {
    for (const n of [1_000_000, 2_300_000, 256_000, 131_072, 8_192, 1_500, 500]) {
      expect(parseCapacity(formatCapacity(n)), `n=${String(n)}`).toBe(n)
    }
  })
})
