/**
 * Vela 模型路由器 — 按任务自动选择最优模型
 *
 * 三层模型策略：
 * - Elite: 创意写作、架构规划 → GPT-4o, Claude Opus, DeepSeek-V3
 * - Standard: 审稿、分析、风格检查 → GPT-4o-mini, DeepSeek-V3, Gemini Flash
 * - Budget: JSON 提取、摘要、分类 → GPT-3.5, 本地模型
 *
 * 预期节省 API 费用 50-70%。
 */

import type { ModelProfile } from '../../shared/ipc-channels'

// ===== 类型定义 =====

export type ModelTier = 'elite' | 'standard' | 'budget'

export type CallPurpose =
  // 创意写作（Elite）
  | 'draft_chapter'
  | 'refine_chapter'
  | 'architecture_gen'
  | 'config_gen'
  | 'first_draft'
  // 标准分析（Standard）
  | 'review_chapter'
  | 'consistency_check'
  | 'style_analysis'
  | 'blueprint_gen'
  | 'mutual_eval'
  | 'character_extract'
  // 轻量操作（Budget）
  | 'summarize'
  | 'extract_json'
  | 'classify'
  | 'embedding'
  // Agent
  | 'agent_chat'
  | 'agent_tool_exec'
  // 通用
  | 'default'

/** 默认的 purpose → tier 映射 */
export const PURPOSE_TIER_MAP: Record<CallPurpose, ModelTier> = {
  // Elite
  draft_chapter: 'elite',
  refine_chapter: 'elite',
  architecture_gen: 'elite',
  config_gen: 'elite',
  first_draft: 'elite',
  // Standard
  review_chapter: 'standard',
  consistency_check: 'standard',
  style_analysis: 'standard',
  blueprint_gen: 'standard',
  mutual_eval: 'standard',
  character_extract: 'standard',
  // Budget
  summarize: 'budget',
  extract_json: 'budget',
  classify: 'budget',
  embedding: 'budget',
  // Agent
  agent_chat: 'standard',
  agent_tool_exec: 'budget',
  // 默认
  default: 'standard',
}

export interface ModelRouteConfig {
  elite: string[]
  standard: string[]
  budget: string[]
}

/** 默认配置（用户可自定义） */
export const DEFAULT_ROUTE_CONFIG: ModelRouteConfig = {
  elite: [],
  standard: [],
  budget: [],
}

// ===== 模型路由器 =====

export class ModelRouter {
  private config: ModelRouteConfig
  private models: ModelProfile[]

  constructor(config: ModelRouteConfig, models: ModelProfile[]) {
    this.config = config
    this.models = models
    this.autoDetectTiers()
  }

  /** 根据 purpose 选择最佳可用模型 */
  route(purpose: CallPurpose): string | null {
    const tier = PURPOSE_TIER_MAP[purpose] || 'standard'

    // 尝试 tier 内的模型
    const tierModelIds = this.config[tier] || []
    for (const id of tierModelIds) {
      const model = this.models.find(m => m.id === id)
      if (model) return id
    }

    // 降级到下一层
    return this.fallback(tier)
  }

  /** 降级链 */
  private fallback(fromTier: ModelTier): string | null {
    const fallbackOrder: ModelTier[] =
      fromTier === 'elite' ? ['standard', 'budget'] :
      fromTier === 'standard' ? ['elite', 'budget'] :
      ['standard', 'elite']

    for (const tier of fallbackOrder) {
      const ids = this.config[tier] || []
      for (const id of ids) {
        if (this.models.find(m => m.id === id)) return id
      }
    }

    // 最终降级：任何可用的模型
    const defaultModel = this.models.find(m => m.id)
    return defaultModel?.id || null
  }

  /** 获取模型的 tier */
  getTier(modelId: string): ModelTier | null {
    for (const tier of ['elite', 'standard', 'budget'] as ModelTier[]) {
      if (this.config[tier]?.includes(modelId)) return tier
    }
    return null
  }

