import { ILLMProvider, LLMGenerateOptions, LLMResponse, LLMStreamOptions, ResolvedModelProfile } from './provider.interface'
import { LLMModelCandidate } from '../../src/shared/ipc-channels'
import { readListingJson, toCandidates } from './model-listing'
import { withRetry, withStreamRetry } from './retry-handler'
import { buildOpenAIUrl } from './url-utils'
import { safeErrorMessage } from '../utils/error-utils'
import { t } from '../../src/shared/locale'
import { proxyFetch } from '../net/proxy-fetch'
import { fetchWithTimeout } from '../net/fetch-with-timeout'
import { createStreamAdapter } from './stream-adapter'
import type { InternalStreamEvent } from '../../src/shared/llm-stream-events'
import type { LLMUsage } from './provider.interface'

/** 带 HTTP 状态码的错误对象，用于重试判断 */
class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export class OpenAIProvider implements ILLMProvider {
  async generate(model: ResolvedModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMGenerateOptions): Promise<LLMResponse> {
    return withRetry(async () => {
      const url = buildOpenAIUrl(model.baseUrl, 'chat')

      const body: Record<string, unknown> = {
        model: model.modelName,
        messages,
        max_tokens: opts.maxTokens ?? model.maxTokens,
        stream: false,
      }

      // 思考模式下 temperature/top_p 等参数不生效（DeepSeek 会静默忽略），仅在非思考模式下传递
      if (opts.thinking) {
        body.thinking = { type: 'enabled' }
      } else {
        body.temperature = opts.temperature
      }

      if (opts.responseFormat) body.response_format = opts.responseFormat

      const res = await proxyFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        // text 为服务端原始响应（可能含 $）→ 箭头函数 replacer 防 $& 语义
        const errorMsg = t('error.apiCallFailed').replace('{status}', String(res.status)).replace('{err}', () => text)
        // 抛出 HttpError 供 withRetry 判断是否可重试
        if (res.status === 429 || res.status === 503 || res.status >= 500) {
          throw new HttpError(res.status, errorMsg)
        }
        // 4xx（除 429）不重试，直接返回错误
        return { success: false, content: '', error: errorMsg }
      }

      const data = await res.json() as {
        choices: Array<{ message: { content: string; reasoning_content?: string } }>
        usage?: {
          prompt_tokens: number; completion_tokens: number; total_tokens: number
          // OpenAI: prompt_tokens_details.cached_tokens / DeepSeek: prompt_cache_hit_tokens
          prompt_cache_hit_tokens?: number
          prompt_tokens_details?: { cached_tokens?: number }
        }
      }

      let finalContent = data.choices?.[0]?.message?.content ?? ''
      finalContent = finalContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()

      return {
        success: true,
        content: finalContent,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
          cachedTokens: data.usage.prompt_cache_hit_tokens ?? data.usage.prompt_tokens_details?.cached_tokens ?? 0,
        } : undefined,
      }
    }).catch((error) => {
      // withRetry 耗尽重试后返回友好的错误
      if (error instanceof HttpError) {
        let errorMsg = error.message
        if (error.status === 429) {
          errorMsg = t('error.rateLimitExhausted')
        } else if (error.status === 503) {
          errorMsg = t('error.serviceUnavailableExhausted')
        } else if (error.status >= 500) {
          errorMsg = t('error.serverErrorExhausted').replace('{status}', String(error.status))
        }
        return { success: false, content: '', error: errorMsg }
      }
      return { success: false, content: '', error: safeErrorMessage(error) }
    })
  }

  async generateStream(model: ResolvedModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMStreamOptions): Promise<void> {
    // 已输出内容标记：中途断流（网络错误）不得重试——重试会重复推送已输出前缀
    let emittedAny = false
    await withStreamRetry(async () => {
      const url = buildOpenAIUrl(model.baseUrl, 'chat')

      const body: Record<string, unknown> = {
        model: model.modelName,
        messages,
        max_tokens: opts.maxTokens ?? model.maxTokens,
        stream: true,
      }

      // 思考模式下 temperature/top_p 等参数不生效（DeepSeek 会静默忽略），仅在非思考模式下传递
      if (opts.thinking) {
        body.thinking = { type: 'enabled' }
      } else {
        body.temperature = opts.temperature
      }

      if (opts.responseFormat) body.response_format = opts.responseFormat

      const res = await proxyFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      })

      if (!res.ok) {
        const text = await res.text()
        // text 为服务端原始响应（可能含 $）→ 箭头函数 replacer 防 $& 语义
        const errorMsg = t('error.apiCallFailed').replace('{status}', String(res.status)).replace('{err}', () => text)
        // 可重试的 HTTP 状态码 → 抛出以便 withStreamRetry 处理
        if (res.status === 429 || res.status === 503 || res.status >= 500) {
          throw new HttpError(res.status, errorMsg)
        }
        // 不可重试的错误（4xx 如 401/403）→ 直接报错
        opts.onError(errorMsg)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        opts.onError(t('error.streamReadFailed'))
        return
      }

      const decoder = new TextDecoder()
      let fullText = ''
      let isThinking = false
      let lastUsage: LLMUsage | undefined
      const adapter = createStreamAdapter('openai', model.modelName)
      if (!adapter) {
        opts.onError(t('error.streamReadFailed'))
        return
      }

      const consumeEvents = (events: InternalStreamEvent[]): boolean => {
        for (const event of events) {
          if (event.type === 'error') {
            opts.onError(event.message)
            return false
          }
          if (event.type === 'finish') {
            if (event.usage) lastUsage = event.usage
            continue
          }
          if (event.type === 'reasoning_delta') {
            let emit = ''
            if (!isThinking) {
              isThinking = true
              emit += ' thinking\n'
            }
            emit += event.delta
            fullText += emit
            emittedAny = true
            opts.onChunk(emit)
            continue
          }
          if (event.type === 'text_delta') {
            let emit = ''
            if (isThinking) {
              isThinking = false
              emit += '\n response\n\n'
            }
            emit += event.delta
            fullText += emit
            emittedAny = true
            opts.onChunk(emit)
            continue
          }
          if (event.type === 'tool_call_complete') {
            const xml = `<tool_call>${JSON.stringify({ name: event.name, arguments: event.args })}</tool_call>`
            fullText += xml
            emittedAny = true
            opts.onChunk(xml)
          }
        }
        return true
      }

      let reading = true
      while (reading) {
        const { done, value } = await reader.read()
        if (done) { reading = false; break }
        if (!consumeEvents(adapter.push(decoder.decode(value, { stream: true })))) return
      }
      if (!consumeEvents(adapter.flush())) return

      if (isThinking) {
        const closeTag = '\n response\n\n'
        fullText += closeTag
        opts.onChunk(closeTag)
      }

      const cleanText = fullText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()
      opts.onDone(cleanText, lastUsage)
    }, { canRetry: () => !emittedAny }).catch((error) => {
      // withStreamRetry 重试耗尽后的最终错误处理
      if ((error as Error).name === 'AbortError') {
        opts.onError(t('error.generationCancelled'))
      } else if (error instanceof HttpError) {
        let errorMsg = error.message
        if (error.status === 429) {
          errorMsg = t('error.rateLimitExhausted')
        } else if (error.status === 503) {
          errorMsg = t('error.serviceUnavailableExhausted')
        } else if (error.status >= 500) {
          errorMsg = t('error.serverErrorExhausted').replace('{status}', String(error.status))
        }
        opts.onError(errorMsg)
      } else {
        opts.onError(safeErrorMessage(error))
      }
    })
  }

  /**
   * 列出可用模型（`GET {baseUrl}/v1/models`，OpenAI 兼容协议的标准端点）。
   *
   * ⚠️ 不套 `withRetry`：这是用户点出来的交互式调用，失败应**立刻**给出可操作提示
   * （「该服务未提供模型列表，请手工填写模型 ID」），而不是让用户对着转圈等三次重试。
   */
  async listModels(credentials: { baseUrl: string; apiKey: string }): Promise<LLMModelCandidate[]> {
    const url = buildOpenAIUrl(credentials.baseUrl, 'models')
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${credentials.apiKey}` },
    })
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`)

    // 读取带上限（v3 §5）：地址是用户填的，配错的网关可以回一份巨大响应体
    const data = (await readListingJson(res)) as { data?: Array<Record<string, unknown>> }
    // 容量字段多拼写解析（context_length / max_tokens 等）——对齐 dsh readListing
    return toCandidates(data.data ?? [], (e) => (typeof e.id === 'string' ? e.id : undefined))
  }
}
