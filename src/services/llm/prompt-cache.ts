/**
 * NovelForge Prompt Caching 工具
 *
 * OpenAI/DeepSeek 等 API 的自动 prompt 缓存机制：
 * 如果请求的 messages 前缀与最近一次请求完全一致，API 自动命中缓存，
 * 输入 token 费用降低 50%。
 *
 * 本模块确保 NovelForge 的消息结构最大化缓存命中率。
 */

import type { ModelProfile } from '../../shared/ipc-channels'

// ===== 缓存键生成 =====

/**
 * 为特定调用场景生成缓存键
 *
 * 相同场景 + 相同静态上下文 = 相同缓存键 → API 端自动缓存命中
 */
export type CacheScope =
  | 'chapter_draft'
  | 'chapter_refine'
  | 'chapter_review'
  | 'architecture_gen'
  | 'blueprint_gen'
  | 'style_analysis'
  | 'agent_chat'
  | 'mutual_eval'

/**
 * 为消息列表生成缓存优化结构。
 *
 * 策略：将最不常变化的内容放在前面（system prompt + 静态上下文），
 * 将变化的内容放在后面（用户消息 + 历史）。
 *
 * 返回的 messages 数组前缀部分保持稳定以利用 API 缓存。
 */
export function structureForCache(
  systemPrompt: string,
  staticContext: string,
  userContent: string,
  history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [],
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

  // 第 1 层：System prompt（最稳定，几乎不变）
  messages.push({ role: 'system', content: systemPrompt })

  // 第 2 层：静态上下文（项目架构、角色卡、世界观 — 只在项目更新时变化）
  if (staticContext) {
    messages.push({ role: 'system', content: staticContext })
  }

  // 第 3 层：历史消息（变化频率：低-中）
  for (const msg of history) {
    messages.push(msg)
  }

  // 第 4 层：当前用户消息（每次不同）
  messages.push({ role: 'user', content: userContent })

  return messages
}

/**
 * 生成缓存键哈希（用于追踪和调试）
 */
export function generateCacheKey(
  scope: CacheScope,
  modelId: string,
  staticContextHash: string,
): string {
  return `${scope}:${modelId}:${staticContextHash}`
}

/**
 * 计算静态上下文的简短哈希（用于缓存键）
 */
export function hashStaticContext(context: string): string {
  let hash = 0
  for (let i = 0; i < context.length; i++) {
    hash = ((hash << 5) - hash) + context.charCodeAt(i)
    hash |= 0
  }
  return hash.toString(36)
}

// ===== 费用追踪 =====

/** 模型价格表（USD per 1M tokens, 2024 年价格，仅供参考） */
export const MODEL_PRICES: Record<string, { input: number; output: number; cachedInput: number }> = {
  'gpt-4o': { input: 2.5, output: 10, cachedInput: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cachedInput: 0.075 },
  'gpt-4-turbo': { input: 10, output: 30, cachedInput: 5 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5, cachedInput: 0.25 },
  'claude-3-opus': { input: 15, output: 75, cachedInput: 7.5 },
  'claude-3.5-sonnet': { input: 3, output: 15, cachedInput: 1.5 },
  'claude-3-haiku': { input: 0.25, output: 1.25, cachedInput: 0.125 },
  'deepseek-chat': { input: 0.14, output: 0.28, cachedInput: 0.07 },
  'deepseek-reasoner': { input: 0.55, output: 2.19, cachedInput: 0.275 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3, cachedInput: 0.0375 },
  'gemini-1.5-pro': { input: 1.25, output: 5, cachedInput: 0.625 },
}

/**
 * 计算调用费用
 */
export function calculateCost(
  model: ModelProfile,
  promptTokens: number,
  completionTokens: number,
  cacheHit: boolean = false,
): { inputCost: number; outputCost: number; totalCost: number; cached: boolean } {
  const name = (model.modelName + model.name).toLowerCase()
  let price = MODEL_PRICES['gpt-4o-mini'] // 默认

  for (const [key, p] of Object.entries(MODEL_PRICES)) {
    if (name.includes(key)) { price = p; break }
  }

  const inputPrice = cacheHit ? price.cachedInput : price.input
  const inputCost = (promptTokens / 1_000_000) * inputPrice
  const outputCost = (completionTokens / 1_000_000) * price.output

  return {
    inputCost: Math.round(inputCost * 10000) / 10000,
    outputCost: Math.round(outputCost * 10000) / 10000,
    totalCost: Math.round((inputCost + outputCost) * 10000) / 10000,
    cached: cacheHit,
  }
}
