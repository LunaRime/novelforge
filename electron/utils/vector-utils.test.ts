/**
 * `electron/utils/vector-utils.ts` —— 向量长度不符的**错误文案归属**（final wave W6）。
 *
 * 背景：本模块是纯数学工具（相似度 / 距离 / 点积），与知识库索引、迁移、重建毫无关系，
 * 但 T4/A4.1 把这三个 throw 一并指向了 KB 专用键 `error.embeddingDimMismatch`
 * ——其文案是「…已中止本次操作以保护现有索引。请重建知识库索引（删除项目下
 * .novelforge/lancedb 后重新导入）再试。」。该文案从 `embedding:similarity-search`
 * （`embedding-controller.ts:89` 的 `cosineSimilarity`）可达：一次普通的长度不符
 * 会让用户收到「去删 lancedb 重建索引」的**错误操作指引**。
 *
 * 本文件锁两件事：
 * ① 三个数学函数一律抛**通用**长度不符文案（且 {expected}/{actual} 按 a/b 顺序正确替换）；
 * ② KB 专用键仍然存在且仍是 KB 语义（不做「删掉旧键」式修复——KB 路径还要用它）。
 *
 * 注：本模块只 import `src/shared/locale`，模块图内**无 electron 导入**（ci-parity-standard 无需 mock）。
 */
import { describe, it, expect } from 'vitest'
import { cosineSimilarity, euclideanDistance, dotProduct, findMostSimilar } from './vector-utils'
import { t, UI_TEXTS, SUPPORTED_LOCALES } from '../../src/shared/locale'

/** 文案「首个占位符之前」的稳定前缀（跟字典走，不写死文案） */
function prefixOf(key: Parameters<typeof t>[0]): string {
  return t(key).split('{')[0]
}

describe('W6：向量长度不符 → 通用文案，不得指向「重建知识库索引」', () => {
  const a = [1, 2, 3]
  const b = [1, 2, 3, 4, 5]

  it('cosineSimilarity：3 维 vs 5 维 → 抛通用长度文案且两个数字正确', () => {
    expect(() => cosineSimilarity(a, b)).toThrow(prefixOf('error.vectorLengthMismatch'))
    let msg = ''
    try { cosineSimilarity(a, b) } catch (e) { msg = (e as Error).message }
    expect(msg).toContain('3')
    expect(msg).toContain('5')
  })

  it('euclideanDistance：同上', () => {
    expect(() => euclideanDistance(a, b)).toThrow(prefixOf('error.vectorLengthMismatch'))
    let msg = ''
    try { euclideanDistance(a, b) } catch (e) { msg = (e as Error).message }
    expect(msg).toContain('3')
    expect(msg).toContain('5')
  })

  it('dotProduct：同上', () => {
    expect(() => dotProduct(a, b)).toThrow(prefixOf('error.vectorLengthMismatch'))
  })

  it('findMostSimilar 经 cosineSimilarity 传播：候选长度不符 → 通用文案（调用方 embedding:similarity-search 的真实形态）', () => {
    expect(() => findMostSimilar(a, [{ vector: b, metadata: null }], 1))
      .toThrow(prefixOf('error.vectorLengthMismatch'))
  })

  it('长度一致 → 三个函数都不抛（通用键不得误伤正常路径）', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(euclideanDistance([1, 0], [1, 0])).toBe(0)
    expect(dotProduct([1, 2], [3, 4])).toBe(11)
  })

  it('KB 专用文案**不再**从数学工具泄漏出「重建知识库索引 / 删除 .novelforge/lancedb」指引', () => {
    const kbPrefix = prefixOf('error.embeddingDimMismatch')
    const msgs: string[] = []
    for (const fn of [cosineSimilarity, euclideanDistance, dotProduct]) {
      try { fn(a, b) } catch (e) { msgs.push((e as Error).message) }
    }
    expect(msgs).toHaveLength(3)
    for (const m of msgs) {
      expect(m).not.toContain(kbPrefix)            // 不是 KB 那句
      expect(m).not.toContain('lancedb')           // 不含「删 lancedb」指引
      expect(m).toContain(prefixOf('error.vectorLengthMismatch'))
    }
  })

  it('通用键三语齐（直读 UI_TEXTS，不吃 t() 的 zh-CN 回落）且与 KB 键是**不同**条目', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(UI_TEXTS['error.vectorLengthMismatch'][locale], `缺 ${locale}`).toBeTruthy()
      expect(UI_TEXTS['error.embeddingDimMismatch'][locale], `缺 ${locale}`).toBeTruthy()
    }
    expect(UI_TEXTS['error.vectorLengthMismatch']['zh-CN'])
      .not.toBe(UI_TEXTS['error.embeddingDimMismatch']['zh-CN'])
  })
})
