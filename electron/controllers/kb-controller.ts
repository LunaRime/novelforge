import { dialog } from 'electron'
import { t } from '../../src/shared/locale'
import fs from 'node:fs'
import {
  importDocument, importFolder, importText, searchKnowledge, searchKnowledgeFTS,
  listDocuments, removeDocument, getKnowledgeStats,
  getVectorlessCount, backfillVectors, backfillTokens,
} from '../knowledge-base'
import { readJsonFile, GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG, MODELS_CONFIG_PATH, RECENT_PROJECTS_PATH, readLocalEmbeddingConfig } from '../utils/config-utils'
import { getProjectDb } from '../database'
import { decryptApiKey } from '../utils/secure-config'
import { logger } from '../utils/logger'
import { safeErrorMessage } from '../utils/error-utils'
import { GlobalConfig, ModelProfile } from '../../src/shared/ipc-channels'
import { embeddingService } from '../embedding-service'
import { guardedHandle } from '../security/ipc-guard'
// L4 S8：对话框结果由主进程直接签发授权（取代渲染层自行调用的 fs:grant-external-file）
import { grantDirectory, grantExternalFile } from './fs-controller'

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
  // 必须存在已打开的项目数据库（否则 KB 操作会错误写入「最近项目」而非当前项目）
  if (!getProjectDb()) return null
  try {
    const recent = JSON.parse(fs.readFileSync(RECENT_PROJECTS_PATH, 'utf-8')) as Array<{ path: string }>
    return recent[0]?.path ?? null
  } catch { return null }
}

/**
 * 查询 handler（`kb:search` / `kb:search-with-scope`）的向量化参数（T3b R1 / I1）。
 *
 * - **有远端 Embedding 模型** → 原样沿用（对象与 `getEmbeddingConfig()` 返回的是同一个，含
 *   `modelName`），既有路径逐字不变；
 * - **无远端模型但 `localEmbedding.enabled`** → 按 `kb:import-*` / `kb:backfill-vectors` 既有约定
 *   给空远端配置（`protocol: 'openai'` + 空 `model`）：查询向量由 `knowledge-base` 内部的降级链
 *   **local 档**产出，api 档拿到空配置即失败降级（不会误发请求）；
 * - 两者皆无 → `null` → 调用方落 FTS-only 入口（`searchKnowledgeFTS`，恒无查询向量）。
 *
 * ⚠️ 为什么必须有这一层：`getEmbeddingConfig()` 在无远端 Embedding 模型时返回 `null`，改造前
 *    handler 据此直接落 `searchKnowledgeFTS` —— 「纯本地用户」在检索侧根本走不到 `searchKnowledge`，
 *    T3b 在模块层接好的降级链对真实用户不可达（与 T4/A4.2 修好的**回填侧**门控是同一类缺陷）。
 *
 * ⚠️ 本地档只作为**追加**放行条件：`embConfig` 存在时连配置都不读，有远端配置的既有路径零影响。
 */
function getQueryEmbeddingArgs(): { protocol: 'openai' | 'gemini'; model: { baseUrl: string; apiKey: string } } | null {
  const embConfig = getEmbeddingConfig()
  if (embConfig) return { protocol: embConfig.protocol, model: embConfig.model }
  if (readLocalEmbeddingConfig().enabled) return { protocol: 'openai', model: { baseUrl: '', apiKey: '' } }
  return null
}

