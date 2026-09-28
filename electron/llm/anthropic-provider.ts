import { ILLMProvider, LLMGenerateOptions, LLMResponse, LLMStreamOptions, LLMUsage } from './provider.interface'
import { ModelProfile } from '../../src/shared/ipc-channels'
import { withRetry, withStreamRetry } from './retry-handler'
import { safeErrorMessage } from '../utils/error-utils'
import { t } from '../../src/shared/locale'
import { proxyFetch } from '../net/proxy-fetch'
import { fetchWithTimeout } from '../net/fetch-with-timeout'

/**
 * Anthropic 原生 Messages API 协议（2026-09-28，照 deepseek-harness 的"小 translator + 显式责任"模式）。
 *
 * 与 OpenAI 兼容层的差异（本 provider 存在的理由）：
 * - 端点 `{root}/v1/messages`；鉴权 `x-api-key` + `anthropic-version`（Bearer 不适用）
 * - system 提为顶层字段（多条合并）；`max_tokens` **必填**
 * - SSE 事件帧（message_start / content_block_delta / message_delta / message_stop），usage 分两处
 *
 * 流式契约（dsh 教训）：**usage 先于 finish 交付、finish 后不再产出**。
 * 错误契约：失败一律抛带 `status` 的 `HttpError`（见 provider.interface.ts 尾注），重试只看 status。
 * 本仓无 tool-calling，不做 tool 块映射；`response_format` 在 Anthropic 无等价参数，不发送
 * （依赖调用方的提示词约束与 JSON 提取兜底——与兼容层现状持平，非回归）。
 */

/** 带 HTTP 状态码的错误对象（与 openai-provider 同款局部类；调用方按鸭子类型的 status 判定） */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/** root 归一化：去尾斜杠、去一层 `/v1` —— 用户可能填裸域名 / 尾斜杠 / 已含 /v1（Review Focus 4） */
function anthropicRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
}

export interface AnthropicBody {
  model: string
  max_tokens: number
  temperature?: number
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** 流式专用：**缺了它 Anthropic 返回单条 JSON 而非 SSE**，解析器会零事件静默空交付（复核 Critical 1） */
  stream?: boolean
}

/** 构造 Messages API 请求（纯函数，直测）。`stream=true` 时请求 SSE 响应（generateStream 专用）。 */
export function toAnthropicRequest(
  model: ModelProfile,
  messages: Array<{ role: string; content: string }>,
  opts?: Pick<LLMGenerateOptions, 'temperature' | 'maxTokens'>,
  stream = false,
): { url: string; headers: Record<string, string>; body: AnthropicBody } {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content)
  const body: AnthropicBody = {
    model: model.modelName,
    // Anthropic 拒绝缺失/空 max_tokens（Review Focus 3）
    max_tokens: opts?.maxTokens ?? model.maxTokens ?? 4096,
    messages: messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content })),
  }
  if (stream) body.stream = true
  if (systemParts.length > 0) body.system = systemParts.join('\n\n')

  const temperature = opts?.temperature ?? model.temperature
  if (typeof temperature === 'number' && !Number.isNaN(temperature)) {
    // API 固有上限 [0,1]（本仓允许 0–2；>1 会 400，非兼容层特有）
    body.temperature = Math.min(Math.max(temperature, 0), 1)
  }

  return {
    url: `${anthropicRoot(model.baseUrl)}/v1/messages`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': model.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body,
  }
}

export type AnthropicStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'finish' }
  | { type: 'error'; message: string }

/**
 * 增量 SSE 解析器（行缓冲，跨 chunk 分片安全 —— Review Focus 1）。
 * 返回的函数接受任意切分的 chunk；空行为事件边界；非 JSON/心跳帧容忍忽略；
 * `message_stop` 时**先 emit usage 再 emit finish**，之后一切输入被忽略（流式契约）。
 */
export function createAnthropicStreamParser(emit: (e: AnthropicStreamEvent) => void): (chunk: string) => void {
  let buffer = ''
  let finished = false
  let inputTokens = 0
  let outputTokens = 0

  const handleEventBlock = (block: string) => {
    if (finished) return
    const dataLines = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
    if (dataLines.length === 0) return

    let payload: {
      type?: string
      message?: { usage?: { input_tokens?: number; output_tokens?: number } }
      usage?: { output_tokens?: number }
      delta?: { type?: string; text?: string }
      error?: { message?: string }
    }
    try {
      payload = JSON.parse(dataLines.join('\n'))
    } catch {
      return // 半帧/非 JSON（如网关插话）：忽略，不崩
    }

    switch (payload.type) {
      case 'message_start':
        inputTokens = payload.message?.usage?.input_tokens ?? 0
        return
      case 'content_block_delta':
        if (payload.delta?.type === 'text_delta' && typeof payload.delta.text === 'string') {
          emit({ type: 'text', text: payload.delta.text })
        }
        return
      case 'message_delta':
        if (typeof payload.usage?.output_tokens === 'number') outputTokens = payload.usage.output_tokens
        return
      case 'message_stop':
        emit({ type: 'usage', inputTokens, outputTokens }) // usage 先于 finish
        emit({ type: 'finish' })
        finished = true
        return
      case 'error':
        // 中流错误是 HTTP 200 里的事件（如 overloaded_error）——不交给 HTTP 层兜底，直接上报并停止
        // （复核 Important 3：吞掉它会让半截文本按成功交付）
        emit({ type: 'error', message: payload.error?.message ?? 'stream error' })
        finished = true
        return
      default:
        return // ping / content_block_start|stop 等：不产出
    }
  }

  return (chunk: string) => {
    if (finished) return
    // CRLF 容忍：`\r\n` 在**拼接后**统一归一为 `\n`（跨 chunk 的 \r|\n 拆分在此合并）；
    // 不归一则 `\r\n\r\n` 中不存在 `\n\n` 子串，事件永不切块、全程静默（复核 Important 4）
    buffer = (buffer + chunk).replace(/\r\n/g, '\n')
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      handleEventBlock(block)
      if (finished) return
    }
  }
}

