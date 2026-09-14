/**
 * 向量降级链的纯决策模块（T3）
 *
 * 职责（**零副作用、零 IO、不 import electron**，可在 CI 无 electron 二进制下直跑）：
 * - `resolveEmbeddingOrder`：由用户配置解析**档位顺序**（local / api / llm / fts）
 * - `hasUsableVectors`：该档是否产出可用向量（失败 → 继续降级）
 * - `firstVectorDim`：待写向量维度（维度硬校验 + schema 构建的唯一口径）
 *
 * 设计约束（brief）：
 * - `enabled = false`（默认）→ `['api','llm','fts']` 与改造前的三级降级链**逐字等价**（兼容性硬要求）；
 * - 顺序是**唯一**来源：knowledge-base 的两处降级段（`importContent` / `backfillVectors`）只消费本函数，
 *   不再各自维护顺序判断（避免两站点漂移）。
 */

/** 降级档位：local（本地 Ollama）→ api（远程 Embedding API）→ llm（LLM 向量化）→ fts（纯全文，终态兜底） */
export type EmbeddingSource = 'local' | 'api' | 'llm' | 'fts'

/** 顺序输入：T4 `GlobalConfig.localEmbedding` 的两个开关字段（此处只取最小子集，保持纯函数可测） */
export interface EmbeddingOrderConfig {
  enabled: boolean
  preferLocal: boolean
}

/**
 * 解析降级链顺序（纯函数、确定性、返回新数组）：
 *
 * - `!enabled` → `['api','llm','fts']`（**现状三级**：本地档完全不参与，默认路径用户无感）
 * - `enabled && preferLocal` → `['local','api','llm','fts']`（本地优先）
 * - `enabled && !preferLocal` → `['api','local','llm','fts']`（API 优先，本地兜底）
 *
 * `fts` 恒为末档：它不是"尝试"而是**终态**（无向量写入，仅建全文索引），调用方遇到即停止。
 */
export function resolveEmbeddingOrder(cfg: EmbeddingOrderConfig): EmbeddingSource[] {
  if (!cfg.enabled) return ['api', 'llm', 'fts']
  return cfg.preferLocal
    ? ['local', 'api', 'llm', 'fts']
    : ['api', 'local', 'llm', 'fts']
}

/**
 * 该档是否产出了**可用**向量（降级判定）。
 *
 * 与改造前 `!vectors || vectors.length === 0 || vectors.every(v => v.length === 0)` **等价**（取反）：
 * `undefined` / 空数组 / 全空向量一律视为失败 → 继续降级；至少一个非空向量即算成功。
 *
 * T2 交接要点（在此消歧）：`embedLocal` **空输入返回 `[]`、空响应 throw**——`[]` 在本函数判为失败，
 * 因此"本地返回空数组"不会被当成成功写入（不会写入 0 向量的坏行）。
 * 注意「全零向量」（非空）仍算成功：改造前只判长度不判数值，此处保持一致（零向量由归一化侧兜底）。
 */
export function hasUsableVectors(vectors: number[][] | undefined | null): boolean {
  return Array.isArray(vectors) && vectors.length > 0 && vectors.some(v => v.length > 0)
}

/**
 * 首个非空向量的维度；无可用向量 → `0`（表示"本次不写向量"）。
 *
 * 与 `vector-store.addChunks` 的 `detectVectorDim`（首个非空向量）**同口径**：
 * 维度硬校验据此比对，保证校验用的维度就是真正落库的维度。
 */
export function firstVectorDim(vectors: number[][] | undefined | null): number {
  if (!Array.isArray(vectors)) return 0
  for (const v of vectors) {
    if (v.length > 0) return v.length
  }
  return 0
}
