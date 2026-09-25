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

/**
 * 勾选某个模型时，它的**逐模型设置初值**（2026-09-25，供供应商账户同步用）。
 *
 * 窗口省缺时取 `maxTokens` —— 与 `tokenSpec`（SettingsModal）/ `normalizeModelProfile`
 * （llm-constants）同一约定，三处不可各写一套。
 *
 * 用途：账户同步**新建**派生条目时用；**已存在**的条目不碰（用户的逐模型调参是权威值）。
 */
export function presetModelDefaults(
  provider: string,
  modelName: string,
): { temperature: number; maxTokens: number; contextWindow: number; purposes: Array<'generation' | 'embedding'> } {
  const preset = BUILTIN_PRESETS.find((p) => p.provider === provider)
  const isEmbedding = preset?.embeddingModels.includes(modelName) || looksLikeEmbeddingModel(modelName)
  const model = preset?.models.find((m) => m.name === modelName)
  const maxTokens = model?.maxTokens ?? 131072

  return {
    temperature: 0.7,
    maxTokens,
    contextWindow: model?.contextWindow ?? maxTokens,
    purposes: [isEmbedding ? 'embedding' : 'generation'],
  }
}

/**
 * 模型名像不像向量模型 —— 仅在**预设没写**时兜底（新增的供应商 `embeddingModels` 一律留空，
 * 靠「获取可用模型」拿真实清单，所以这里需要一条名字层面的判据）。
 *
 * ⚠️ **已知覆盖不全**：`bge-m3` / `bge-large` 这类名字不含 `embed` 的会判成生成模型，
 * 而 `ModelForm` 的用途由所属分区决定、**表单里改不了** → 勾错就没有出路。
 * 真要在意，得在账户的勾选清单上给每行一个显式的用途开关（属 UI 决策，另议）。
 */
const EMBEDDING_NAME = /embed|bge|gte-|(^|[-_/])e5([-_/]|$)|reranker/i

export function looksLikeEmbeddingModel(modelName: string): boolean {
  return EMBEDDING_NAME.test(modelName)
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
  // ===== 2026-09-25 补充：市面上常见的 OpenAI 兼容服务 =====
  //
  // ⚠️ 这些条目的 `models` **刻意留空**：
  //   ① 模型名在这个行业里周周在变，硬编码等于编造，且会误导用户去点一个已下线的名字；
  //   ② 供应商账户的「获取可用模型」就是为此存在的 —— 它打 `GET {baseUrl}/v1/models`
  //      拿到**真实**清单，比任何内置列表都准（上面几个老条目是历史遗留，暂不动）。
  //
  // baseUrl 的写法必须让 `buildOpenAIUrl` 拼出正确端点（它会补 `/v1/...`）：
  // 末尾**不要**带 `/v1`（已带版本段的地址不会再补，但留空更统一）。
  {
    /**
     * Anthropic Claude —— 走官方 **OpenAI SDK 兼容层**（`/v1/chat/completions`）。
     *
     * ⚠️ **已知限制（官方文档明列）**，别当原生 API 用：
     *   - 兼容层标为 **beta，非生产就绪**
     *   - **`response_format` 被静默忽略** → 本仓依赖 JSON 约束的流程（蓝图提取/评分等）
     *     在这条路上会失效（模型照常回，但可能不是合法 JSON）。当**普通对话**模型没问题。
     *   - `temperature` 上限为 1（本仓允许 0–2，超过 1 会被压到 1）
     *   - **不支持 prompt 缓存**（本仓的 prompt-cache 机制在此无效）
     *   - 要完整能力需原生 Messages API，那需要新写一个 provider（协议联合里目前只有 openai/gemini）
     *
     * baseUrl 用裸域名：`buildOpenAIUrl` 会补 `/v1/chat/completions`（官方建议 SDK 的 base_url 以 /v1 结尾，
     * 即等价于这个写法）。
     */
    provider: 'anthropic',
    displayName: 'Anthropic（Claude）',
    baseUrl: 'https://api.anthropic.com',
    protocol: 'openai',
    models: [
      { name: 'claude-opus-5-5', maxTokens: 64000 },
      { name: 'claude-sonnet-5', maxTokens: 64000 },
      { name: 'claude-fable-5-1', maxTokens: 64000 },
      { name: 'claude-haiku-4-5-20251001', maxTokens: 32000 },
    ],
    embeddingModels: [],
  },
  {
    /**
     * 小米 MiMo API 开放平台 —— OpenAI 兼容：`https://api.xiaomimimo.com/v1`。
     * 按量付费用这个地址；订阅制（Token Plan）是分区地址（`token-plan-{cn,sgp,ams}.xiaomimimo.com`），
     * 用户可在「自定义设置 → API 地址」里改。
     *
     * ⚠️ 模型列表留空：小米的模型 ID 会随版本变，不硬编码；点「获取可用模型」拿真实清单
     * （该地址支持 `/v1/models`），失败则手工填。
     */
    provider: 'xiaomi',
    displayName: '小米 MiMo',
    baseUrl: 'https://api.xiaomimimo.com',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
  },
  {
    provider: 'moonshot',
    displayName: 'Moonshot（Kimi）',
    baseUrl: 'https://api.moonshot.cn',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
  },
  {
    /** 阿里云通义千问 —— OpenAI 兼容通道在 /compatible-mode/v1（由 buildOpenAIUrl 补 /v1） */
    provider: 'dashscope',
    displayName: '通义千问（DashScope）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
  },
  {
    provider: 'siliconflow',
    displayName: 'SiliconFlow（硅基流动）',
    baseUrl: 'https://api.siliconflow.cn',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
  },
  {
    /** 聚合网关：一个 key 通多家模型，配合「获取可用模型」尤其好用 */
    provider: 'openrouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
  },
  {
    provider: 'groq',
    displayName: 'Groq',
    baseUrl: 'https://api.groq.com/openai',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
  },
  {
    provider: 'mistral',
    displayName: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
  },
  {
    provider: 'xai',
    displayName: 'xAI（Grok）',
    baseUrl: 'https://api.x.ai',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
  },
  {
    provider: 'yi',
    displayName: '零一万物（Yi）',
    baseUrl: 'https://api.lingyiwanwu.com',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
  },
  {
    provider: 'stepfun',
    displayName: '阶跃星辰（StepFun）',
    baseUrl: 'https://api.stepfun.com',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
  },
  {
    provider: 'baichuan',
    displayName: '百川智能',
    baseUrl: 'https://api.baichuan-ai.com',
    protocol: 'openai',
    models: [],
    embeddingModels: [],
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
