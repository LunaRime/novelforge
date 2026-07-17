import { ILLMProvider, LLMGenerateOptions, LLMResponse, LLMStreamOptions } from './provider.interface'
import { ModelProfile } from '../../src/shared/ipc-channels'
import { withRetry } from './retry-handler'

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
      return { success: false, content: '', error: String(error) }
    })
  }

  async generateStream(model: ModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMStreamOptions): Promise<void> {
    try {
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
        opts.onError(`API 调用失败 (${res.status}): ${text}`)
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

      const hasMore = true
      while (hasMore) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        const lines = text.split('\n').filter((l) => l.startsWith('data: '))

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
          } catch {
            // ignore
          }
        }
      }

      if (isThinking) {
        const closeTag = '\n</think>\n\n'
        fullText += closeTag
        opts.onChunk(closeTag)
      }

      opts.onDone(fullText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim())
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        opts.onError('已取消生成')
      } else {
        opts.onError(String(error))
      }
    }
  }
}