export function registerKBController() {
  guardedHandle('kb:import-document', async (_event, filePath: string) => {
    const embConfig = getEmbeddingConfig()
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, error: t('error.noProject') }
    const protocol = embConfig?.protocol ?? 'openai'
    const model = embConfig?.model ?? { baseUrl: '', apiKey: '' }
    return importDocument(filePath, projectPath, protocol, model)
  })

  guardedHandle('kb:import-folder', async (_event, folderPath: string) => {
    const embConfig = getEmbeddingConfig()
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, error: t('error.noProject') }
    const protocol = embConfig?.protocol ?? 'openai'
    const model = embConfig?.model ?? { baseUrl: '', apiKey: '' }
    return importFolder(folderPath, projectPath, protocol, model)
  })

  guardedHandle('kb:import-text', async (_event, text: string, fileName: string, projectPath: string) => {
    const embConfig = getEmbeddingConfig()
    const protocol = embConfig?.protocol ?? 'openai'
    const model = embConfig?.model ?? { baseUrl: '', apiKey: '' }
    return importText(text, fileName, projectPath, protocol, model)
  })

  guardedHandle('kb:search', async (_event, query: string, topK?: number) => {
    const emb = getQueryEmbeddingArgs()
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return []

    if (emb) {
      return searchKnowledge(query, projectPath, emb.protocol, emb.model, topK ?? 5)
    }
    return searchKnowledgeFTS(query, projectPath, topK ?? 5)
  })

  guardedHandle('kb:search-with-scope', async (_event, query: string, fromChapter: number, toChapter: number, topK?: number) => {
    const emb = getQueryEmbeddingArgs()
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return []

    const scope: [number, number] = [fromChapter, toChapter]
    if (emb) {
      return searchKnowledge(query, projectPath, emb.protocol, emb.model, topK ?? 5, scope)
    }
    return searchKnowledgeFTS(query, projectPath, topK ?? 5, scope)
  })

  guardedHandle('kb:list-documents', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return []
    return listDocuments(projectPath)
  })

  guardedHandle('kb:remove-document', async (_event, docId: string) => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false }
    return { success: removeDocument(docId, projectPath) }
  })

  guardedHandle('kb:stats', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { documentCount: 0, totalChunks: 0, vectorDimension: 0 }
    return getKnowledgeStats(projectPath)
  })

  guardedHandle('kb:get-vectorless-count', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { count: 0 }
    return getVectorlessCount(projectPath)
  })

  guardedHandle('kb:backfill-vectors', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, processed: 0, failed: 0, error: t('error.noProject') }

    // 判断可用的向量化方式
    const embConfig = getEmbeddingConfig()
    const canUseEmbeddingAPI = embConfig !== null
    const canUseLLM = embeddingService.canUseLLMEmbedding()
    // T4/A4.2：本地档开启时即使没有远端 API 模型也要进方式 1 —— T3 的 backfillVectors 内部
    // 已按 resolveEmbeddingOrder 处理档位顺序（local → api → llm → fts），此处不重算顺序。
    const localCfg = readLocalEmbeddingConfig()
    const canUseLocal = localCfg.enabled

    // 方式 1：专用 Embedding API / 本地 Ollama（内部已含 LLM 降级，失败会自动切换）
    if (canUseLocal || canUseEmbeddingAPI) {
      logger.info('KB', canUseLocal ? t('log.kb.rebuildWithLocalOrApi') : t('log.kb.rebuildWithEmbeddingApi'))
      // 远端参数仅 api 档使用（本地档内部自读 readLocalEmbeddingConfig）；无 API 配置时沿用
      // kb:import-* 既有约定（protocol='openai' + 空 model → 该档失败即降级，不误发请求）
      const protocol = embConfig?.protocol ?? 'openai'
      const model = embConfig?.model ?? { baseUrl: '', apiKey: '' }
      const result = await backfillVectors(projectPath, protocol, model)
      // T4/A4.2：维度不匹配是**终态** —— 原样透传，绝不降级到方式 2
      // （方式 2 的 updateChunkVectors 写入路径遇到混维会静默破坏数据；改造前这里被当成
      //  「换下一种方式」的信号 → 模块层的硬拒绝在 controller 层被静默降级了）
      if (result.errorCode === 'dim-mismatch') return result
      // 如果 processed > 0 说明至少部分成功了
      if (result.success || result.processed > 0) return result
      // 完全失败 → 降级到 LLM 向量化
      logger.warn('KB', t('log.kb.embeddingFailedTryLlm').replace('{err}', String(result.error)))
    }

    // 方式 2：LLM 向量化
    if (canUseLLM) {
      logger.info('KB', t('log.kb.rebuildWithLlm'))
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

        // 写入向量（复用 vector-store 的安全逐行 update，避免 dropTable+createTable 中途失败丢数据）
        let processed = 0
        let failed = 0
        if (results.length > 0) {
          try {
            const { updateChunkVectors } = await import('../vector-store')
            const updates: Array<{ id: string; vector: number[] }> = []
            vectorless.forEach((r: { id: string }, i: number) => {
              if (results[i] && results[i].vector.length > 0) {
                updates.push({ id: r.id, vector: results[i].vector })
                processed++
              } else {
                failed++
              }
            })

            if (updates.length > 0) {
              const res = await updateChunkVectors(projectPath, updates)
              if (!res.success) {
                // T4 R1（M2）：透传 updateChunkVectors 的**具体**错误（维度拒绝时含「重建索引」指引）
                // 与**真实**计数——旧写法只回泛化文案 `kb.llmWriteFailed`，把可操作的指引丢掉了；
                // `failed` 含「空向量行」（未进入 updates 的那部分），即所有没拿到向量的行
                return {
                  success: false,
                  processed: res.count,                  // 零成功时必然为 0（success:false 的定义）
                  failed: vectorless.length - res.count,
                  error: res.error ?? t('kb.llmWriteFailed'),
                }
              }
              // 部分成功：`res.count` 是真正写成功的行数（T4 起 updateChunkVectors 如实上报），
              // 用它覆盖「拿到向量的行数」，未写成功的行计入 failed
              processed = res.count
              failed += updates.length - res.count
            }
          } catch (e) {
            failed = vectorless.length
            return { success: false, processed: 0, failed, error: t('kb.llmWriteFailedDetail').replace('{error}', String(e)) }
          }
        }

        return { success: true, processed, failed }
      } catch (error) {
        logger.warn('KB', t('log.kb.llmBackfillFailed').replace('{err}', String(error)))
      }
    }

    // 方式 3：全部不可用 — 标记为 FTS 模式
    logger.info('KB', t('log.kb.noVectorMethodFtsOnly'))
    const { count } = await getVectorlessCount(projectPath)
    return {
      success: false,
      processed: 0,
      failed: count,
      error: t('kb.noVectorMethod'),
    }
  })

  // L3 T2：中文分词回填（纯本地 jieba 分词，无需 Embedding 配置）
  guardedHandle('kb:backfill-tokens', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, processed: 0, failed: 0, error: t('error.noProject') }
    try {
      return await backfillTokens(projectPath)
    } catch (error) {
      // T2 M4：分词回填失败用**分词**文案（复用 log.kb.backfillError「向量回填异常」会误导 LogsView）
      logger.error('KB', t('log.kb.backfillTokensError').replace('{err}', String(error)))
      return { success: false, processed: 0, failed: 0, error: safeErrorMessage(error) }
    }
  })

  guardedHandle('dialog:select-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: t('dialog.selectDocs'),
      // 可读文本扩展名（知识库导入 + Agent 添加外部文件共用）
      filters: [{ name: '文本文件', extensions: ['txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'csv'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    // L4 S8：授权由**主进程**在对话框结果处签发（改造前是渲染层回调 fs:grant-external-file
    // 自行上报路径 —— 那可是任意路径，等于自己给自己发通行证；该通道已删除）。
    for (const p of result.filePaths) grantExternalFile(p)
    return result.filePaths
  })

  guardedHandle('dialog:select-import-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: t('dialog.selectDocsFolder'),
    })
    if (result.canceled || result.filePaths.length === 0) return null
    grantDirectory(result.filePaths[0])
    return result.filePaths[0]
  })
}
