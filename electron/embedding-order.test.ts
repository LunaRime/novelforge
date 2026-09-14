/**
 * 降级链顺序解析（T3，纯函数）
 *
 * 契约（brief 逐字锁定，T3 四级降级链的**唯一**顺序来源）：
 * - `enabled=false`（默认）→ `['api','llm','fts']` —— **现状三级，逐字等价**（兼容性硬要求）
 * - `enabled && preferLocal` → `['local','api','llm','fts']`（本地优先）
 * - `enabled && !preferLocal` → `['api','local','llm','fts']`（API 优先，本地兜底）
 *
 * 本文件零 IO、零 mock：模块本身无副作用、不 import electron（可在 CI 无 electron 二进制下直跑）。
 */
import { describe, it, expect } from 'vitest'
import { resolveEmbeddingOrder, hasUsableVectors, firstVectorDim } from './embedding-order'

describe('resolveEmbeddingOrder（四级降级链顺序，纯函数）', () => {
  it('brief 分支 1：!enabled → 现状三级 [api, llm, fts]（逐字等价）', () => {
    expect(resolveEmbeddingOrder({ enabled: false, preferLocal: true })).toEqual(['api', 'llm', 'fts'])
  })

  it('brief 分支 1 边界：enabled=false 时 preferLocal 不影响结果（两值逐字相同）', () => {
    expect(resolveEmbeddingOrder({ enabled: false, preferLocal: false })).toEqual(['api', 'llm', 'fts'])
    expect(resolveEmbeddingOrder({ enabled: false, preferLocal: true }))
      .toEqual(resolveEmbeddingOrder({ enabled: false, preferLocal: false }))
  })

  it('brief 分支 2：enabled && preferLocal → [local, api, llm, fts]', () => {
    expect(resolveEmbeddingOrder({ enabled: true, preferLocal: true })).toEqual(['local', 'api', 'llm', 'fts'])
  })

  it('brief 分支 3：enabled && !preferLocal → [api, local, llm, fts]', () => {
    expect(resolveEmbeddingOrder({ enabled: true, preferLocal: false })).toEqual(['api', 'local', 'llm', 'fts'])
  })

  it('fts 恒为末档（终态兜底：无向量写入，仅建全文索引）', () => {
    for (const preferLocal of [true, false]) {
      const order = resolveEmbeddingOrder({ enabled: true, preferLocal })
      expect(order[order.length - 1]).toBe('fts')
      expect(order.filter(s => s === 'fts')).toHaveLength(1)
    }
  })

  it('四级档位不重复、不缺失（enabled 时四档齐全；禁用时三档齐全）', () => {
    expect(new Set(resolveEmbeddingOrder({ enabled: true, preferLocal: true })).size).toBe(4)
    expect(new Set(resolveEmbeddingOrder({ enabled: false, preferLocal: true })).size).toBe(3)
  })

  it('返回新数组：调用方就地修改不污染后续调用（纯函数无共享状态）', () => {
    const first = resolveEmbeddingOrder({ enabled: true, preferLocal: true })
    first.push('api')
    first.reverse()
    expect(resolveEmbeddingOrder({ enabled: true, preferLocal: true })).toEqual(['local', 'api', 'llm', 'fts'])
  })
})

describe('hasUsableVectors（该档是否成功——降级判定，纯函数）', () => {
  it('undefined / null / 空数组 → false（未产生向量）', () => {
    expect(hasUsableVectors(undefined)).toBe(false)
    expect(hasUsableVectors(null)).toBe(false)
    expect(hasUsableVectors([])).toBe(false)
  })

  it('全空向量 → false（现状 `vectors.every(v => v.length === 0)` 语义）', () => {
    expect(hasUsableVectors([[], []])).toBe(false)
  })

  it('至少一个非空向量 → true（混有空向量仍算成功，与现状 every 判定等价）', () => {
    expect(hasUsableVectors([[1, 2]])).toBe(true)
    expect(hasUsableVectors([[], [1, 2]])).toBe(true)
  })

  it('全零向量（非空）→ true：现状只判长度，不判数值（零向量由归一化侧兜底）', () => {
    expect(hasUsableVectors([[0, 0, 0]])).toBe(true)
  })
})

describe('firstVectorDim（首个非空向量维度，纯函数）', () => {
  it('与 addChunks 的 detectVectorDim（首个非空向量）同口径', () => {
    expect(firstVectorDim([[1, 2, 3]])).toBe(3)
    expect(firstVectorDim([[], [1, 2]])).toBe(2)
  })

  it('无可用向量 → 0（0 表示「本次不写向量」，维度校验据此放行）', () => {
    expect(firstVectorDim(undefined)).toBe(0)
    expect(firstVectorDim(null)).toBe(0)
    expect(firstVectorDim([])).toBe(0)
    expect(firstVectorDim([[], []])).toBe(0)
  })
})
