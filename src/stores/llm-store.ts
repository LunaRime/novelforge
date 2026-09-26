import { t } from '../shared/locale'
import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import { renderLog } from '../services/render-logger'
import { toast } from '../components/ui/Toast'

/**
 * 正在删除中的模型 id（防重复点击）—— 真机反馈：删除耗时较长且删除按钮**没有任何等待反馈**，
 * 用户会连点多次；每次点击都会发出一个 llm:delete-model。
 */
const deletingModelIds = new Set<string>()
import type { ModelProfile, LLMResponse, TokenUsage, ProviderAccount } from '../shared/ipc-channels'
import { normalizeModelProfile } from '../shared/llm-constants'
import { ModelRouter, type CallPurpose, type ModelRouteConfig, type ModelTier, DEFAULT_ROUTE_CONFIG } from '../services/llm/model-router'

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
  /** 供应商账户（一份凭据挂多个模型）—— 其派生条目仍在 models 里 */
  providers: ProviderAccount[]

  // ===== Actions =====
  /** 初始化（加载模型列表 + 默认模型 ID） */
  init: () => Promise<void>
  /** 加载模型列表 */
  loadModels: () => Promise<void>
  /** 加载供应商账户 */
  loadProviders: () => Promise<void>
  /** 保存账户（主进程会顺带同步其派生模型条目）→ 成功后重载 models */
  saveProvider: (account: ProviderAccount) => Promise<boolean>
  /** 删除账户（连同其派生条目）。⚠️ 调用方须先做引用检查（findModelReferences） */
  deleteProvider: (accountId: string) => Promise<boolean>
  /** 拉取某凭据下可用的模型名（失败返回可操作错误文案，不是异常） */
  listProviderModels: (
    credentials: Pick<ProviderAccount, 'provider' | 'protocol' | 'apiKey' | 'baseUrl'>,
  ) => Promise<{ success: boolean; models?: string[]; error?: string }>
  /** 保存模型 */
  saveModel: (model: ModelProfile) => Promise<boolean>
  /** 删除模型 */
  deleteModel: (modelId: string) => Promise<boolean>
  /** 设置默认生成模型（持久化到 ~/.novelforge/config.json） */
  setDefaultModel: (modelId: string) => void
  /** 设置默认向量模型（持久化到 ~/.novelforge/config.json） */
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
  /** 根据 purpose 获取最优模型 ID；tierOverride 供 A 档动态策略直接指定路由层 */
  getModelForPurpose: (purpose: CallPurpose, tierOverride?: ModelTier) => string | null
  /** 按层取模型（A 档动态策略）：层内为空 → 既有降级链 → 用户默认模型 */
  getModelForTier: (tier: ModelTier) => string | null
  /** 更新模型路由配置 */
  updateModelRoutes: (config: Partial<ModelRouteConfig>) => void
}

