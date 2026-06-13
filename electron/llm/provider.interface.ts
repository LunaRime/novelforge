import { ModelProfile } from '../../src/shared/ipc-channels'

export interface LLMGenerateOptions {
  temperature: number
  maxTokens: number
  responseFormat?: { type: string }
  thinking?: boolean
  /** Prompt 缓存键（相同键的请求共享静态前缀缓存，节省 50% 输入费用） */
  cacheKey?: string
}

export interface LLMStreamOptions extends LLMGenerateOptions {
  signal: AbortSignal
  onChunk: (chunk: string) => void
  onDone: (fullText: string, usage?: { promptTokens: number; completionTokens: number; totalTokens: number }) => void
  onError: (error: string) => void
  /** 实时 Token 用量回调（流式传输中可用时触发） */
  onTokenUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void
}

export interface LLMResponse {
  success: boolean
  content: string
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
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
