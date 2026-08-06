import { t } from '../shared/locale'
import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import { renderLog } from '../services/render-logger'
import type { ModelProfile, LLMResponse, TokenUsage } from '../shared/ipc-channels'
import { ModelRouter, type CallPurpose, type ModelRouteConfig, DEFAULT_ROUTE_CONFIG } from '../services/llm/model-router'

/** 流式生成的回调 */
interface StreamCallbacks {
  onChunk?: (chunk: string) => void
  onDone?: (fullText: string, usage?: TokenUsage) => void
  onError?: (error: string) => void
}

interface LLMState {
  /** 已配置的模型列表 */
  models: ModelProfile[]
  /** 当前默认生成模型 ID */
  defaultModelId: string | null
  /** 当前默认向量模型 ID */
  defaultEmbeddingModelId: string | null
  /** 正在进行的活跃请求 */
  activeRequests: Map<string, { status: 'running' | 'done' | 'error'; text: string }>
  /** 是否已加载模型配置 */
  loaded: boolean
  /** 模型路由器 */
  modelRouter: ModelRouter | null
  /** 模型路由配置 */
  modelRoutes: ModelRouteConfig

  // ===== Actions =====
  /** 初始化（加载模型列表 + 默认模型 ID） */
  init: () => Promise<void>
  /** 加载模型列表 */
  loadModels: () => Promise<void>
  /** 保存模型 */
  saveModel: (model: ModelProfile) => Promise<boolean>
  /** 删除模型 */
  deleteModel: (modelId: string) => Promise<boolean>
  /** 设置默认生成模型（持久化到 ~/.vela/config.json） */
  setDefaultModel: (modelId: string) => void
  /** 设置默认向量模型（持久化到 ~/.vela/config.json） */
  setDefaultEmbeddingModel: (modelId: string) => void
  /** 非流式生成 */
  generate: (
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    modelId?: string,
    options?: { responseFormat?: { type: string }; thinking?: boolean; priority?: number; temperature?: number }
  ) => Promise<LLMResponse>
  /** 流式生成 */
  generateStream: (
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    callbacks: StreamCallbacks,
    modelId?: string,
    options?: { responseFormat?: { type: string }; thinking?: boolean; priority?: number; temperature?: number }
  ) => Promise<string>
  /** 取消生成 */
  cancelGeneration: (requestId: string) => Promise<void>
  /** 测试模型连接 */
  testConnection: (model: ModelProfile) => Promise<{ success: boolean; error?: string }>
  /** 根据 purpose 获取最优模型 ID */
  getModelForPurpose: (purpose: CallPurpose) => string | null
  /** 更新模型路由配置 */
  updateModelRoutes: (config: Partial<ModelRouteConfig>) => void
}

