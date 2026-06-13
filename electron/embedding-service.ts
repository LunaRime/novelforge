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

// ===== 类型定义 =====

export interface EmbeddingConfig {
  modelId: string
  protocol: 'openai' | 'gemini'
  modelName: string
  baseUrl: string
  apiKey: string
  dimensions: number
}

export interface EmbeddingResult {
  vector: number[]
  text: string
  tokens: number
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

export class EmbeddingService {
  private config: EmbeddingConfig | null = null
  private cache = new LRUCache<string, number[]>(10_000)
  private cacheHits = 0
  private cacheMisses = 0

  /** 配置嵌入服务 */
  configure(config: EmbeddingConfig): void {
    this.config = config
    console.log(`[EmbeddingService] 已配置: ${config.modelName} (${config.protocol}, ${config.dimensions}d)`)
  }

  /** 获取当前配置 */
  getConfig(): EmbeddingConfig | null {
    return this.config
  }

  /** 从 ModelProfile 配置 */
  configureFromModel(model: ModelProfile): void {
    this.configure({
      modelId: model.id,
      protocol: model.protocol as 'openai' | 'gemini',
      modelName: model.modelName || 'text-embedding-3-small',
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      dimensions: 1536, // OpenAI text-embedding-3-small 默认维度
    })
  }

  /**
   * 单文本嵌入
   */
  async embed(text: string, options?: { skipCache?: boolean }): Promise<EmbeddingResult> {
    const hash = this.hashText(text)

    // 检查缓存
    if (!options?.skipCache) {
      const cached = this.cache.get(hash)
      if (cached) {
        this.cacheHits++
        return { vector: cached, text, tokens: 0 }
      }
    }

    this.cacheMisses++

    if (!this.config) {
      throw new Error('EmbeddingService 未配置模型')
    }

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

    const vectors = await generateEmbeddings([text], this.config.protocol, model)
    const vector = vectors[0] || []

    // 存入缓存
    this.cache.set(hash, vector)

    // 估算 Token 数（粗略：1 token ≈ 0.75 中文字符）
    const tokens = Math.ceil(text.length * 0.75)

    return { vector, text, tokens }
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
          results[i] = { vector: cached, text, tokens: 0 }
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

          results[index] = { vector, text, tokens }
        }

        const batchNum = Math.floor(b / batchSize) + 1
        options?.onProgress?.(
          batchNum,
          totalBatches,
        )
      }
    }

    // 确保结果按原始顺序排列
    return texts.map((_, i) => results[i] || { vector: [], text: texts[i], tokens: 0 })
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
