/**
 * NovelForge 向量工具 — 向量比较和相似度计算
 *
 * 提供：
 * 1. 余弦相似度计算
 * 2. 欧几里得距离
 * 3. Top-K 最近邻查找
 * 4. 向量归一化
 */

import { t } from '../../src/shared/locale'

/**
 * 两个向量长度不同时抛出**通用**文案（final wave W6）。
 *
 * ⚠️ 本模块是纯数学工具（相似度/距离/点积），与知识库索引、迁移、重建**毫无关系**。
 * 改造前这里复用的是 KB 专用键 `error.embeddingDimMismatch`，其文案是
 * 「…已中止本次操作以保护现有索引。请重建知识库索引（删除项目下 .novelforge/lancedb 后重新导入）再试。」
 * —— 用户在 `embedding:similarity-search` 这类普通比较上收到「去删 lancedb 重建索引」的错误指引
 * （该路径本轮已可达：`embedding-controller.ts:89` 的 `cosineSimilarity` 对纯长度不符即抛）。
 * KB 路径继续用 KB 专用键；长度不符在这里用 `error.vectorLengthMismatch`。
 */
function lengthMismatch(a: number[], b: number[]): Error {
  return new Error(
    t('error.vectorLengthMismatch')
      .replace('{expected}', String(a.length))
      .replace('{actual}', String(b.length)),
  )
}

// ===== 相似度/距离计算 =====

/**
 * 计算两个向量的余弦相似度
 * 返回值范围 [-1, 1]，1 表示完全相同方向
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw lengthMismatch(a, b)

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  if (magnitude === 0) return 0

  return dotProduct / magnitude
}

/**
 * 计算两个向量的欧几里得距离
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) throw lengthMismatch(a, b)

  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }

  return Math.sqrt(sum)
}

/**
 * 计算两个向量的点积
 */
export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) throw lengthMismatch(a, b)

  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i]
  }
  return sum
}

// ===== Top-K 查找 =====

export interface SimilarityResult<T = unknown> {
  similarity: number
  metadata: T
  index: number
}

/**
 * 在候选向量中查找与查询向量最相似的前 K 个
 *
 * @param query 查询向量
 * @param candidates 候选向量列表（每个包含 vector 和 metadata）
 * @param topK 返回前 K 个结果
 * @param threshold 相似度阈值（低于此值的结果被过滤），默认 0
 * @returns 按相似度降序排列的结果
 */
export function findMostSimilar<T = unknown>(
  query: number[],
  candidates: Array<{ vector: number[]; metadata: T }>,
  topK: number,
  threshold = 0,
): SimilarityResult<T>[] {
  const results: SimilarityResult<T>[] = []

  for (let i = 0; i < candidates.length; i++) {
    const similarity = cosineSimilarity(query, candidates[i].vector)
    if (similarity >= threshold) {
      results.push({
        similarity,
        metadata: candidates[i].metadata,
        index: i,
      })
    }
  }

  // 按相似度降序排序
  results.sort((a, b) => b.similarity - a.similarity)

  // 返回前 K 个
  return results.slice(0, topK)
}

// ===== 向量运算 =====

/**
 * 向量归一化（L2 范数）
 */
export function normalize(vector: number[]): number[] {
  let sumSq = 0
  for (const v of vector) {
    sumSq += v * v
  }
  const magnitude = Math.sqrt(sumSq)
  if (magnitude === 0) return vector.slice()

  return vector.map((v) => v / magnitude)
}

/**
 * 计算向量均值
 */
export function mean(vectors: number[][]): number[] {
  if (vectors.length === 0) return []

  const dim = vectors[0].length
  const result = new Array(dim).fill(0)

  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      result[i] += vec[i]
    }
  }

  const n = vectors.length
  for (let i = 0; i < dim; i++) {
    result[i] /= n
  }

  return result
}
