/**
 * NovelForge 向量配置管理 Store
 *
 * 管理向量模块（本地 LanceDB FTS + 相似度计算）和向量模型（Embedding API）的开关状态。
 *
 * 逻辑：
 * - 向量模型 ON  → 使用 Embedding API 生成向量 + LanceDB 混合搜索
 * - 向量模型 OFF → 向量模块接管：纯 FTS 文本搜索 + 本地相似度
 * - 向量模块 ON  → 本地余弦相似度、Top-K 查找等可用
 * - 向量模块 OFF → 禁用所有本地向量运算，Agent 工具降级为普通文本搜索
 */

import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import type { ModelProfile } from '../shared/ipc-channels'

// ===== 类型定义 =====

export type VectorWorkMode = 'auto' | 'model_only' | 'module_only' | 'disabled'

export interface LLMEmbeddingSettings {
  /** 是否启用 LLM 向量化 */
  enabled: boolean
  /** 用作向量模型的 LLM ID */
  modelId: string | null
  /** 输出向量维度（默认 256） */
  dimensions: number
}

export interface VectorTestResult {
  /** 向量模块是否可用（本地 FTS + 余弦相似度） */
  moduleOk: boolean
  /** 向量模型是否可用（Embedding API 连接成功） */
  modelOk: boolean
  /** LLM 向量化是否可用 */
  llmEmbeddingOk: boolean
  /** AI 是否能调用向量工具（Agent tool 测试通过） */
  agentToolOk: boolean
  /** 模块详情 */
  moduleDetail: string
  /** 模型详情 */
  modelDetail: string
  /** LLM 向量化详情 */
  llmEmbeddingDetail: string
  /** 测试时间戳 */
  testedAt: string
}

interface VectorConfigState {
  // ===== 开关状态 =====
  /** 向量模块开关（本地 LanceDB FTS + 余弦相似度 + Top-K） */
  vectorModuleEnabled: boolean
  /** 向量模型开关（Embedding API，如 OpenAI text-embedding-3-small） */
  vectorModelEnabled: boolean
  /** LLM 向量化开关 */
  llmEmbeddingEnabled: boolean
  /** LLM 向量化配置 */
  llmEmbeddingSettings: LLMEmbeddingSettings
  /** 可选作向量的 LLM 列表 */
  llmCandidates: ModelProfile[]
  /** 工作模式 */
  workMode: VectorWorkMode

  // ===== 测试结果 =====
  lastTestResult: VectorTestResult | null
  testing: boolean

  // ===== 计算属性 =====
  /** 是否有任何向量能力可用 */
  isAnyVectorAvailable: () => boolean
  /** 是否可以使用 Embedding API */
  canUseEmbeddingAPI: () => boolean
  /** 是否可以使用本地向量模块 */
  canUseLocalModule: () => boolean
  /** 是否可以使用 LLM 向量化 */
  canUseLLMEmbedding: () => boolean

  // ===== Actions =====
  /** 切换向量模块开关 */
  toggleVectorModule: () => void
  /** 切换向量模型开关 */
  toggleVectorModel: () => void
  /** 切换 LLM 向量化开关 */
  toggleLLMEmbedding: () => void
  /** 设置 LLM 向量化配置 */
  setLLMEmbeddingSettings: (settings: Partial<LLMEmbeddingSettings>) => void
  /** 加载 LLM 候选模型 */
  loadLLMCandidates: () => Promise<void>
  /** 设置工作模式 */
  setWorkMode: (mode: VectorWorkMode) => void
  /** 运行连接测试 */
  testConnection: () => Promise<VectorTestResult>
  /** 从持久化存储加载 */
  load: () => void
  /** 持久化保存 */
  save: () => void
}

// ===== Store 实现 =====

const STORAGE_KEY = 'vela-vector-config'