/** 把非 2xx 响应体映射成带 status 的错误（HTML 错误页容忍 —— Review Focus 5）。 */
export function mapAnthropicError(status: number, bodyText: string): HttpError {
  let message = bodyText.slice(0, 200)
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } }
    if (parsed.error?.message) message = parsed.error.message
  } catch {
    /* 非 JSON：保留截断原文 */
  }
  return new HttpError(status, message)
}

/** Anthropic Messages 响应体的最小形状 */
interface AnthropicMessagesResponse {
  content?: Array<{ type?: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

function toUsage(usage: AnthropicMessagesResponse['usage']): LLMUsage | undefined {
  if (!usage) return undefined
  const promptTokens = usage.input_tokens ?? 0
  const completionTokens = usage.output_tokens ?? 0
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
}

export class AnthropicProvider implements ILLMProvider {
  async generate(model: ModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMGenerateOptions): Promise<LLMResponse> {
    return withRetry(async () => {
      const req = toAnthropicRequest(model, messages, opts)
      const res = await proxyFetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const errorMsg = t('error.apiCallFailed').replace('{status}', String(res.status)).replace('{err}', () => text)
        // 可重试的状态抛 HttpError 交给 withRetry（与 openai-provider 同口径）
        if (res.status === 429 || res.status === 503 || res.status >= 500) {
          throw new HttpError(res.status, errorMsg)
        }
        return { success: false, content: '', error: errorMsg }
      }

      const data = (await res.json()) as AnthropicMessagesResponse
      // Anthropic 的 thinking 是独立块（type:'thinking'）——只取 text 块；<think> 清理保留作保险
      const textBlock = data.content?.find((b) => b.type === 'text')
      const finalContent = (textBlock?.text ?? '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()
      return { success: true, content: finalContent, usage: toUsage(data.usage) }
    }).catch((error) => {
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

  async generateStream(model: ModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMStreamOptions): Promise<void> {
    // 已输出内容标记：中途断流不得重试（重试会重复推送已输出前缀）
    let emittedAny = false
    await withStreamRetry(async () => {
      const req = toAnthropicRequest(model, messages, opts, true)
      const res = await proxyFetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: opts.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const errorMsg = t('error.apiCallFailed').replace('{status}', String(res.status)).replace('{err}', () => text)
        if (res.status === 429 || res.status === 503 || res.status >= 500) {
          throw new HttpError(res.status, errorMsg)
        }
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
      let lastUsage: LLMUsage | undefined
      /** 中流错误已上报：此后不得再走 onDone（成功回调），否则半截文本被按成功交付 */
      let streamErrored = false
      const parser = createAnthropicStreamParser((e) => {
        if (e.type === 'text') {
          fullText += e.text
          emittedAny = true
          opts.onChunk(e.text)
        } else if (e.type === 'usage') {
          lastUsage = {
            promptTokens: e.inputTokens,
            completionTokens: e.outputTokens,
            totalTokens: e.inputTokens + e.outputTokens,
          }
          opts.onTokenUsage?.(lastUsage)
        } else if (e.type === 'error') {
          streamErrored = true
          opts.onError(e.message)
        }
      })

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parser(decoder.decode(value, { stream: true }))
      }

      if (streamErrored) return
      opts.onDone(fullText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim(), lastUsage)
    }, { canRetry: () => !emittedAny }).catch((error) => {
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
   * 列出可用模型（`GET {root}/v1/models?limit=1000`，x-api-key）。
   * 不套 withRetry（与 openai-provider 一致）：交互式调用，失败立刻给可操作提示。
   */
  async listModels(credentials: { baseUrl: string; apiKey: string }): Promise<string[]> {
    const url = `${anthropicRoot(credentials.baseUrl)}/v1/models?limit=1000`
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'x-api-key': credentials.apiKey,
        'anthropic-version': '2023-06-01',
      },
    })
    if (!res.ok) throw mapAnthropicError(res.status, await res.text().catch(() => ''))

    const data = (await res.json()) as { data?: Array<{ id?: unknown }> }
    return (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id !== '')
  }
}
