/**
 * Embedding Controller — 向量嵌入 IPC 处理器
 *
 * 暴露嵌入服务的功能给渲染进程。
 */

import { ipcMain } from 'electron'
import { embeddingService, type EmbeddingConfig, type LLMEmbeddingConfig } from '../embedding-service'
import { cosineSimilarity, findMostSimilar } from '../utils/vector-utils'
import { readJsonFile, GLOBAL_CONFIG_PATH } from '../utils/config-utils'
import type { ModelProfile } from '../../src/shared/ipc-channels'

/** 从全局配置加载嵌入模型配置 */
function loadEmbeddingModelConfig(): ModelProfile | null {
  try {
    const config = readJsonFile<{ models?: ModelProfile[] }>(
      GLOBAL_CONFIG_PATH.replace('config.json', 'models.json'),
      { models: [] },
    )
    const models = config.models || []
    return models.find((m) => m.purposes?.includes('embedding')) || null
  } catch {
    return null
  }
}

/** 获取 LLM model configs 文件 */
function getLLMModels(): ModelProfile[] {
  try {
    const MODELS_CONFIG_PATH = GLOBAL_CONFIG_PATH.replace('config.json', 'models.json')
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
  ipcMain.handle('embedding:generate', async (_event, text: string) => {
    try {
      const result = await embeddingService.embed(text)
      return {
        success: true,
        vector: result.vector,
        tokens: result.tokens,
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 批量嵌入
  ipcMain.handle('embedding:generate-batch', async (_event, texts: string[]) => {
    try {
      const results = await embeddingService.embedBatch(texts)
      return {
        success: true,
        vectors: results.map((r) => r.vector),
        tokens: results.reduce((sum, r) => sum + r.tokens, 0),
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 文本相似度比较
  ipcMain.handle(
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
        return { success: false, error: String(error) }
      }
    },
  )

  // 查找最相似的候选项
  ipcMain.handle(
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
        return { success: false, error: String(error) }
      }
    },
  )

  // 获取嵌入模型配置
  ipcMain.handle('embedding:get-model', async () => {
    return embeddingService.getConfig()
  })

  // 设置嵌入模型
  ipcMain.handle('embedding:set-model', async (_event, config: EmbeddingConfig) => {
    try {
      embeddingService.configure(config)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 可用嵌入模型列表
  ipcMain.handle('embedding:list-models', async () => {
    const models = getLLMModels()
    return models.filter((m) => m.purposes?.includes('embedding'))
  })

  // 缓存统计
  ipcMain.handle('embedding:cache-stats', async () => {
    return embeddingService.getCacheStats()
  })

  // 清空缓存
  ipcMain.handle('embedding:clear-cache', async () => {
    embeddingService.clearCache()
    return { success: true }
  })

  // 去重缓存统计
  ipcMain.handle('embedding:dedup-stats', async () => {
    return embeddingService.getDedupCacheStats()
  })

  // 清空去重缓存
  ipcMain.handle('embedding:clear-dedup', async () => {
    embeddingService.clearDedupCache()
    return { success: true }
  })

  // ===== LLM 向量化 =====

  // 获取 LLM 向量化配置
  ipcMain.handle('embedding:get-llm-config', async () => {
    return embeddingService.getLLMEmbeddingConfig()
  })

  // 设置 LLM 向量化配置
  ipcMain.handle('embedding:set-llm-config', async (_event, config: Partial<LLMEmbeddingConfig>) => {
    try {
      embeddingService.configureLLMEmbedding(config)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 测试 LLM 向量化
  ipcMain.handle('embedding:test-llm', async (_event, text: string) => {
    try {
      const result = await embeddingService.embedWithLLM(text || '测试文本')
      return {
        success: true,
        vector: result.vector.slice(0, 10), // 只返回前 10 维预览
        dimensions: result.vector.length,
        tokens: result.tokens,
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 通过 LLM 批量生成向量
  ipcMain.handle('embedding:generate-with-llm', async (_event, texts: string[]) => {
    try {
      const results = await embeddingService.embedBatchWithLLM(texts)
      return {
        success: true,
        vectors: results.map(r => r.vector),
        tokens: results.reduce((sum, r) => sum + r.tokens, 0),
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 获取可用作向量的 LLM 模型列表（从 models.json 中筛选）
  ipcMain.handle('embedding:list-llm-candidates', async () => {
    const models = getLLMModels()
    // 排除已经是 embedding 用途的模型
    return models.filter(m => !m.purposes?.includes('embedding'))
  })

  console.log('[EmbeddingController] 已注册 IPC 处理器')
}
