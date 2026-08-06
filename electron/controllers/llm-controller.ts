import { ipcMain, BrowserWindow } from 'electron'
import { t } from '../../src/shared/locale'
import { readJsonFile, writeJsonFile, MODELS_CONFIG_PATH, GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG } from '../utils/config-utils'
import { ModelProfile, GlobalConfig } from '../../src/shared/ipc-channels'
import { LLMFactory } from '../llm/llm-factory'
import { llmConcurrencyController } from '../utils/concurrency-controller'
import { encryptApiKey, decryptApiKey, isPlaintextKey } from '../utils/secure-config'
import { safeErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'

const activeStreams = new Map<string, AbortController>()

function loadModelConfigs(): ModelProfile[] {
  const models = readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, [])
  let migrated = false

  for (const model of models) {
    // 向后兼容：检测明文 key 并自动迁移到加密格式
    if (isPlaintextKey(model.apiKey)) {
      model.apiKey = encryptApiKey(model.apiKey)
      migrated = true
      logger.info('LLM', t('log.llm.migrateKeyAuto').replace('{name}', model.name).replace('{id}', model.id))
    }
  }

  // 如果有迁移，立即写回加密后的配置
  if (migrated) {
    writeJsonFile(MODELS_CONFIG_PATH, models)
    logger.info('LLM', t('log.llm.migrateKeyDone'))
  }

  // 返回时解密 key 供运行时使用
  return models.map((m) => ({ ...m, apiKey: decryptApiKey(m.apiKey) }))
}

function saveModelConfigs(models: ModelProfile[]) {
  // 保存前加密所有 apiKey
  const toSave = models.map((m) => ({ ...m, apiKey: encryptApiKey(m.apiKey) }))
  writeJsonFile(MODELS_CONFIG_PATH, toSave)
}

function getModelConfig(modelId: string): ModelProfile | null {
  const models = loadModelConfigs()
  return models.find((m) => m.id === modelId) ?? null
}

function applyProxyConfig() {
  try {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    if (config.proxy?.enabled && config.proxy.host) {
      const proxyUrl = config.proxy.type === 'socks5'
        ? `socks5://${config.proxy.host}:${config.proxy.port}`
        : `http://${config.proxy.host}:${config.proxy.port}`
      process.env.HTTP_PROXY = proxyUrl
      process.env.HTTPS_PROXY = proxyUrl
      process.env.http_proxy = proxyUrl
      process.env.https_proxy = proxyUrl
    } else {
      delete process.env.HTTP_PROXY
      delete process.env.HTTPS_PROXY
      delete process.env.http_proxy
      delete process.env.https_proxy
    }
  } catch { /* 忽略 */ }
}

/** 启动时恢复持久化的并发配置（重启不丢；损坏值忽略回到默认） */
function restoreConcurrencyConfig() {
  try {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    if (config.concurrency?.maxConcurrent && config.concurrency.maxQueueSize) {
      llmConcurrencyController.updateConfig({
        maxConcurrent: Math.max(1, Math.min(20, config.concurrency.maxConcurrent)),
        maxQueueSize: Math.max(1, Math.min(500, config.concurrency.maxQueueSize)),
      })
      logger.info('LLM', t('log.llm.concurrencyRestored').replace('{max}', String(config.concurrency.maxConcurrent)).replace('{queue}', String(config.concurrency.maxQueueSize)))
    }
  } catch { /* 忽略 */ }
}

