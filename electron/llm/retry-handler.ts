/**
 * LLM 调用重试处理器 — 指数退避 + 智能重试判断
 *
 * 仅对可重试的错误类型重试：
 * - 429 (Rate Limit) — 等待后重试
 * - 503 (Service Unavailable) — 临时故障
 * - 网络超时/连接重置 (ECONNRESET, ETIMEDOUT, ENOTFOUND, ECONNREFUSED)
 * - 5xx 服务端错误
 *
 * 不重试：
 * - 4xx (除 429) — 客户端错误（API key 无效、参数错误等）
 */
import { logger } from '../utils/logger'

export interface RetryOptions {
  /** 最大重试次数（默认 3） */
  maxRetries?: number
  /** 基础延迟毫秒（默认 1000） */
  baseDelayMs?: number
  /** 最大延迟毫秒（默认 30000） */
  maxDelayMs?: number
}

/** 判断错误是否可重试 */
function isRetryableError(error: unknown): boolean {
  // HTTP 状态码错误（fetch 响应非 2xx）
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    // 429 Rate Limit、503 Service Unavailable、5xx 服务端错误 → 可重试
    if (status === 429 || status === 503 || status >= 500) return true
    // 4xx 客户端错误 → 不重试
    return false
  }

  // 网络层错误
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase()
    // fetch 网络失败时抛出 TypeError
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('abort')) {
      // AbortError (用户取消) → 不重试
      if (msg.includes('abort')) return false
      return true
    }
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    // Node.js 网络错误码
    if (
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound') ||
      msg.includes('econnrefused') ||
      msg.includes('socket') ||
      msg.includes('network')
    ) {
      return true
    }
  }

  // 字符串形式的错误
  if (typeof error === 'string') {
    const lower = error.toLowerCase()
    if (
      lower.includes('econnreset') ||
      lower.includes('etimedout') ||
      lower.includes('timeout') ||
      lower.includes('network')
    ) {
      return true
    }
  }

  return false
}

/**
 * 指数退避重试包装器
 *
 * @param fn - 要执行的异步函数
 * @param options - 重试选项
 * @returns 函数返回值（成功时）或抛出最后一次错误
 *
 * 延迟公式：min(baseDelay * 2^(attempt-1) + random(0, 1000), maxDelay)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
  } = options

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // 最后一次尝试已用完 → 抛出错误
      if (attempt >= maxRetries) break

      // 检查是否可重试
      if (!isRetryableError(error)) {
        logger.debug('LLM:Retry', `不可重试的错误，直接返回: ${String(error).slice(0, 200)}`)
        throw error
      }

      // 计算退避延迟
      const jitter = Math.floor(Math.random() * 1001) // 0-1000ms 随机抖动
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt) + jitter, maxDelayMs)

      const statusInfo = (error && typeof error === 'object' && 'status' in error)
        ? ` (HTTP ${(error as { status: number }).status})`
        : ''

      logger.warn(
        'LLM:Retry',
        `第 ${attempt + 1}/${maxRetries} 次重试，等待 ${delay}ms${statusInfo}: ${String(error).slice(0, 200)}`,
      )

      await sleep(delay)
    }
  }

  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
