/**
 * Vela Embedding Service — 统一向量嵌入服务
 *
 * 包装 embedding.ts 的低级 API，提供：
 * 1. 缓存层（LRU）：避免重复嵌入相同文本
 * 2. 批量处理：自动分批 + 进度回调
 * 3. 配置管理：模型选择和协议切换
 */

import { generateEmbeddings } from './embedding'
import type { ModelProfile } from '../src/shared/ipc-channels'
import { LLMFactory } from './llm/llm-factory'
import {
  optimizeForEmbedding,
  contentHash,
  type OptimizerConfig,
  type ProgressCallback,
  DEFAULT_OPTIMIZER_CONFIG,
} from './llm-embedding-optimizer'

// ===== 类型定义 =====

export interface EmbeddingConfig {
  modelId: string
  protocol: 'openai' | 'gemini'
  modelName: string
  baseUrl: string
  apiKey: string
  dimensions: number
}

/** LLM 向量化配置 */
export interface LLMEmbeddingConfig {
  /** 是否启用 LLM 向量化 */
  enabled: boolean
  /** 用作向量模型的 LLM 的 ModelProfile */
  model: ModelProfile | null
  /** 输出向量维度（默认 256） */
  dimensions: number
  /** 自定义 prompt 模板（{text} 会被替换为实际文本，{dimensions} 替换为维度） */
  promptTemplate: string
  /** 优化器配置 */
  optimizer: OptimizerConfig
}

export interface EmbeddingResult {
  vector: number[]
  text: string
  tokens: number
  /** 向量来源 */
  source: 'embedding_api' | 'llm' | 'local'
}

// ===== 简单 LRU 缓存 =====

class LRUCache<K, V> {
  private map = new Map<K, V>()
  private maxSize: number

  constructor(maxSize = 10_000) {
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    // 移动到末尾（最近使用）
    const value = this.map.get(key)!
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.maxSize) {
      // 删除最旧的条目
      const firstKey = this.map.keys().next().value
      if (firstKey !== undefined) this.map.delete(firstKey)
    }
    this.map.set(key, value)
  }

  get size(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }
}

// ===== Embedding Service =====

/** 默认 LLM 向量化 prompt 模板 */
export const DEFAULT_LLM_EMBEDDING_PROMPT = `请为以下文本生成一个 {dimensions} 维的语义嵌入向量。

文本：
"""
{text}
"""

要求：
1. 输出一个 JSON 对象，格式为 {"vector": [0.1, -0.2, ...]}，数组长度恰好为 {dimensions}
2. 每个值在 -1.0 到 1.0 之间，保留 4 位小数
3. 相似的文本应产生相似的向量分布
4. 重点关注文本的语义内容、情感基调和核心主题`

export class EmbeddingService {
  private config: EmbeddingConfig | null = null
  private llmConfig: LLMEmbeddingConfig = {
    enabled: false,
    model: null,
    dimensions: 256,
    promptTemplate: DEFAULT_LLM_EMBEDDING_PROMPT,
    optimizer: { ...DEFAULT_OPTIMIZER_CONFIG },
  }
  /** 语义去重缓存（content hash → vector） */
  private dedupCache = new Map<string, { vector: number[]; hits: number }>()
  private cache = new LRUCache<string, number[]>(10_000)
  private cacheHits = 0
  private cacheMisses = 0

  /** 配置嵌入服务（专用 Embedding API） */
  configure(config: EmbeddingConfig): void {
    this.config = config
    console.log(`[EmbeddingService] Embedding API 已配置: ${config.modelName} (${config.protocol}, ${config.dimensions}d)`)
  }

  /** 获取当前 Embedding API 配置 */
  getConfig(): EmbeddingConfig | null {
    return this.config
  }

  /** 从 ModelProfile 配置 Embedding API */
  configureFromModel(model: ModelProfile): void {
    this.configure({
      modelId: model.id,
      protocol: model.protocol as 'openai' | 'gemini',
      modelName: model.modelName || 'text-embedding-3-small',
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      dimensions: 1536,
    })
  }

