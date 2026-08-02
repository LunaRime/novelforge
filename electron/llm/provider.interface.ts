import { ModelProfile } from '../../src/shared/ipc-channels'

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
    model: ModelProfile,
    messages: Array<{ role: string; content: string }>,
    opts: LLMGenerateOptions
  ): Promise<LLMResponse>

  /** 流式生成 */
  generateStream(
    model: ModelProfile,
    messages: Array<{ role: string; content: string }>,
    opts: LLMStreamOptions
  ): Promise<void>
}
