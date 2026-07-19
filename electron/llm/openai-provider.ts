import { ILLMProvider, LLMGenerateOptions, LLMResponse, LLMStreamOptions } from './provider.interface'
import { ModelProfile } from '../../src/shared/ipc-channels'
import { withRetry, withStreamRetry } from './retry-handler'
import { logger } from '../utils/logger'
import { safeErrorMessage } from '../utils/error-utils'

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
  private buildUrl(baseUrl: string): string {
    const base = baseUrl.replace(/\/$/, '')
    // 如果 baseUrl 已经带了完整 /v1/chat 路径，直接用
    if (base.endsWith('/v1/chat')) {
      return `${base}/completions`
    }
    // 否则补全完整路径
    return `${base}/v1/chat/completions`
  }

  async generate(model: ModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMGenerateOptions): Promise<LLMResponse> {
    return withRetry(async () => {
      const url = this.buildUrl(model.baseUrl)

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
        body.temperature = opts.temperature ?? model.temperature
      }

      if (opts.responseFormat) body.response_format = opts.responseFormat

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const errorMsg = `API 调用失败 (${res.status}): ${text}`
        // 抛出 HttpError 供 withRetry 判断是否可重试
        if (res.status === 429 || res.status === 503 || res.status >= 500) {
          throw new HttpError(res.status, errorMsg)
        }
        // 4xx（除 429）不重试，直接返回错误
        return { success: false, content: '', error: errorMsg }
      }

      const data = await res.json() as {
        choices: Array<{ message: { content: string; reasoning_content?: string } }>
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
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
        } : undefined,
      }
    }).catch((error) => {
      // withRetry 耗尽重试后返回友好的错误
      if (error instanceof HttpError) {
        let errorMsg = error.message
        if (error.status === 429) {
          errorMsg = `请求过于频繁 (429)，已重试多次仍失败。请稍后重试或降低并发数。`
        } else if (error.status === 503) {
          errorMsg = `服务暂时不可用 (503)，已重试多次仍失败。请稍后重试。`
        } else if (error.status >= 500) {
          errorMsg = `服务器错误 (${error.status})，已重试多次仍失败。`
        }
        return { success: false, content: '', error: errorMsg }
      }
      return { success: false, content: '', error: safeErrorMessage(error) }
    })
  }

  async generateStream(model: ModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMStreamOptions): Promise<void> {
    await withStreamRetry(async () => {
      const url = this.buildUrl(model.baseUrl)

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
        body.temperature = opts.temperature ?? model.temperature
      }

      if (opts.responseFormat) body.response_format = opts.responseFormat

      const res = await fetch(url, {
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
        const errorMsg = `API 调用失败 (${res.status}): ${text}`
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
        opts.onError('无法读取响应流')
        return
      }

      const decoder = new TextDecoder()
      let fullText = ''
      let isThinking = false
      let failedChunkCount = 0
      let buffer = '' // 跨 read 边界的行缓冲

      const hasMore = true
      while (hasMore) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        // 按完整行分割，最后一段（可能不完整）留在 buffer 中
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''
        const lines = parts.filter((l) => l.startsWith('data: '))

        for (const line of lines) {
          const json = line.slice(6).trim()
          if (json === '[DONE]') continue
          try {
            const parsed = JSON.parse(json) as {
              choices: Array<{ delta: { content?: string, reasoning_content?: string } }>
            }
            const delta = parsed.choices?.[0]?.delta

            let emitChunk = ''

            // 如果存在思维链内容
            if (delta?.reasoning_content) {
              if (!isThinking) {
                isThinking = true
                emitChunk += '<think>\n'
              }
              emitChunk += delta.reasoning_content
            }

            // 如果开始输出正文
            if (delta?.content !== undefined && delta?.content !== null) {
              if (isThinking) {
                isThinking = false
                emitChunk += '\n</think>\n\n'
              }
              if (delta?.content) {
                emitChunk += delta.content
              }
            }

            if (emitChunk) {
              fullText += emitChunk
              opts.onChunk(emitChunk)
            }
          } catch (parseError) {
            failedChunkCount++
            const snippet = json.slice(0, 200)
            logger.warn('LLM:Stream', `第 ${failedChunkCount} 次 chunk 解析失败: ${String(parseError).slice(0, 100)} | chunk: ${snippet}`)
            // 连续失败超过 10 次 → 中止流并报错
            if (failedChunkCount > 10) {
              const msg = `流式解析连续失败 ${failedChunkCount} 次，已中止`
              logger.error('LLM:Stream', msg)
              opts.onError(msg)
              return
            }
          }
        }
      }

      if (isThinking) {
        const closeTag = '\n</think>\n\n'
        fullText += closeTag
        opts.onChunk(closeTag)
      }

      if (failedChunkCount > 0) {
        logger.warn('LLM:Stream', `流式生成完成，但有 ${failedChunkCount} 个 chunk 解析失败`)
      }
      opts.onDone(fullText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim())
    }).catch((error) => {
      // withStreamRetry 重试耗尽后的最终错误处理
      if ((error as Error).name === 'AbortError') {
        opts.onError('已取消生成')
      } else if (error instanceof HttpError) {
        let errorMsg = error.message
        if (error.status === 429) {
          errorMsg = `请求过于频繁 (429)，已重试多次仍失败。请稍后重试或降低并发数。`
        } else if (error.status === 503) {
          errorMsg = `服务暂时不可用 (503)，已重试多次仍失败。请稍后重试。`
        } else if (error.status >= 500) {
          errorMsg = `服务器错误 (${error.status})，已重试多次仍失败。`
        }
        opts.onError(errorMsg)
      } else {
        opts.onError(safeErrorMessage(error))
      }
    })
  }
}
