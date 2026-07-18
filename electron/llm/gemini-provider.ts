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

export class GeminiProvider implements ILLMProvider {
  private toGeminiContents(messages: Array<{ role: string; content: string }>) {
    let systemInstruction: string | undefined
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = msg.content
        continue
      }
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      })
    }
    return { contents, systemInstruction }
  }

  async generate(model: ModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMGenerateOptions): Promise<LLMResponse> {
    return withRetry(async () => {
      const baseUrl = model.baseUrl.replace(/\/$/, '')
      const url = `${baseUrl}/v1beta/models/${model.modelName}:generateContent`

      const { contents, systemInstruction } = this.toGeminiContents(messages)

      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: opts.temperature ?? model.temperature,
          maxOutputTokens: opts.maxTokens ?? model.maxTokens,
        },
      }
      if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] }
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': model.apiKey,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const errorMsg = `Gemini API 调用失败 (${res.status}): ${text}`
        if (res.status === 429 || res.status === 503 || res.status >= 500) {
          throw new HttpError(res.status, errorMsg)
        }
        return { success: false, content: '', error: errorMsg }
      }

      const data = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      const usage = data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata.totalTokenCount ?? 0,
      } : undefined

      return { success: true, content: text, usage }
    }).catch((error) => {
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
      const baseUrl = model.baseUrl.replace(/\/$/, '')
      const url = `${baseUrl}/v1beta/models/${model.modelName}:streamGenerateContent?alt=sse`

      const { contents, systemInstruction } = this.toGeminiContents(messages)

      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: opts.temperature ?? model.temperature,
          maxOutputTokens: opts.maxTokens ?? model.maxTokens,
        },
      }
      if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] }
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': model.apiKey,
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      })

      if (!res.ok) {
        const text = await res.text()
        const errorMsg = `Gemini API 调用失败 (${res.status}): ${text}`
        // 可重试的 HTTP 状态码 → 抛出以便 withStreamRetry 处理
        if (res.status === 429 || res.status === 503 || res.status >= 500) {
          throw new HttpError(res.status, errorMsg)
        }
        // 不可重试的错误 → 直接报错
        opts.onError(errorMsg)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        opts.onError('无法读取 Gemini 响应流')
        return
      }

      const decoder = new TextDecoder()
      let fullText = ''
      let failedChunkCount = 0
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined

      const hasMore = true
      while (hasMore) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        const lines = text.split('\n').filter((l) => l.startsWith('data: '))

        for (const line of lines) {
          const json = line.slice(6).trim()
          if (!json) continue
          try {
            const parsed = JSON.parse(json) as {
              candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
              usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
            }
            const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text
            if (chunk) {
              fullText += chunk
              opts.onChunk(chunk)
            }
            if (parsed.usageMetadata) {
              usage = {
                promptTokens: parsed.usageMetadata.promptTokenCount ?? 0,
                completionTokens: parsed.usageMetadata.candidatesTokenCount ?? 0,
                totalTokens: parsed.usageMetadata.totalTokenCount ?? 0,
              }
            }
          } catch (parseError) {
            failedChunkCount++
            logger.warn('LLM:Stream', `第 ${failedChunkCount} 次 chunk 解析失败: ${String(parseError).slice(0, 100)}`)
            if (failedChunkCount > 10) {
              const msg = `流式解析连续失败 ${failedChunkCount} 次，已中止`
              logger.error('LLM:Stream', msg)
              opts.onError(msg)
              return
            }
          }
        }
      }

      if (failedChunkCount > 0) {
        logger.warn('LLM:Stream', `流式生成完成，但有 ${failedChunkCount} 个 chunk 解析失败`)
      }
      opts.onDone(fullText, usage)
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
