import { ILLMProvider, LLMGenerateOptions, LLMResponse, LLMStreamOptions } from './provider.interface'
import { ModelProfile } from '../../src/shared/ipc-channels'
import { withRetry, withStreamRetry } from './retry-handler'
import { logger } from '../utils/logger'
import { safeErrorMessage } from '../utils/error-utils'
import { t } from '../../src/shared/locale'

/** 带 HTTP 状态码的错误对象，用于重试判断 */
class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/**
 * 将 NovelForge messages 转换为 Gemini 的 contents + systemInstruction。
 * 导出为纯函数便于单元测试（Gemini 只接受单一 systemInstruction）。
 */
export function toGeminiContents(messages: Array<{ role: string; content: string }>): {
  contents: Array<{ role: string; parts: Array<{ text: string }> }>
  systemInstruction?: string
} {
  const systemParts: string[] = []
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      // structureForCache 会产生多条 system（systemRole + staticContext 前缀缓存结构）
      // Gemini API 只接受单一 systemInstruction —— 必须全部合并，
      // 否则后写覆盖先写会导致 systemRole 丢失（模型无角色约束 → 输出质量下降）
      systemParts.push(msg.content)
      continue
    }
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    })
  }
  return {
    contents,
    systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
  }
}

export class GeminiProvider implements ILLMProvider {

  async generate(model: ModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMGenerateOptions): Promise<LLMResponse> {
    return withRetry(async () => {
      const baseUrl = model.baseUrl.replace(/\/$/, '')
      const url = `${baseUrl}/v1beta/models/${model.modelName}:generateContent`

      const { contents, systemInstruction } = toGeminiContents(messages)

      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          // 思考模式：Gemini 对应 thinkingConfig（此前未映射，思考开关对 Gemini 静默无效）；
          // 思考时省略 temperature（Gemini 思考模式下 temperature 不生效，与 OpenAI 行为对齐）
          ...(opts.thinking
            ? { thinkingConfig: { includeThoughts: true } }
            : { temperature: opts.temperature ?? model.temperature }),
          maxOutputTokens: opts.maxTokens ?? model.maxTokens,
          // JSON 约束（与 OpenAI response_format 对应）：强制结构化输出，降低幻觉/解析失败
          ...(opts.responseFormat?.type === 'json_object'
            ? { responseMimeType: 'application/json' }
            : {}),
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
        // text 为服务端原始响应（可能含 $）→ 箭头函数 replacer 防 $& 语义
        const errorMsg = t('error.geminiApiCallFailed').replace('{status}', String(res.status)).replace('{err}', () => text)
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
        cachedTokens: 0, // Gemini 无缓存命中计数字段（缓存机制不同）
      } : undefined

      return { success: true, content: text, usage }
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
    await withStreamRetry(async () => {
      const baseUrl = model.baseUrl.replace(/\/$/, '')
      const url = `${baseUrl}/v1beta/models/${model.modelName}:streamGenerateContent?alt=sse`

      const { contents, systemInstruction } = toGeminiContents(messages)

      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          // 思考模式 → thinkingConfig（与 generate 对齐）
          ...(opts.thinking
            ? { thinkingConfig: { includeThoughts: true } }
            : { temperature: opts.temperature ?? model.temperature }),
          maxOutputTokens: opts.maxTokens ?? model.maxTokens,
          // JSON 约束（与 OpenAI response_format 对应）：强制结构化输出，降低幻觉/解析失败
          ...(opts.responseFormat?.type === 'json_object'
            ? { responseMimeType: 'application/json' }
            : {}),
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
        // text 为服务端原始响应（可能含 $）→ 箭头函数 replacer 防 $& 语义
        const errorMsg = t('error.geminiApiCallFailed').replace('{status}', String(res.status)).replace('{err}', () => text)
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
        opts.onError(t('error.geminiStreamReadFailed'))
        return
      }

      const decoder = new TextDecoder()
      let fullText = ''
      let failedChunkCount = 0
      let buffer = '' // 跨 read 边界的行缓冲
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined

      const hasMore = true
      while (hasMore) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''
        const lines = parts.filter((l) => l.startsWith('data: '))

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
            logger.warn('LLM:Stream', t('log.llmStream.chunkParseFailed')
              .replace('{n}', String(failedChunkCount))
              .replace('{err}', String(parseError).slice(0, 100)))
            if (failedChunkCount > 10) {
              const msg = t('log.llmStream.aborted').replace('{n}', String(failedChunkCount))
              logger.error('LLM:Stream', msg)
              opts.onError(msg)
              return
            }
          }
        }
      }

      if (failedChunkCount > 0) {
        logger.warn('LLM:Stream', t('log.llmStream.chunkParseFailures').replace('{n}', String(failedChunkCount)))
      }
      opts.onDone(fullText, usage)
    }).catch((error) => {
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
}