export const useVectorConfigStore = create<VectorConfigState>()((set, get) => ({
  // 默认状态
  vectorModuleEnabled: true,  // 本地模块默认开启
  vectorModelEnabled: true,   // API 模型默认开启
  llmEmbeddingEnabled: false, // LLM 向量化默认关闭
  llmEmbeddingSettings: {
    enabled: false,
    modelId: null,
    dimensions: 256,
  },
  llmCandidates: [],
  workMode: 'auto',
  lastTestResult: null,
  testing: false,

  // ===== 计算属性 =====

  isAnyVectorAvailable: () => {
    const s = get()
    return s.vectorModuleEnabled || s.vectorModelEnabled || s.llmEmbeddingEnabled
  },

  canUseEmbeddingAPI: () => {
    const s = get()
    return s.vectorModelEnabled
  },

  canUseLocalModule: () => {
    const s = get()
    return s.vectorModuleEnabled
  },

  canUseLLMEmbedding: () => {
    const s = get()
    return s.llmEmbeddingEnabled && s.llmEmbeddingSettings.modelId !== null
  },

  // ===== Actions =====

  toggleVectorModule: () => {
    set((s) => {
      const newVal = !s.vectorModuleEnabled
      return { vectorModuleEnabled: newVal }
    })
    get().save()
  },

  toggleVectorModel: () => {
    set((s) => {
      const newVal = !s.vectorModelEnabled
      return { vectorModelEnabled: newVal }
    })
    get().save()
  },

  toggleLLMEmbedding: () => {
    set((s) => {
      const newVal = !s.llmEmbeddingEnabled
      return {
        llmEmbeddingEnabled: newVal,
        llmEmbeddingSettings: { ...s.llmEmbeddingSettings, enabled: newVal },
      }
    })
    // 同步到后端
    const state = get()
    syncLLMConfigToBackend(state)
    get().save()
  },

  setLLMEmbeddingSettings: (settings) => {
    set((s) => ({
      llmEmbeddingSettings: { ...s.llmEmbeddingSettings, ...settings },
    }))
    const state = get()
    syncLLMConfigToBackend(state)
    get().save()
  },

  loadLLMCandidates: async () => {
    if (!ipc.isElectron) return
    try {
      const models = await ipc.invoke('embedding:list-llm-candidates')
      set({ llmCandidates: models })
    } catch {
      // 静默失败
    }
  },

  setWorkMode: (mode) => {
    switch (mode) {
      case 'auto':
        set({ workMode: 'auto', vectorModuleEnabled: true, vectorModelEnabled: true })
        break
      case 'model_only':
        set({ workMode: 'model_only', vectorModuleEnabled: false, vectorModelEnabled: true })
        break
      case 'module_only':
        set({ workMode: 'module_only', vectorModuleEnabled: true, vectorModelEnabled: false })
        break
      case 'disabled':
        set({ workMode: 'disabled', vectorModuleEnabled: false, vectorModelEnabled: false })
        break
    }
    get().save()
  },

  /** 运行完整的向量连通性测试 */
  testConnection: async () => {
    set({ testing: true })

    const result: VectorTestResult = {
      moduleOk: false,
      modelOk: false,
      llmEmbeddingOk: false,
      agentToolOk: false,
      moduleDetail: '',
      modelDetail: '',
      llmEmbeddingDetail: '',
      testedAt: new Date().toISOString(),
    }

    // 1. 测试向量模块（本地 LanceDB FTS）
    try {
      if (ipc.isElectron) {
        const stats = await ipc.invoke('kb:stats')
        result.moduleOk = true
        result.moduleDetail = `LanceDB 正常 | 文档: ${stats.documentCount} | 文本块: ${stats.totalChunks} | 向量维度: ${stats.vectorDimension}`
      } else {
        result.moduleOk = false
        result.moduleDetail = '非 Electron 环境'
      }
    } catch (e) {
      result.moduleOk = false
      result.moduleDetail = `LanceDB 异常: ${String(e)}`
    }

    // 2. 测试向量模型（Embedding API）
    try {
      if (ipc.isElectron) {
        const embeddingModel = await ipc.invoke('embedding:get-model')
        if (embeddingModel) {
          // 尝试生成一个测试嵌入
          const testResult = await ipc.invoke('embedding:generate', '测试文本')
          if (testResult.success && testResult.vector && testResult.vector.length > 0) {
            result.modelOk = true
            result.modelDetail = `Embedding API 正常 | 模型: ${embeddingModel.modelName} | 维度: ${testResult.vector.length}`
          } else {
            result.modelOk = false
            result.modelDetail = `API 返回异常: ${testResult.error || '空向量'}`
          }
        } else {
          result.modelOk = false
          result.modelDetail = '未配置向量模型'
        }
      } else {
        result.modelOk = false
        result.modelDetail = '非 Electron 环境'
      }
    } catch (e) {
      result.modelOk = false
      result.modelDetail = `API 连接失败: ${String(e)}`
    }

    // 3. 测试 LLM 向量化
    if (get().llmEmbeddingEnabled && get().llmEmbeddingSettings.modelId) {
      try {
        const testResult = await ipc.invoke('embedding:test-llm', '向量化测试')
        if (testResult.success && testResult.dimensions && testResult.dimensions > 0) {
          result.llmEmbeddingOk = true
          result.llmEmbeddingDetail = `LLM 向量化正常 | 维度: ${testResult.dimensions} | 前10维预览: [${(testResult.vector || []).slice(0, 5).map((v: number) => v.toFixed(3)).join(', ')}...]`
        } else {
          result.llmEmbeddingOk = false
          result.llmEmbeddingDetail = `LLM 向量化异常: ${testResult.error || '未知'}`
        }
      } catch (e) {
        result.llmEmbeddingOk = false
        result.llmEmbeddingDetail = `LLM 向量化失败: ${String(e)}`
      }
    } else {
      result.llmEmbeddingDetail = 'LLM 向量化未启用或未配置模型'
    }

    // 4. 测试 AI 是否能调用向量工具
    // （检查 embedding:compare 和 kb:search 通道是否可用）
    try {
      if (result.moduleOk) {
        // FTS 搜索测试
        const searchResult = await ipc.invoke('kb:search', 'test', 1)
        result.agentToolOk = Array.isArray(searchResult)
      }
      if (!result.agentToolOk && result.modelOk) {
        // embedding compare 测试
        const compareResult = await ipc.invoke('embedding:compare', 'test', ['test'])
        result.agentToolOk = compareResult.success === true
      }
    } catch {
      result.agentToolOk = false
    }

    set({ lastTestResult: result, testing: false })
    get().save()
    return result
  },

  /** 从 localStorage 加载 */
  load: () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        set({
          vectorModuleEnabled: data.vectorModuleEnabled ?? true,
          vectorModelEnabled: data.vectorModelEnabled ?? true,
          llmEmbeddingEnabled: data.llmEmbeddingEnabled ?? false,
          llmEmbeddingSettings: data.llmEmbeddingSettings ?? { enabled: false, modelId: null, dimensions: 256 },
          workMode: data.workMode ?? 'auto',
          lastTestResult: data.lastTestResult ?? null,
        })
      }
    } catch {
      // 使用默认值
    }
  },

  /** 持久化到 localStorage */
  save: () => {
    try {
      const s = get()
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        vectorModuleEnabled: s.vectorModuleEnabled,
        vectorModelEnabled: s.vectorModelEnabled,
        llmEmbeddingEnabled: s.llmEmbeddingEnabled,
        llmEmbeddingSettings: s.llmEmbeddingSettings,
        workMode: s.workMode,
        lastTestResult: s.lastTestResult,
      }))
    } catch {
      // 存储失败静默忽略
    }
  },
}))

// ===== 工具函数 =====

/** 同步 LLM 配置到后端 EmbeddingService */
async function syncLLMConfigToBackend(state: VectorConfigState) {
  if (!ipc.isElectron) return

  const { llmEmbeddingSettings, llmEmbeddingEnabled, llmCandidates } = state

  // 查找对应的完整 ModelProfile
  const model = llmEmbeddingSettings.modelId
    ? (llmCandidates.find(m => m.id === llmEmbeddingSettings.modelId) || null)
    : null

  try {
    await ipc.invoke('embedding:set-llm-config', {
      enabled: llmEmbeddingEnabled && model !== null,
      model: model,
      dimensions: llmEmbeddingSettings.dimensions,
    })
  } catch {
    // 后端同步失败静默忽略
  }
}
