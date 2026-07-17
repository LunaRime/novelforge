import { ipcMain, dialog } from 'electron'
import fs from 'node:fs'
import {
  importDocument, importFolder, importText, searchKnowledge, searchKnowledgeFTS,
  listDocuments, removeDocument, getKnowledgeStats,
  getVectorlessCount, backfillVectors,
} from '../knowledge-base'
import { readJsonFile, GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG, MODELS_CONFIG_PATH, RECENT_PROJECTS_PATH } from '../utils/config-utils'
import { decryptApiKey } from '../utils/secure-config'
import { logger } from '../utils/logger'
import { GlobalConfig, ModelProfile } from '../../src/shared/ipc-channels'
import { embeddingService } from '../embedding-service'

function getEmbeddingConfig(): { protocol: 'openai' | 'gemini'; model: { baseUrl: string; apiKey: string; modelName: string } } | null {
  const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
  const targetModelId = config.defaultEmbeddingModelId || config.defaultModelId
  if (!targetModelId) return null

  const models = readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, [])
  const model = models.find((m) => m.id === targetModelId)
  if (!model) return null
  return {
    protocol: model.protocol as 'openai' | 'gemini',
    model: {
      baseUrl: model.baseUrl,
      apiKey: decryptApiKey(model.apiKey),
      modelName: model.modelName,
    },
  }
}

function getCurrentProjectPath(): string | null {
  try {
    const recent = JSON.parse(fs.readFileSync(RECENT_PROJECTS_PATH, 'utf-8')) as Array<{ path: string }>
    return recent[0]?.path ?? null
  } catch { return null }
}