export function registerLLMController() {
  restoreConcurrencyConfig()

  ipcMain.handle('llm:generate', async (_event, request: { modelId: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number; responseFormat?: { type: string }; thinking?: boolean; priority?: number }) => {
    return llmConcurrencyController.execute(
      async () => {
        applyProxyConfig()
        const model = getModelConfig(request.modelId)
        if (!model) return { success: false, content: '', error: t('error.modelConfigNotFound') }

        const provider = LLMFactory.getProvider(model)
        return await provider.generate(model, request.messages, {
          temperature: request.temperature ?? model.temperature,
          maxTokens: request.maxTokens ?? model.maxTokens,
          responseFormat: request.responseFormat,
          thinking: request.thinking,
        })
      },
      // timeoutMs: 0 —— 与流式一致：长输出（预设 maxTokens 高达 131072）可超 120s；
      // Promise.race 超时不取消底层 fn，超时后请求仍会真实调用 API 继续扣费（历史事故：
      // 超时报错 + 底层继续执行 + 槽位提前释放 → 并发上限失效 + 双倍计费）
      { priority: request.priority ?? 10, timeoutMs: 0 },
    ).catch((error) => ({
      success: false,
      content: '',
      error: error instanceof Error ? error.message : safeErrorMessage(error),
    }))
  })

  ipcMain.handle('llm:generate-stream', async (event, requestId: string, request: { modelId: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number; responseFormat?: { type: string }; thinking?: boolean; priority?: number }) => {
    applyProxyConfig()
    const model = getModelConfig(request.modelId)
    if (!model) return { requestId, started: false }

    const abortController = new AbortController()
    activeStreams.set(requestId, abortController)
    const win = BrowserWindow.fromWebContents(event.sender)

    const provider = LLMFactory.getProvider(model)

    // 使用并发控制器执行流式请求
    // 注意：流式请求的 execute 返回后流仍在进行，所以我们在内部获取槽位
    // timeoutMs: 0（无硬超时）——长输出（批量蓝图/长文生成）可超过 120s；
    // 流式请求的生命周期由 llm:cancel → AbortController 管理（取消仍生效）
    llmConcurrencyController.execute(
      async () => {
        // 检查请求是否已被取消（排队期间被取消：必须补发错误事件——
        // 渲染层监听器与 activeRequests 只在 onDone/onError 中清理，静默跳过会永久泄漏）
        if (abortController.signal.aborted) {
          win?.webContents.send('llm:stream-error', { requestId, error: t('error.requestCancelled') })
          activeStreams.delete(requestId)
          return { skipped: true }
        }

        return new Promise<void>((resolve, reject) => {
          provider.generateStream(model, request.messages, {
            temperature: request.temperature ?? model.temperature,
            maxTokens: request.maxTokens ?? model.maxTokens,
            responseFormat: request.responseFormat,
            thinking: request.thinking,
            signal: abortController.signal,
            onChunk: (chunk: string) => {
              if (!abortController.signal.aborted) {
                win?.webContents.send('llm:stream-chunk', { requestId, chunk })
              }
            },
            onDone: (fullText: string, usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number }) => {
              // usage 含真实缓存命中 token（provider 已解析），透传给渲染进程供费用统计
              win?.webContents.send('llm:stream-done', { requestId, fullText, usage })
              activeStreams.delete(requestId)
              resolve()
            },
            onError: (error: string) => {
              win?.webContents.send('llm:stream-error', { requestId, error })
              activeStreams.delete(requestId)
              reject(new Error(error))
            },
          }).catch(reject)
        }).catch(() => { /* 流式错误已通过 onError 回调处理 */ })
      },
      { priority: request.priority ?? 10, timeoutMs: 0 },
    ).catch((error) => {
      // 用 error.name 判断取消（此前依赖 locale 文案 '请求已取消' 字符串比较，
      // en-US/ru-RU 语言下失效且是死分支——取消路径实际已被 skipped 分支/onError 处理）
      if (!(error instanceof Error && error.name === 'AbortError')) {
        win?.webContents.send('llm:stream-error', { requestId, error: safeErrorMessage(error) })
        activeStreams.delete(requestId)
      }
    })

    return { requestId, started: true }
  })

  ipcMain.handle('llm:cancel', async (_event, requestId: string) => {
    const controller = activeStreams.get(requestId)
    if (controller) {
      controller.abort()
      activeStreams.delete(requestId)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle('llm:list-models', async () => loadModelConfigs())

  ipcMain.handle('llm:save-model', async (_event, model: ModelProfile) => {
    try {
      // 业务校验（P3 修复）：
      // - modelName 空 → 运行时 API 必报错（ollama 空名等）
      // - purposes 空 → 模型在 UI 所有分类中不可见的孤儿，无法编辑/删除
      if (!model.modelName?.trim()) {
        return { success: false, error: t('error.modelNameEmpty') }
      }
      if (!model.purposes || model.purposes.length === 0) {
        return { success: false, error: t('error.modelPurposesEmpty') }
      }
      const models = loadModelConfigs()
      const idx = models.findIndex((m) => m.id === model.id)
      if (idx >= 0) models[idx] = model
      else models.push(model)
      saveModelConfigs(models)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  ipcMain.handle('llm:delete-model', async (_event, modelId: string) => {
    try {
      const models = loadModelConfigs().filter((m) => m.id !== modelId)
      saveModelConfigs(models)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  ipcMain.handle('llm:set-default-model', async (_event, modelId: string | null) => {
    try {
      const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      config.defaultModelId = modelId
      writeJsonFile(GLOBAL_CONFIG_PATH, config)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  ipcMain.handle('llm:get-default-model', async () => {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    return config.defaultModelId
  })

  ipcMain.handle('llm:set-default-embedding-model', async (_event, modelId: string | null) => {
    try {
      const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      config.defaultEmbeddingModelId = modelId
      writeJsonFile(GLOBAL_CONFIG_PATH, config)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  ipcMain.handle('llm:get-default-embedding-model', async () => {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    return config.defaultEmbeddingModelId ?? null
  })

  ipcMain.handle('llm:test-connection', async (_event, model: ModelProfile) => {
    try {
      applyProxyConfig()

      const messages = [{ role: 'user', content: 'Say "hello" and nothing else.' }]
      const provider = LLMFactory.getProvider(model)

      let result = { success: true, error: undefined as undefined | string }
      if (model.purposes?.includes('embedding')) {
        const { generateEmbeddings } = await import('../embedding')
        await generateEmbeddings(['hello'], model.protocol, model)
      } else {
        const res = await provider.generate(model, messages, {
          temperature: 0.7,
          maxTokens: 10,
        })
        result = { success: res.success, error: res.error }
      }

      return { success: result.success, error: result.error }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // ===== 并发控制 =====

  ipcMain.handle('llm:concurrency-status', async () => {
    return llmConcurrencyController.getStatus()
  })

  ipcMain.handle('llm:concurrency-config', async (_event, config: { maxConcurrent?: number; maxQueueSize?: number }) => {
    try {
      // IPC 层钳制（UI 已有 min 1，主进程独立校验防死锁排队：maxConcurrent<=0 时所有请求卡队列）
      const next = {
        maxConcurrent: config.maxConcurrent !== undefined ? Math.max(1, Math.min(20, config.maxConcurrent)) : undefined,
        maxQueueSize: config.maxQueueSize !== undefined ? Math.max(1, Math.min(500, config.maxQueueSize)) : undefined,
      }
      llmConcurrencyController.updateConfig(next)
      // 持久化到全局配置（重启恢复）
      const g = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      g.concurrency = {
        maxConcurrent: llmConcurrencyController.getStatus().maxConcurrent,
        maxQueueSize: llmConcurrencyController.getStatus().maxQueueSize,
      }
      writeJsonFile(GLOBAL_CONFIG_PATH, g)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // ===== 模型路由配置（三层 elite/standard/budget，持久化到全局配置） =====

  ipcMain.handle('llm:set-routes', async (_event, routes: { elite: string[]; standard: string[]; budget: string[] }) => {
    try {
      const g = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      g.modelRoutes = {
        elite: Array.isArray(routes.elite) ? routes.elite : [],
        standard: Array.isArray(routes.standard) ? routes.standard : [],
        budget: Array.isArray(routes.budget) ? routes.budget : [],
      }
      writeJsonFile(GLOBAL_CONFIG_PATH, g)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  ipcMain.handle('llm:get-routes', async () => {
    const g = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    return g.modelRoutes ?? { elite: [], standard: [], budget: [] }
  })
}
