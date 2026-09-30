import { ModelProfile, LLMModelCandidate } from '../../src/shared/ipc-channels'

/**
 * **已解析密钥**的模型条目（v3 §3.2）—— provider 侧的入参类型。
 *
 * `ModelProfile` 上**没有** `apiKey`（密钥只住在凭据库/env，配置文件与 IPC 都不携带），
 * 于是「把条目交给 provider」这件事在类型上就必经一次 resolve：没解析就没有 `apiKey`，
 * 编译不过。解析点见 `electron/credentials/resolve.ts` 的 `resolveRequestKey`。
 *
 * ⚠️ 字段是**明文**：密文串一旦被当密钥发出去，故障表现是 401 且极难排查 ——
 * 所以构造它只有 resolve 一条路，不要把盘上读到的原始值塞进来。
 */
export type ResolvedModelProfile = ModelProfile & { apiKey: string }

export interface LLMGenerateOptions {
  temperature: number
  maxTokens: number
  responseFormat?: { type: string }
  thinking?: boolean
  /** Prompt 缓存键（相同键的请求共享静态前缀缓存，节省 50% 输入费用） */
  cacheKey?: string
}

/** LLM 用量（含真实缓存命中 token：OpenAI prompt_tokens_details.cached_tokens / DeepSeek prompt_cache_hit_tokens） */
export interface LLMUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** API 返回的真实缓存命中输入 token 数（无缓存字段时为 0） */
  cachedTokens?: number
}

export interface LLMStreamOptions extends LLMGenerateOptions {
  signal: AbortSignal
  onChunk: (chunk: string) => void
  onDone: (fullText: string, usage?: LLMUsage) => void
  onError: (error: string) => void
  /** 实时 Token 用量回调（流式传输中可用时触发） */
  onTokenUsage?: (usage: LLMUsage) => void
}

export interface LLMResponse {
  success: boolean
  content: string
  usage?: LLMUsage
  error?: string
}

export interface ILLMProvider {
  /** 非流式生成 */
  generate(
    model: ResolvedModelProfile,
    messages: Array<{ role: string; content: string }>,
    opts: LLMGenerateOptions
  ): Promise<LLMResponse>

  /** 流式生成 */
  generateStream(
    model: ResolvedModelProfile,
    messages: Array<{ role: string; content: string }>,
    opts: LLMStreamOptions
  ): Promise<void>

  /**
   * 列出该凭据下可用的模型（「获取可用模型」用，2026-09-25；2026-09-28 起带容量规格）。
   *
   * ⚠️ 只收**凭据**而不是整个 `ModelProfile`：列模型发生在「账户已填、模型还没勾选」的时刻，
   * 那时根本没有模型可传 —— 传 profile 就得伪造一个假的。
   *
   * 失败时 **throw**（由调用方转成用户可读错误）—— 中转/自建服务未必实现该端点，
   * 拿到 404/空列表属预期情况，不是异常。
   */
  listModels(credentials: { baseUrl: string; apiKey: string }): Promise<LLMModelCandidate[]>
}

/**
 * 错误契约（2026-09-28 加协议前码化，源自 deepseek-harness 的教训）：
 * **失败一律抛带 `status` 的 `HttpError`**（或等价携带 HTTP 状态的对象），调用方与
 * retry-handler 只按 status/code 判定，**绝不解析 message 文本** —— 否则每加一个协议
 * 就要重写一份文本正则。新写 provider 时对照本契约。
 */