export function registerKBController() {
  ipcMain.handle('kb:import-document', async (_event, filePath: string) => {
    const embConfig = getEmbeddingConfig()
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, error: '未打开项目' }
    const protocol = embConfig?.protocol ?? 'openai'
    const model = embConfig?.model ?? { baseUrl: '', apiKey: '' }
    return importDocument(filePath, projectPath, protocol, model)
  })

  ipcMain.handle('kb:import-folder', async (_event, folderPath: string) => {
    const embConfig = getEmbeddingConfig()
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, error: '未打开项目' }
    const protocol = embConfig?.protocol ?? 'openai'
    const model = embConfig?.model ?? { baseUrl: '', apiKey: '' }
    return importFolder(folderPath, projectPath, protocol, model)
  })

  ipcMain.handle('kb:import-text', async (_event, text: string, fileName: string, projectPath: string) => {
    const embConfig = getEmbeddingConfig()
    const protocol = embConfig?.protocol ?? 'openai'
    const model = embConfig?.model ?? { baseUrl: '', apiKey: '' }
    return importText(text, fileName, projectPath, protocol, model)
  })

  ipcMain.handle('kb:search', async (_event, query: string, topK?: number) => {
    const embConfig = getEmbeddingConfig()
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return []

    if (embConfig) {
      return searchKnowledge(query, projectPath, embConfig.protocol, embConfig.model, topK ?? 5)
    }
    return searchKnowledgeFTS(query, projectPath, topK ?? 5)
  })

  ipcMain.handle('kb:search-with-scope', async (_event, query: string, fromChapter: number, toChapter: number, topK?: number) => {
    const embConfig = getEmbeddingConfig()
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return []

    const scope: [number, number] = [fromChapter, toChapter]
    if (embConfig) {
      return searchKnowledge(query, projectPath, embConfig.protocol, embConfig.model, topK ?? 5, scope)
    }
    return searchKnowledgeFTS(query, projectPath, topK ?? 5, scope)
  })

  ipcMain.handle('kb:list-documents', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return []
    return listDocuments(projectPath)
  })

  ipcMain.handle('kb:remove-document', async (_event, docId: string) => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false }
    return { success: removeDocument(docId, projectPath) }
  })

  ipcMain.handle('kb:stats', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { documentCount: 0, totalChunks: 0, vectorDimension: 0 }
    return getKnowledgeStats(projectPath)
  })

  ipcMain.handle('kb:get-vectorless-count', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { count: 0 }
    return getVectorlessCount(projectPath)
  })

  ipcMain.handle('kb:backfill-vectors', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, processed: 0, failed: 0, error: '未打开项目' }

    // 判断可用的向量化方式
    const embConfig = getEmbeddingConfig()
    const canUseEmbeddingAPI = embConfig !== null
    const canUseLLM = embeddingService.canUseLLMEmbedding()

    // 方式 1：专用 Embedding API（内部已含 LLM 降级，失败会自动切换）
    if (canUseEmbeddingAPI) {
      logger.info('KB', '使用 Embedding API 重建向量索引（如失败将自动降级到 LLM 向量化）')
      const result = await backfillVectors(projectPath, embConfig!.protocol, embConfig!.model)
      // 如果 processed > 0 说明至少部分成功了
      if (result.success || result.processed > 0) return result
      // 完全失败 → 降级到 LLM 向量化
      logger.warn('KB', `Embedding API 完全失败，尝试 LLM 向量化: ${result.error}`)
    }

    // 方式 2：LLM 向量化
    if (canUseLLM) {
      logger.info('KB', '使用 LLM 向量化重建向量索引')
      try {
        const { count } = await getVectorlessCount(projectPath)
        if (count === 0) return { success: true, processed: 0, failed: 0 }

        // 获取所有无向量的文本块
        const { getConnection } = await import('../vector-store')
        const db = await getConnection(projectPath)
        const table = await db.openTable('chunks')
        const rows = await table.query().select(['id', 'text']).toArray()
        const vectorless = rows.filter((r: { vector?: unknown }) => !r.vector || !Array.isArray(r.vector) || (r.vector as unknown[]).length === 0)

        if (vectorless.length === 0) return { success: true, processed: 0, failed: 0 }

        // 批量 LLM 向量化（自动去重合并）
        const texts = vectorless.map((r: { text: string }) => r.text)
        const results = await embeddingService.embedBatchWithLLM(texts)

        // 写入向量
        let processed = 0
        let failed = 0
        if (results.length > 0) {
          try {
            const { getConnection: getConn } = await import('../vector-store')
            const db2 = await getConn(projectPath)
            const fullTable = await db2.openTable('chunks')
            const allRows = await fullTable.query().toArray()

            const idToVector = new Map<string, number[]>()
            vectorless.forEach((r: { id: string }, i: number) => {
              if (results[i] && results[i].vector.length > 0) {
                idToVector.set(r.id, results[i].vector)
                processed++
              } else {
                failed++
              }
            })

            if (processed > 0) {
              const updatedRows = allRows.map((r: { [key: string]: unknown }) => {
                const v = idToVector.get(r.id as string)
                return v ? { ...r, vector: v } : r
              })
              await db2.dropTable('chunks')
              await db2.createTable('chunks', updatedRows)
            }
          } catch (e) {
            failed = vectorless.length
            return { success: false, processed: 0, failed, error: `LLM 向量写入失败: ${String(e)}` }
          }
        }

        return { success: true, processed, failed }
      } catch (error) {
        logger.warn('KB', `LLM 向量化回填失败: ${error}`)
      }
    }

    // 方式 3：全部不可用 — 标记为 FTS 模式
    logger.info('KB', '无可用的向量化方式，文本块将保持 FTS 纯文本模式')
    const { count } = await getVectorlessCount(projectPath)
    return {
      success: false,
      processed: 0,
      failed: count,
      error:
        '无可用的向量化方式。请至少配置以下其一：\n' +
        '1. 在「设置 → 向量模型」中添加 Embedding 模型（如 text-embedding-3-small）\n' +
        '2. 在「设置 → 向量模型」中开启 LLM 向量化并选择模型\n' +
        '向量模块（本地 FTS 全文搜索）仍可用于搜索，但无法生成语义向量。',
    }
  })

  ipcMain.handle('dialog:select-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: '选择要导入的文档',
      filters: [{ name: '文本文件', extensions: ['txt', 'md', 'markdown'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  ipcMain.handle('dialog:select-import-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择要批量导入的文件夹',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