  // ===== LLM 向量化配置 =====

  /** 配置 LLM 向量化 */
  configureLLMEmbedding(config: Partial<LLMEmbeddingConfig>): void {
    this.llmConfig = { ...this.llmConfig, ...config }
    const status = this.llmConfig.enabled && this.llmConfig.model
      ? `已启用 (模型: ${this.llmConfig.model.modelName}, ${this.llmConfig.dimensions}d)`
      : '已禁用'
    console.log(`[EmbeddingService] LLM 向量化 ${status}`)
  }

  /** 获取 LLM 向量化配置 */
  getLLMEmbeddingConfig(): LLMEmbeddingConfig {
    return { ...this.llmConfig }
  }

  /** 是否可以使用 LLM 向量化 */
  canUseLLMEmbedding(): boolean {
    return this.llmConfig.enabled && this.llmConfig.model !== null
  }

  /** 是否可以使用专用 Embedding API */
  canUseEmbeddingAPI(): boolean {
    return this.config !== null
  }

  /**
   * 通过 LLM 生成向量嵌入
   *
   * 调用 LLM chat API，让 LLM 输出固定维度的语义向量。
   * 适用于没有专用 Embedding API 但有 LLM API 的场景。
   */
  async embedWithLLM(
    text: string,
    onProgress?: ProgressCallback,
  ): Promise<EmbeddingResult> {
    if (!this.canUseLLMEmbedding()) {
      throw new Error('LLM 向量化未启用或未配置模型')
    }

    // ===== 层3：语义去重缓存 =====
    const textHash = contentHash(text)
    const cached = this.dedupCache.get(textHash)
    if (cached) {
      cached.hits++
      return { vector: cached.vector, text, tokens: 0, source: 'llm' }
    }

    const model = this.llmConfig.model!
    const dims = this.llmConfig.dimensions

    // ===== 层1+2：文本优化管道（预处理 + 压缩） =====
    onProgress?.({
      step: '预处理中',
      inputChars: text.length,
      outputChars: 0,
      compressionRate: 0,
    })

    const optimized = optimizeForEmbedding(text, this.llmConfig.optimizer)
    const promptText = optimized.stats.finalChars > 0
      ? optimized.optimizedText
      : text.slice(0, this.llmConfig.optimizer.maxInputChars)

    onProgress?.({
      step: '优化完成',
      inputChars: optimized.stats.originalChars,
      outputChars: optimized.stats.finalChars,
      compressionRate: optimized.stats.overallCompression,
    })

    // 构建 prompt（使用优化后的文本）
    const prompt = this.llmConfig.promptTemplate
      .replace(/{dimensions}/g, String(dims))
      .replace(/{text}/g, promptText)

    try {
      const provider = LLMFactory.getProvider(model)

      onProgress?.({ step: 'LLM 生成中', inputChars: promptText.length, outputChars: 0, compressionRate: optimized.stats.overallCompression })

      // 双重试机制：先尝试 JSON 模式 → 失败则纯文本模式（兼容非 OpenAI API）
      const response = await this.tryGenerateEmbedding(provider, model, prompt, dims)

      if (!response.success) throw new Error(`LLM 调用失败: ${response.error || '未知错误'}`)
      if (!response.content?.trim()) throw new Error('LLM 返回空响应')

      const vector = this.parseLLMVector(response.content, dims)
      if (vector.every(v => v === 0)) throw new Error(`向量无效（全零）。响应: ${response.content.slice(0, 200)}`)

      // 存入去重缓存
      this.dedupCache.set(textHash, { vector, hits: 1 })
      if (this.dedupCache.size > 5000) {
        const first = this.dedupCache.keys().next().value
        if (first) this.dedupCache.delete(first)
      }

      const tokens = response.usage?.totalTokens || Math.ceil(promptText.length * 0.75)
      return { vector, text, tokens, source: 'llm' }
    } catch (error) {
      throw new Error(`LLM 向量化异常: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 批量 LLM 向量化（去重合并） */
  async embedBatchWithLLM(
    texts: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<EmbeddingResult[]> {
    const uniqueMap = new Map<string, { text: string; indices: number[] }>()
    for (let i = 0; i < texts.length; i++) {
      const hash = contentHash(texts[i])
      const e = uniqueMap.get(hash)
      if (e) e.indices.push(i)
      else uniqueMap.set(hash, { text: texts[i], indices: [i] })
    }

    const items = [...uniqueMap.values()]
    const results: EmbeddingResult[] = new Array(texts.length)
    let done = 0
    for (const item of items) {
      try {
        const r = await this.embedWithLLM(item.text)
        for (const idx of item.indices) results[idx] = { ...r, text: texts[idx] }
      } catch {
        for (const idx of item.indices) results[idx] = { vector: [], text: texts[idx], tokens: 0, source: 'llm' }
      }
      done++
      onProgress?.(done, items.length)
    }
    return results
  }

  getDedupCacheStats(): { size: number; totalHits: number } {
    let hits = 0
    for (const [, e] of this.dedupCache) hits += e.hits
    return { size: this.dedupCache.size, totalHits: hits }
  }

  clearDedupCache(): void { this.dedupCache.clear() }

  /**
   * 双重试嵌入生成：兼容所有 API（OpenAI / DeepSeek / 自定义）
   *
   * 尝试 1：使用 response_format: json_object（OpenAI 兼容 API）
   * 尝试 2：移除 response_format，用强力 prompt 约束 JSON 输出（通用兼容）
   */
  private async tryGenerateEmbedding(
    provider: ReturnType<typeof LLMFactory.getProvider>,
    model: ModelProfile,
    prompt: string,
    dims: number,
  ): Promise<{ success: boolean; content: string; error?: string; usage?: { totalTokens: number } }> {
    // 强力 JSON 约束 system prompt（尝试 2 时使用）
    const STRICT_JSON_SYSTEM = [
      '你是一个文本向量化引擎。',
      '【重要】你必须只输出一个 JSON 对象，格式为 {"vector":[0.1,-0.2,...]}。',
      '不要输出任何解释、说明、代码块标记（```）或额外文字。',
      '只输出纯 JSON。',
    ].join(' ')

    // ==== 尝试 1：response_format json_object ====
    try {
      const res1 = await provider.generate(model, [
        { role: 'system', content: '你是一个文本向量化引擎。只输出纯 JSON，不要任何额外文字。' },
        { role: 'user', content: prompt },
      ], {
        temperature: 0,
        maxTokens: Math.max(4096, dims * 6),
        responseFormat: { type: 'json_object' },
      })

      if (res1.success && res1.content?.trim()) {
        return { success: true, content: res1.content, usage: res1.usage }
      }

      // JSON 模式失败，记录原因
      console.debug('[EmbeddingService] JSON 模式失败:', res1.error || '空响应', '→ 尝试纯文本模式')
    } catch {
      // provider.generate 抛出异常（如 API 不可达），继续尝试 2
    }

    // ==== 尝试 2：纯文本模式（兼容所有 API） ====
    // 在 prompt 中加强 JSON 输出指令，不依赖 response_format
    const fallbackPrompt = [
      prompt,
      '',
      '【输出格式要求 — 严格遵守】',
      '1. 你只能输出一个 JSON 对象：{"vector": [数字数组]}',
      `2. 数组长度必须恰好为 ${dims}`,
      '3. 每个数字在 -1.0 到 1.0 之间，保留 4 位小数',
      '4. 不要用 ``` 包裹，不要加任何解释',
      '5. 你的整个回复必须是一个可被 JSON.parse 解析的对象',
    ].join('\n')

    const res2 = await provider.generate(model, [
      { role: 'system', content: STRICT_JSON_SYSTEM },
      { role: 'user', content: fallbackPrompt },
    ], {
      temperature: 0,
      maxTokens: Math.max(4096, dims * 6),
      // 不传 responseFormat — 纯文本兼容模式
    })

    if (!res2.success || !res2.content?.trim()) {
      return { success: false, content: '', error: `两次尝试均失败: ①JSON模式=${res2.error || 'N/A'} ②纯文本=${res2.error || '空响应'}` }
    }

    return { success: true, content: res2.content, usage: res2.usage }
  }

  /**
   * 解析 LLM 返回的向量文本
   *
   * 支持多种 LLM 输出格式：
   * 1. {"vector": [0.1, -0.2, ...]}  — JSON 对象（json_object 模式）
   * 2. [0.1, -0.2, ...]              — 纯数组
   * 3. 混在文字中的数组或数字
   */
  private parseLLMVector(rawContent: string, expectedDims: number): number[] {
    // 策略0：尝试完整 JSON 解析（json_object 模式返回的是对象）
    try {
      const parsed = JSON.parse(rawContent.trim())
      if (parsed && typeof parsed === 'object') {
        // 提取 vector 字段
        if (Array.isArray(parsed.vector)) {
          const nums = (parsed.vector as unknown[]).map(Number).filter((n: number) => !isNaN(n))
          if (nums.length >= expectedDims * 0.8) {
            return this.normalizeVector(nums, expectedDims)
          }
        }
        if (Array.isArray(parsed.embedding)) {
          const nums = (parsed.embedding as unknown[]).map(Number).filter((n: number) => !isNaN(n))
          if (nums.length >= expectedDims * 0.8) {
            return this.normalizeVector(nums, expectedDims)
          }
        }
        // 检查是否是数组本身
        if (Array.isArray(parsed)) {
          const nums = parsed.map(Number).filter(n => !isNaN(n))
          if (nums.length >= expectedDims * 0.8) {
            return this.normalizeVector(nums, expectedDims)
          }
        }
        // 查找对象中任何数组字段
        for (const val of Object.values(parsed)) {
          if (Array.isArray(val) && val.length >= expectedDims * 0.8) {
            const nums = (val as unknown[]).map(Number).filter((n: number) => !isNaN(n))
            return this.normalizeVector(nums, expectedDims)
          }
        }
      }
    } catch {
      // 不是有效 JSON，使用正则提取
    }

    // 策略1：提取 JSON 数组
    const arrayMatch = rawContent.match(/\[([\d\-.,\seE+]+)\]/)
    if (arrayMatch) {
      const nums = arrayMatch[1]
        .split(',')
        .map(s => parseFloat(s.trim()))
        .filter(n => !isNaN(n))
      if (nums.length >= expectedDims * 0.8) {
        return this.normalizeVector(nums, expectedDims)
      }
    }

    // 策略2：提取所有数字
    const allNums = rawContent
      .split(/[,\s\n\[\]{}"]+/)
      .map(s => parseFloat(s.trim()))
      .filter(n => !isNaN(n))
    if (allNums.length >= expectedDims * 0.8) {
      return this.normalizeVector(allNums, expectedDims)
    }

    // 策略3：失败，抛出明确错误
    const preview = rawContent.slice(0, 300).replace(/\n/g, ' ')
    throw new Error(
      `无法从 LLM 响应中提取有效向量。期望 ${expectedDims} 维，` +
      `响应预览: "${preview}${rawContent.length > 300 ? '...' : ''}"`
    )
  }

  /**
   * 向量归一化：截断/填充到目标维度 + L2 归一化
   */
  private normalizeVector(raw: number[], targetDims: number): number[] {
    let vec = raw.slice(0, targetDims)
    // 不足则补零
    while (vec.length < targetDims) vec.push(0)
    // L2 归一化
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
    if (magnitude > 0) {
      vec = vec.map(v => v / magnitude)
    }
    // 裁剪到 [-1, 1]
    vec = vec.map(v => Math.max(-1, Math.min(1, v)))
    return vec
  }

  /**
   * 单文本嵌入
   *
   * 优先级：Embedding API > LLM 向量化 > 报错
   */
  async embed(text: string, options?: { skipCache?: boolean }): Promise<EmbeddingResult> {
    const hash = this.hashText(text)

    // 检查缓存
    if (!options?.skipCache) {
      const cached = this.cache.get(hash)
      if (cached) {
        this.cacheHits++
        return { vector: cached, text, tokens: 0, source: 'embedding_api' }
      }
    }

    this.cacheMisses++

    // 策略1：优先使用专用 Embedding API
    if (this.canUseEmbeddingAPI()) {
      const model = {
        id: this.config!.modelId,
        name: this.config!.modelName,
        modelName: this.config!.modelName,
        baseUrl: this.config!.baseUrl,
        apiKey: this.config!.apiKey,
        protocol: this.config!.protocol,
        temperature: 0,
        maxTokens: 0,
        provider: '' as string,
        purposes: [] as string[],
      } as ModelProfile

      try {
        const vectors = await generateEmbeddings([text], this.config!.protocol, model)
        const vector = vectors[0] || []
        this.cache.set(hash, vector)
        const tokens = Math.ceil(text.length * 0.75)
        return { vector, text, tokens, source: 'embedding_api' }
      } catch (error) {
        console.warn('[EmbeddingService] Embedding API 失败，尝试 LLM 向量化:', String(error))
        // 降级到 LLM 向量化
      }
    }

    // 策略2：LLM 向量化
    if (this.canUseLLMEmbedding()) {
      const result = await this.embedWithLLM(text)
      this.cache.set(hash, result.vector)
      return result
    }

    throw new Error('EmbeddingService: 无可用的嵌入方式（专用 API 和 LLM 向量化均未配置）')
  }

  /**
   * 批量文本嵌入
   */
  async embedBatch(
    texts: string[],
    options?: {
      skipCache?: boolean
      onProgress?: (done: number, total: number) => void
    },
  ): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return []
    if (!this.config) throw new Error('EmbeddingService 未配置模型')

    const results: EmbeddingResult[] = []
    const uncached: Array<{ text: string; index: number }> = []

    // 分离缓存命中/未命中
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]
      if (!options?.skipCache) {
        const hash = this.hashText(text)
        const cached = this.cache.get(hash)
        if (cached) {
          this.cacheHits++
          results[i] = { vector: cached, text, tokens: 0, source: 'embedding_api' as const }
          continue
        }
      }
      this.cacheMisses++
      uncached.push({ text, index: i })
    }

    // 批量嵌入未缓存的文本
    if (uncached.length > 0) {
      const model = {
        id: this.config.modelId,
        name: this.config.modelName,
        modelName: this.config.modelName,
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey,
        protocol: this.config.protocol,
        temperature: 0,
        maxTokens: 0,
        provider: '' as string,
        purposes: [] as string[],
      } as ModelProfile

      const batchSize = this.config.protocol === 'gemini' ? 100 : 50
      const totalBatches = Math.ceil(uncached.length / batchSize)

      for (let b = 0; b < uncached.length; b += batchSize) {
        const batch = uncached.slice(b, b + batchSize)
        const batchTexts = batch.map((item) => item.text)

        const vectors = await generateEmbeddings(batchTexts, this.config.protocol, model)

        for (let j = 0; j < batch.length; j++) {
          const { text, index } = batch[j]
          const vector = vectors[j] || []
          const tokens = Math.ceil(text.length * 0.75)

          // 存入缓存
          const hash = this.hashText(text)
          this.cache.set(hash, vector)

          results[index] = { vector, text, tokens, source: 'embedding_api' as const }
        }

        const batchNum = Math.floor(b / batchSize) + 1
        options?.onProgress?.(
          batchNum,
          totalBatches,
        )
      }
    }

    // 确保结果按原始顺序排列
    return texts.map((_, i) => results[i] || { vector: [], text: texts[i], tokens: 0, source: 'embedding_api' as const })
  }

  /** 获取缓存统计 */
  getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses
    return {
      size: this.cache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
    }
  }

  /** 清空缓存 */
  clearCache(): void {
    this.cache.clear()
    this.cacheHits = 0
    this.cacheMisses = 0
  }

  /** 简单文本哈希 */
  private hashText(text: string): string {
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash |= 0 // 转换为 32 位整数
    }
    return `${hash}_${text.length}`
  }
}

/** 全局单例嵌入服务 */
export const embeddingService = new EmbeddingService()