export const useLLMStore = create<LLMState>()((set, get) => ({
  models: [],
  defaultModelId: null,
  defaultEmbeddingModelId: null,
  providers: [],
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
    // 从 ~/.novelforge/ 加载模型列表和默认模型 ID
    await Promise.all([get().loadModels(), get().loadProviders()])
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
      // 迁移归一化：补齐旧配置缺的 contextWindow（取 maxTokens —— 拆字段前消费点读的就是它，
      // 故零行为变化；见 normalizeModelProfile）。**这里是全仓 models 的唯一写入点**，
      // 增删改模型后都会重新加载，所以归一化只需这一处。
      const models = (await ipc.invoke('llm:list-models')).map(normalizeModelProfile)
      const routeConfig = get().modelRoutes
      const router = new ModelRouter(routeConfig, models)
      set({ models, modelRouter: router, modelRoutes: router.getConfig(), loaded: true })
    } catch (e) {
      // 加载失败：置 loaded 终止调用方 useEffect 无限重试（此前失败后每次渲染重试 + 未捕获 rejection）
      renderLog('error', 'LLM', t('log.render.modelListLoadFailed').replace('{err}', () => String(e)))
      set({ loaded: true })
    }
  },

  loadProviders: async () => {
    if (!ipc.isElectron) return
    try {
      set({ providers: await ipc.invoke('llm:list-providers') })
    } catch (e) {
      renderLog('error', 'LLM', t('log.render.modelListLoadFailed').replace('{err}', () => String(e)))
    }
  },

  saveProvider: async (account) => {
    const result = await ipc.invoke('llm:save-provider', account)
    // 主进程已按 modelNames 同步了 models.json（新建/删除派生条目、更新凭据副本）→ 两边都重载
    if (result.success) {
      await Promise.all([get().loadProviders(), get().loadModels()])
    }
    return result.success
  },

  deleteProvider: async (accountId) => {
    const result = await ipc.invoke('llm:delete-provider', accountId)
    if (!result.success) return false
    await Promise.all([get().loadProviders(), get().loadModels()])
    // 与 deleteModel 同理：删账户会连带删掉其派生模型，三层路由里可能还留着它们的 id
    // → 不清会让 ModelRoutingSection 读到不存在的 id 而显示空白
    const alive = new Set(get().models.map((m) => m.id))
    const routes = get().modelRoutes
    const cleaned: ModelRouteConfig = {
      elite: routes.elite.filter((id) => alive.has(id)),
      standard: routes.standard.filter((id) => alive.has(id)),
      budget: routes.budget.filter((id) => alive.has(id)),
    }
    if (
      cleaned.elite.length !== routes.elite.length ||
      cleaned.standard.length !== routes.standard.length ||
      cleaned.budget.length !== routes.budget.length
    ) {
      await ipc.invoke('llm:set-routes', cleaned)
      set({ modelRoutes: cleaned })
    }
    return true
  },

  listProviderModels: (credentials) => ipc.invoke('llm:list-provider-models', credentials),

  saveModel: async (model) => {
    const result = await ipc.invoke('llm:save-model', model)
    if (result.success) {
      await get().loadModels()
    }
    return result.success
  },

  deleteModel: async (modelId) => {
    // 防重复点击：删除耗时较长时用户会连点。此前每次点击都会发一个 llm:delete-model，
    // 除第一次外全部命中「model not found」→ 弹多条错误 toast（比「没反应」更糟）。
    // 守卫只覆盖**慢的那一段**（IPC），后面的本地清理很快，不需要一直锁着。
    if (deletingModelIds.has(modelId)) return false
    deletingModelIds.add(modelId)
    let result: { success: boolean; error?: string }
    try {
      result = await ipc.invoke('llm:delete-model', modelId)
    } catch (e) {
      // invoke 本身 reject（超时/主进程异常）也要解锁，否则该模型本次会话内再也删不掉
      deletingModelIds.delete(modelId)
      renderLog('error', 'Save:Model', t('log.render.modelDeleteFailed').replace('{err}', () => String(e)))
      toast.error(t('model.deleteFailed').replace('{error}', () => String(e)))
      return false
    }
    deletingModelIds.delete(modelId)
    if (!result.success) {
      // ⚠️ 真机回归修复（2026-09-13）：此前失败路径**完全静默**（没有 else 分支，无 toast 无日志），
      //   用户只能看到「点击删除按钮没反应」。按 save-feedback-standard 补齐视觉反馈 + 日志。
      const detail = result.error ?? t('status.unknown')
      renderLog('error', 'Save:Model', t('log.render.modelDeleteFailed').replace('{err}', () => detail))
      toast.error(t('model.deleteFailed').replace('{error}', () => detail))
      return false
    }
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

  getModelForPurpose: (purpose, tierOverride) => {
    const { modelRouter } = get()
    if (!modelRouter) return get().defaultModelId
    return modelRouter.route(purpose, tierOverride) || get().defaultModelId
  },

  getModelForTier: (tier) => {
    const { modelRouter } = get()
    if (!modelRouter) return get().defaultModelId
    // purpose 传 'default' 占位——tier 覆盖优先，静态映射不参与
    return modelRouter.route('default', tier) || get().defaultModelId
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
