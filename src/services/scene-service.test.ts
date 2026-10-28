import { describe, it, expect } from 'vitest'
import { moveScene } from './scene-service'

describe('moveScene', () => {
  it('向下移动', () => {
    expect(moveScene([1, 2, 3], 0, 1)).toEqual([2, 1, 3])
  })

  it('向上移动', () => {
    expect(moveScene([1, 2, 3], 2, 1)).toEqual([1, 3, 2])
  })

  it('跨多位移动到末尾', () => {
    expect(moveScene([1, 2, 3, 4], 0, 3)).toEqual([2, 3, 4, 1])
  })

  it('越界目标钳制到边界', () => {
    expect(moveScene([1, 2, 3], 0, 99)).toEqual([2, 3, 1])
    expect(moveScene([1, 2, 3], 2, -5)).toEqual([3, 1, 2])
  })

  it('无效源或原地不动时返回原引用（调用方据此跳过写库）', () => {
    const ids = [1, 2, 3]
    expect(moveScene(ids, 1, 1)).toBe(ids)
    expect(moveScene(ids, 5, 0)).toBe(ids)
    expect(moveScene(ids, -1, 2)).toBe(ids)
    expect(moveScene([], 0, 1)).toEqual([])
  })
})
