import { describe, it, expect, vi } from 'vitest'
import { withRetry } from './retry-handler'

// 带 HTTP 状态码的错误对象（模拟 openai/gemini provider 中的 HttpError）
class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success')
    const result = await withRetry(fn, { maxRetries: 2 })
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on 429 error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new HttpError(429, 'rate limit'))
      .mockResolvedValueOnce('ok')

    const result = await withRetry(fn, { maxRetries: 2, baseDelayMs: 0 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on 503 error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new HttpError(503, 'unavailable'))
      .mockResolvedValueOnce('ok')

    const result = await withRetry(fn, { maxRetries: 1, baseDelayMs: 0 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry on 400 error', async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError(400, 'bad request'))

    await expect(withRetry(fn, { maxRetries: 2 })).rejects.toThrow('bad request')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on 401 error', async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError(401, 'unauthorized'))

    await expect(withRetry(fn, { maxRetries: 2 })).rejects.toThrow('unauthorized')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError(429, 'always rate limited'))

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1 })
    ).rejects.toThrow('always rate limited')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('retries on network TypeError', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce('recovered')

    const result = await withRetry(fn, { maxRetries: 1, baseDelayMs: 0 })
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry on AbortError', async () => {
    const abortError = new Error('The user aborted a request')
    abortError.name = 'AbortError'
    const fn = vi.fn().mockRejectedValue(abortError)

    await expect(withRetry(fn, { maxRetries: 2 })).rejects.toThrow('aborted')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
