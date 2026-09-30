/**
 * Embedding Controller — 向量嵌入 IPC 处理器
 *
 * 暴露嵌入服务的功能给渲染进程。
 */

import { embeddingService, type EmbeddingConfig, type LLMEmbeddingConfig } from '../embedding-service'
import { cosineSimilarity, findMostSimilar } from '../utils/vector-utils'
import { readJsonFile, MODELS_CONFIG_PATH } from '../utils/config-utils'
import { resolveModelKey, stripApiKey } from '../credentials/resolve'
import { safeErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'
import { t } from '../../src/shared/locale'
import type { ModelProfile } from '../../src/shared/ipc-channels'
import type { ResolvedModelProfile } from '../llm/provider.interface'
import { guardedHandle } from '../security/ipc-guard'

/**
 * 从全局配置加载嵌入模型配置 —— **此处才解析密钥**（返回 `ResolvedModelProfile`）。
 *
 * 与 `getLLMModels()` 的分工是刻意的：这个值直接进 `embeddingService` 的请求路径，
 * 必须带密钥；而列表通道的值要回渲染层，必须不带。
 */
function loadEmbeddingModelConfig(): ResolvedModelProfile | null {
  try {
    const models = readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, [])
    const model = models.find((m) => m.purposes?.includes('embedding')) || null
    return model ? { ...model, apiKey: resolveModelKey(model) } : null
  } catch {
    return null
  }
}

/**
 * 获取 LLM model configs 文件（**不含密钥**）。
 *
 * 返回值有两个去处，都不该带密钥：`embedding:list-models` / `embedding:list-llm-candidates`
 * 回渲染层（后者还会被原样回传回来配置服务）—— 请求侧要用的密钥由 `embedding-service`
 * 在**发起调用前**按 `apiKeyRef` 现场解析（见 `embedWithLLM`），配置对象因此不必携带它。
 */
function getLLMModels(): ModelProfile[] {
  try {
    return readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, [])
  } catch {
    return []
  }
}

export function registerEmbeddingController() {
  // 自动配置嵌入服务
  try {
    const embedModel = loadEmbeddingModelConfig()
    if (embedModel) {
      embeddingService.configureFromModel(embedModel)
    }
  } catch { /* 忽略 */ }

  // 单文本嵌入
  guardedHandle('embedding:generate', async (_event, text: string) => {
    try {
      const result = await embeddingService.embed(text)
      return {
        success: true,
        vector: result.vector,
        tokens: result.tokens,
      }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // 批量嵌入
  guardedHandle('embedding:generate-batch', async (_event, texts: string[]) => {
    try {
      const results = await embeddingService.embedBatch(texts)
      return {
        success: true,
        vectors: results.map((r) => r.vector),
        tokens: results.reduce((sum, r) => sum + r.tokens, 0),
      }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // 文本相似度比较
  guardedHandle(
    'embedding:compare',
    async (_event, query: string, candidates: string[]) => {
      try {
        const queryResult = await embeddingService.embed(query)
        const candidateResults = await embeddingService.embedBatch(candidates)

        const similarities = candidateResults
          .map((cr, idx) => ({
            text: candidates[idx],
            score: cosineSimilarity(queryResult.vector, cr.vector),
          }))
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)

        return { success: true, similarities }
      } catch (error) {
        return { success: false, error: safeErrorMessage(error) }
      }
    },
  )

  // 查找最相似的候选项
  guardedHandle(
    'embedding:similarity-search',
    async (
      _event,
      queryVector: number[],
      candidates: Array<{ vector: number[]; metadata: unknown }>,
      topK: number,
      threshold?: number,
    ) => {
      try {
        const results = findMostSimilar(queryVector, candidates, topK, threshold)
        return { success: true, results }
      } catch (error) {
        return { success: false, error: safeErrorMessage(error) }
      }
    },
  )

  // 获取嵌入模型配置（**出站剥离**：服务内部那份带 apiKey，回渲染层的一律不带）
  guardedHandle('embedding:get-model', async () => {
    const config = embeddingService.getConfig()
    if (!config) return null
    // 显式投影而不是整包透传：字段集由这里唯一决定（将来给 EmbeddingConfig 加字段也不会自动外泄）
    return {
      modelId: config.modelId,
      protocol: config.protocol,
      modelName: config.modelName,
      baseUrl: config.baseUrl,
      dimensions: config.dimensions,
    }
  })

  // 设置嵌入模型
  guardedHandle('embedding:set-model', async (_event, config: EmbeddingConfig) => {
    try {
      embeddingService.configure(config)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // 可用嵌入模型列表（出站剥离：条目上可能残留的密钥字段一律删掉再回渲染层，v3 §4.7）
  guardedHandle('embedding:list-models', async () => {
    return getLLMModels().filter((m) => m.purposes?.includes('embedding')).map(stripApiKey)
  })

  // 缓存统计
  guardedHandle('embedding:cache-stats', async () => {
    return embeddingService.getCacheStats()
  })

  // 清空缓存
  guardedHandle('embedding:clear-cache', async () => {
    embeddingService.clearCache()
    return { success: true }
  })

  // 去重缓存统计
  guardedHandle('embedding:dedup-stats', async () => {
    return embeddingService.getDedupCacheStats()
  })

  // 清空去重缓存
  guardedHandle('embedding:clear-dedup', async () => {
    embeddingService.clearDedupCache()
    return { success: true }
  })

  // ===== LLM 向量化 =====

  // 获取 LLM 向量化配置（出站剥离：返回值里有整个 ModelProfile —— 迁移残留的密钥字段不回渲染层）
  guardedHandle('embedding:get-llm-config', async () => {
    const config = embeddingService.getLLMEmbeddingConfig()
    // ⚠️ 必须先**拷贝**再剥：`model` 与服务内部 `llmConfig.model` 是同一个对象引用，
    //    就地 delete 会把服务自己那份配置也改掉（下次请求密钥就没了）
    return { ...config, model: config.model ? stripApiKey({ ...config.model }) : null }
  })

  // 设置 LLM 向量化配置
  guardedHandle('embedding:set-llm-config', async (_event, config: Partial<LLMEmbeddingConfig>) => {
    try {
      embeddingService.configureLLMEmbedding(config)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // 测试 LLM 向量化
  guardedHandle('embedding:test-llm', async (_event, text: string) => {
    try {
      const result = await embeddingService.embedWithLLM(text || '测试文本')
      return {
        success: true,
        vector: result.vector.slice(0, 10), // 只返回前 10 维预览
        dimensions: result.vector.length,
        tokens: result.tokens,
      }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // 通过 LLM 批量生成向量
  guardedHandle('embedding:generate-with-llm', async (_event, texts: string[]) => {
    try {
      const results = await embeddingService.embedBatchWithLLM(texts)
      return {
        success: true,
        vectors: results.map(r => r.vector),
        tokens: results.reduce((sum, r) => sum + r.tokens, 0),
      }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // 获取可用作向量的 LLM 模型列表（从 models.json 中筛选）
  guardedHandle('embedding:list-llm-candidates', async () => {
    // 排除已经是 embedding 用途的模型；出站剥离同 embedding:list-models
    // （这条的值会被渲染层原样回传回 set-llm-config —— 密钥由服务侧现场解析，不经渲染层）
    return getLLMModels().filter(m => !m.purposes?.includes('embedding')).map(stripApiKey)
  })

  logger.info('Embedding', t('log.ipc.handlersRegistered'))
}
