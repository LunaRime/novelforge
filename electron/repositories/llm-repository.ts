import { getProjectDb } from '../database'

export class LLMHistoryRepository {
  /** 记录一次 LLM 调用 */
  static logCall(call: {
    model_id: string
    model_name: string
    purpose: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    duration_ms: number
    success: boolean
    error_message?: string
    /** 单次调用费用（美元，由渲染进程按模型单价计算） */
    cost?: number
    /** 缓存命中 token 数（v16：CacheAligner 效果事后统计；旧写入端不传时默认 0）。注意：IPC 参数走 Record<string, unknown>，键名与 model_id 等同为 snake_case */
    cached_tokens?: number
  }): void {
    const db = getProjectDb()
    if (!db) return

    const modelId = call.model_id || 'unknown'
    db.prepare(`
      INSERT INTO llm_calls (model_id, model_name, purpose, prompt_tokens, completion_tokens, total_tokens, cached_tokens, duration_ms, success, error_message, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      modelId, call.model_name || '', call.purpose,
      call.prompt_tokens, call.completion_tokens, call.total_tokens,
      call.cached_tokens ?? 0,
      call.duration_ms, call.success ? 1 : 0, call.error_message ?? '',
      call.cost ?? 0
    )
  }

  /** 获取调用统计 */
  static getStats(): {
    totalCalls: number
    totalTokens: number
    totalPromptTokens: number
    totalCompletionTokens: number
    totalCost: number
  } {
    const db = getProjectDb()
    if (!db) return { totalCalls: 0, totalTokens: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0 }

    const row = db.prepare(`
      SELECT
        COUNT(*) as totalCalls,
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COALESCE(SUM(prompt_tokens), 0) as totalPromptTokens,
        COALESCE(SUM(completion_tokens), 0) as totalCompletionTokens,
        COALESCE(SUM(cost), 0) as totalCost
      FROM llm_calls WHERE success = 1
    `).get() as { totalCalls: number; totalTokens: number; totalPromptTokens: number; totalCompletionTokens: number; totalCost: number }

    return row
  }

  /** 获取最近 LLM 调用记录 */
  static getHistory(limit: number = 50): unknown[] {
    const db = getProjectDb()
    if (!db) return []
    return db.prepare(`
      SELECT id, model_name as modelName, purpose,
        prompt_tokens as promptTokens, completion_tokens as completionTokens,
        total_tokens as totalTokens, duration_ms as durationMs,
        success, cost, created_at as createdAt
      FROM llm_calls ORDER BY id DESC LIMIT ?
    `).all(limit)
  }

  /**
   * 用量统计（按用途/模型两维度聚合 + 合计）
   * @param from 区间起始（毫秒时间戳，含）
   * @param to 区间结束（毫秒时间戳，含）
   */
  static getUsageStats(from: number, to: number): {
    byPurpose: Array<{ purpose: string; calls: number; promptTokens: number; completionTokens: number; cachedTokens: number; cost: number }>
    byModel: Array<{ model: string; calls: number; cost: number }>
    total: { calls: number; cost: number }
  } {
    const empty = { byPurpose: [], byModel: [], total: { calls: 0, cost: 0 } }
    const db = getProjectDb()
    if (!db) return empty

    // 口径与 getStats 一致：仅成功调用（失败调用无 tokens/cost，计入会稀释统计）
    // 时间区间为毫秒时间戳（created_at 为 unixepoch()*1000，v7 迁移已把字符串脏数据转 INTEGER）
    const byPurpose = db.prepare(`
      SELECT purpose,
        COUNT(*) as calls,
        COALESCE(SUM(prompt_tokens), 0) as promptTokens,
        COALESCE(SUM(completion_tokens), 0) as completionTokens,
        COALESCE(SUM(cached_tokens), 0) as cachedTokens,
        COALESCE(SUM(cost), 0) as cost
      FROM llm_calls WHERE success = 1 AND created_at >= ? AND created_at <= ?
      GROUP BY purpose ORDER BY calls DESC
    `).all(from, to) as Array<{ purpose: string; calls: number; promptTokens: number; completionTokens: number; cachedTokens: number; cost: number }>

    const byModel = db.prepare(`
      SELECT model_name as model,
        COUNT(*) as calls,
        COALESCE(SUM(cost), 0) as cost
      FROM llm_calls WHERE success = 1 AND created_at >= ? AND created_at <= ?
      GROUP BY model_name ORDER BY calls DESC
    `).all(from, to) as Array<{ model: string; calls: number; cost: number }>

    const total = db.prepare(`
      SELECT COUNT(*) as calls, COALESCE(SUM(cost), 0) as cost
      FROM llm_calls WHERE success = 1 AND created_at >= ? AND created_at <= ?
    `).get(from, to) as { calls: number; cost: number }

    return { byPurpose, byModel, total }
  }
}