export const useLLMStore = create<LLMState>()((set, get) => ({
  models: [],
  defaultModelId: null,
  defaultEmbeddingModelId: null,
  activeRequests: new Map(),
  loaded: false,
  modelRouter: null,
  modelRoutes: { ...DEFAULT_ROUTE_CONFIG },

  init: async () => {
    if (get().loaded) return
    if (ipc.isElectron) {
      // 先恢复持久化的三层路由配置——router 构造时用持久化配置，autoDetectTiers 只补新模型
      try {
        const saved = await ipc.invoke('llm:get-routes')
        if (saved) set({ modelRoutes: saved })
      } catch { /* 静默：无持久化配置时走自动分配 */ }
    }
    // 从 ~/.vela/ 加载模型列表和默认模型 ID
    await get().loadModels()
    if (ipc.isElectron) {
      const [defaultId, defaultEmbeddingId] = await Promise.all([
        ipc.invoke('llm:get-default-model'),
        ipc.invoke('llm:get-default-embedding-model'),
      ])
      const models = get().models
      const routeConfig = get().modelRoutes
      const router = new ModelRouter(routeConfig, models)
      set({
        defaultModelId: defaultId,
        defaultEmbeddingModelId: defaultEmbeddingId,
        modelRouter: router,
        modelRoutes: router.getConfig(),
        loaded: true,
      })
    } else {
      set({ loaded: true })
    }
  },

  loadModels: async () => {
    if (!ipc.isElectron) return
    try {
      const models = await ipc.invoke('llm:list-models')
      const routeConfig = get().modelRoutes
      const router = new ModelRouter(routeConfig, models)
      set({ models, modelRouter: router, modelRoutes: router.getConfig(), loaded: true })
    } catch (e) {
      // 加载失败：置 loaded 终止调用方 useEffect 无限重试（此前失败后每次渲染重试 + 未捕获 rejection）
      renderLog('error', 'LLM', t('log.render.modelListLoadFailed').replace('{err}', () => String(e)))
      set({ loaded: true })
    }
  },

  saveModel: async (model) => {
    const result = await ipc.invoke('llm:save-model', model)
    if (result.success) {
      await get().loadModels()
    }
    return result.success
  },

  deleteModel: async (modelId) => {
    const result = await ipc.invoke('llm:delete-model', modelId)
    if (result.success) {
      // 从三层路由中清理该模型引用（防 ModelRoutingSection 读到已删除 id 显示空白）
      const routes = get().modelRoutes
      const cleaned: ModelRouteConfig = {
        elite: routes.elite.filter(id => id !== modelId),
        standard: routes.standard.filter(id => id !== modelId),
        budget: routes.budget.filter(id => id !== modelId),
      }
      set({ modelRoutes: cleaned })
      ipc.invoke('llm:set-routes', cleaned).catch(() => {})
      await get().loadModels()
      // 删除默认生成模型：从剩余生成模型自动选替补（否则所有工作流立即报 noDefaultModel）
      if (get().defaultModelId === modelId) {
        const fallback = get().models.find(m => !m.purposes?.includes('embedding'))
        const nextId = fallback ? fallback.id : null
        set({ defaultModelId: nextId })
        // await + 校验：fire-and-forget 写盘失败会静默（重启后 config.json 指向已删 id）
        try {
          const r = await ipc.invoke('llm:set-default-model', nextId)
          if (!r.success) renderLog('error', 'Save:Model', t('log.render.defaultModelSaveFailed'))
        } catch (e) {
          renderLog('error', 'Save:Model', t('log.render.defaultModelSaveFailed').replace('{err}', () => String(e)))
        }
      }
      // 如果删除的是默认向量模型，清空默认
      if (get().defaultEmbeddingModelId === modelId) {
        set({ defaultEmbeddingModelId: null })
        ipc.invoke('llm:set-default-embedding-model', null).catch(() => {})
      }
    }
    return result.success
  },

  setDefaultModel: async (modelId) => {
    set({ defaultModelId: modelId })
    // await + 校验：写盘失败时主进程 config.json 仍指向旧 id，重启后模型配置失效（P2 修复）
    try {
      const result = await ipc.invoke('llm:set-default-model', modelId)
      if (!result.success) renderLog('error', 'Save:Model', t('log.render.defaultModelSaveFailed'))
    } catch (e) {
      renderLog('error', 'Save:Model', t('log.render.defaultModelSaveFailed').replace('{err}', () => String(e)))
    }
  },

  setDefaultEmbeddingModel: async (modelId) => {
    set({ defaultEmbeddingModelId: modelId })
    try {
      const result = await ipc.invoke('llm:set-default-embedding-model', modelId)
      if (!result.success) renderLog('error', 'Save:Model', t('log.render.defaultModelSaveFailed'))
    } catch (e) {
      renderLog('error', 'Save:Model', t('log.render.defaultModelSaveFailed').replace('{err}', () => String(e)))
    }
  },

  generate: async (messages, modelId, options) => {
    const mid = modelId ?? get().defaultModelId
    if (!mid) return { success: false, content: '', error: t('error.noDefaultModel') }
    return ipc.invoke('llm:generate', {
      modelId: mid,
      messages,
      temperature: options?.temperature,
      responseFormat: options?.responseFormat as { type: 'json_object' | 'text' } | undefined,
      thinking: options?.thinking,
      priority: options?.priority ?? 10,
    })
  },

  generateStream: async (messages, callbacks, modelId, options) => {
    const mid = modelId ?? get().defaultModelId
    if (!mid) {
      callbacks.onError?.(t('error.noDefaultModel'))
      return ''
    }

    const requestId = crypto.randomUUID()

    // 注册流式事件监听
    const unsubChunk = ipc.on('llm:stream-chunk', (data) => {
      if (data.requestId === requestId) {
        callbacks.onChunk?.(data.chunk)
      }
    })

    const unsubDone = ipc.on('llm:stream-done', (data) => {
      if (data.requestId === requestId) {
        callbacks.onDone?.(data.fullText, data.usage)
        cleanup()
      }
    })

    const unsubError = ipc.on('llm:stream-error', (data) => {
      if (data.requestId === requestId) {
        callbacks.onError?.(data.error)
        cleanup()
      }
    })

    const cleanup = () => {
      unsubChunk()
      unsubDone()
      unsubError()
      const reqs = new Map(get().activeRequests)
      reqs.delete(requestId)
      set({ activeRequests: reqs })
    }

    // 标记活跃请求
    const reqs = new Map(get().activeRequests)
    reqs.set(requestId, { status: 'running', text: '' })
    set({ activeRequests: reqs })

    // 发起流式请求
    await ipc.invoke('llm:generate-stream', requestId, {
      modelId: mid,
      messages,
      stream: true,
      temperature: options?.temperature,
      responseFormat: options?.responseFormat as { type: 'json_object' | 'text' } | undefined,
      thinking: options?.thinking,
      priority: options?.priority ?? 10,
    })

    return requestId
  },

  cancelGeneration: async (requestId) => {
    await ipc.invoke('llm:cancel', requestId)
  },

  testConnection: async (model) => {
    return ipc.invoke('llm:test-connection', model)
  },

  getModelForPurpose: (purpose) => {
    const { modelRouter } = get()
    if (!modelRouter) return get().defaultModelId
    return modelRouter.route(purpose) || get().defaultModelId
  },

  updateModelRoutes: (config) => {
    const { modelRouter } = get()
    if (modelRouter) {
      modelRouter.updateConfig(config)
      const routes = modelRouter.getConfig()
      set({ modelRoutes: routes })
      // 持久化到全局配置（重启恢复，此前仅内存导致手动路由重启丢失）
      ipc.invoke('llm:set-routes', routes).catch(() => {})
    }
  },
}))
