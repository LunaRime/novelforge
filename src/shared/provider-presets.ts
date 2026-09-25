/**
 * 服务商预设配置 — 共享类型定义
 * 渲染进程与主进程共同使用，持久化在 ~/.novelforge/provider-presets.json
 */

/** 单个模型的预设 — name + 该模型的 token 规格 */
export interface ModelPreset {
  name: string
  /** 单次请求最大**输出** token 数（发给 API 的 max_tokens） */
  maxTokens: number
  /**
   * 上下文窗口（**可省略**）。省略时由 `tokenSpec` / `normalizeModelProfile` 取 `maxTokens` ——
   * 2026-09-25 把窗口与输出上限拆成两个字段时的**忠实搬运**，不代表它是真实窗口。
   *
   * 只在该模型**真实窗口 ≠ maxTokens** 时才显式写这里（差异即例外）——
   * 逐条照抄 maxTokens 会多出 30+ 个必然会漂移的重复数字。
   *
   * ⚠️ 本文件会持久化到 `~/.novelforge/provider-presets.json`，新增字段**一律可选**，
   * 否则旧文件读进来会缺字段。
   */
  contextWindow?: number
}

/** 单个服务商的预设配置 */
export interface ProviderPreset {
  /** 服务商唯一标识（内置值如 openai/deepseek，用户可自定义如 my-proxy） */
  provider: string
  /** 界面显示名称，缺省时使用 provider ID */
  displayName?: string
  /** 默认 API 地址 */
  baseUrl: string
  /** 默认调用协议：openai 兼容 或 gemini 原生 */
  protocol: string
  /** 支持的生成模型列表（含各自的 maxTokens） */
  models: ModelPreset[]
  /** 支持的向量模型列表（embedding 模型不需要 maxTokens） */
  embeddingModels: string[]
}

/** 内置默认预设（首次启动时写入持久化文件） */
export const BUILTIN_PRESETS: ProviderPreset[] = [
  {
    provider: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    protocol: 'openai',
    models: [
      { name: 'gpt-5.6-sol', maxTokens: 131072 },
      { name: 'gpt-5.6-terra', maxTokens: 131072 },
      { name: 'gpt-5.6-luna', maxTokens: 131072 },
      { name: 'gpt-5.4-mini', maxTokens: 131072 },
      { name: 'gpt-5.4-nano', maxTokens: 131072 },
    ],
    embeddingModels: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'],
  },
  {
    provider: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    protocol: 'openai',
    models: [
      // V4 系列（2026-07-24 起 deepseek-chat / deepseek-reasoner 已停用）
      { name: 'deepseek-v4-flash', maxTokens: 131072 },
      { name: 'deepseek-v4-pro', maxTokens: 131072 },
    ],
    embeddingModels: [],
  },
  {
    /** 智谱 BigModel — OpenAI 兼容协议，API 路径为 /v4 */
    provider: 'bigmodel',
    displayName: 'BigModel（智谱）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    protocol: 'openai',
    models: [
      { name: 'glm-5.2', maxTokens: 131072 },
      { name: 'glm-5.1', maxTokens: 131072 },
      { name: 'glm-5', maxTokens: 131072 },
      { name: 'glm-5-turbo', maxTokens: 131072 },
      { name: 'glm-4.7', maxTokens: 131072 },
      { name: 'glm-4.7-flashx', maxTokens: 131072 },
      { name: 'glm-4.6', maxTokens: 131072 },
      { name: 'glm-4.5', maxTokens: 65536 },
      { name: 'glm-4.5-air', maxTokens: 98304 },
    ],
    embeddingModels: ['embedding-3'],
  },
  {
    provider: 'gemini',
    displayName: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    protocol: 'gemini',
    models: [
      { name: 'gemini-3.1-pro-preview', maxTokens: 65536 },
      { name: 'gemini-3.6-flash', maxTokens: 65536 },
      { name: 'gemini-3.5-flash', maxTokens: 65536 },
      { name: 'gemini-3-flash-preview', maxTokens: 65536 },
    ],
    embeddingModels: ['text-embedding-004'],
  },
  {
    provider: 'ollama',
    displayName: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434',
    protocol: 'openai',
    models: [
      { name: 'llama3.3', maxTokens: 4096 },
      { name: 'llama3.2', maxTokens: 4096 },
      { name: 'qwen2.5', maxTokens: 8192 },
      { name: 'qwen2.5-coder', maxTokens: 8192 },
      { name: 'mistral', maxTokens: 4096 },
      { name: 'phi4', maxTokens: 4096 },
      { name: 'gemma3', maxTokens: 8192 },
    ],
    embeddingModels: ['nomic-embed-text', 'mxbai-embed-large', 'bge-m3'],
  },
  {
    provider: 'custom',
    displayName: '自定义',
    baseUrl: '',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
  },
]