  /** 获取某层所有可用模型 */
  getAvailableInTier(tier: ModelTier): ModelProfile[] {
    const ids = this.config[tier] || []
    return ids
      .map(id => this.models.find(m => m.id === id))
      .filter((m): m is ModelProfile => !!m)
  }

  /** 获取所有分层分配 */
  getAllTiers(): Record<ModelTier, ModelProfile[]> {
    return {
      elite: this.getAvailableInTier('elite'),
      standard: this.getAvailableInTier('standard'),
      budget: this.getAvailableInTier('budget'),
    }
  }

  /**
   * 估算费用（基于每 1K tokens 价格）
   * 这些价格已过时，仅作估算参考。
   */
  estimateCost(
    purpose: CallPurpose,
    estimatedInputTokens: number,
    estimatedOutputTokens: number,
  ): { inputCost: number; outputCost: number; totalCost: number; modelId: string } {
    const modelId = this.route(purpose) || 'unknown'
    const model = this.models.find(m => m.id === modelId)

    // 粗略价格估算（USD per 1K tokens）
    const prices: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 0.0025, output: 0.01 },
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'claude-3-opus': { input: 0.015, output: 0.075 },
      'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
      'claude-3-haiku': { input: 0.00025, output: 0.00125 },
      'deepseek-chat': { input: 0.00014, output: 0.00028 },
      'deepseek-reasoner': { input: 0.00055, output: 0.00219 },
      'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
      'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
    }

    const name = model?.modelName || model?.name || ''
    let priceKey = 'gpt-4o-mini' // default
    for (const [key] of Object.entries(prices)) {
      if (name.toLowerCase().includes(key)) {
        priceKey = key
        break
      }
    }

    const price = prices[priceKey] || prices['gpt-4o-mini']
    const inputCost = (estimatedInputTokens / 1000) * price.input
    const outputCost = (estimatedOutputTokens / 1000) * price.output

    return { inputCost, outputCost, totalCost: inputCost + outputCost, modelId }
  }

  /** 更新配置 */
  updateConfig(config: Partial<ModelRouteConfig>): void {
    if (config.elite) this.config.elite = config.elite
    if (config.standard) this.config.standard = config.standard
    if (config.budget) this.config.budget = config.budget
  }

  /** 更新模型列表 */
  updateModels(models: ModelProfile[]): void {
    this.models = models
    this.autoDetectTiers()
  }

  /** 自动检测模型 tier（基于模型名称） */
  private autoDetectTiers(): void {
    // 只自动分配尚未配置的模型
    const assigned = new Set([
      ...(this.config.elite || []),
      ...(this.config.standard || []),
      ...(this.config.budget || []),
    ])

    for (const model of this.models) {
      if (assigned.has(model.id)) continue

      const name = (model.modelName + model.name).toLowerCase()

      if (
        name.includes('gpt-4o') && !name.includes('mini') ||
        name.includes('claude-3-opus') ||
        name.includes('claude-3.5') ||
        name.includes('claude-opus')
      ) {
        this.config.elite.push(model.id)
      } else if (
        name.includes('deepseek') && !name.includes('lite') ||
        name.includes('gpt-4o-mini') ||
        name.includes('gemini-flash') ||
        name.includes('claude-3-haiku') ||
        name.includes('claude-haiku')
      ) {
        this.config.standard.push(model.id)
      } else if (
        name.includes('gpt-3.5') ||
        name.includes('llama') ||
        name.includes('mistral') ||
        name.includes('deepseek-lite')
      ) {
        this.config.budget.push(model.id)
      } else {
        // 默认放入 standard
        this.config.standard.push(model.id)
      }
      assigned.add(model.id)
    }
  }

  /** 获取配置 */
  getConfig(): ModelRouteConfig {
    return {
      elite: [...this.config.elite],
      standard: [...this.config.standard],
      budget: [...this.config.budget],
    }
  }
}
