/**
 * embedding 服务测试 — 重点锁定 fetchWithTimeout 的 abort 兜底
 *
 * 背景（2026-08-29 冒烟实测根因）：embedding API 请求挂起（限流/网络）时，
 * 旧实现 setTimeout abort 触发后 undici 对挂起连接的 reject 可能延迟 ~20s，
 * 导致 IPC 30s 窗口内降级链来不及完成 → kb:import-text 三次超时 → 后处理管线中止。
 * 修复 = Promise.race 兜底：超时即 abort + 立即 reject，不依赖 fetch 对 abort 的响应及时性。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embedOpenAI } from './embedding'

const EMBEDDING_TIMEOUT_MS = 10_000

describe('embedOpenAI fetchWithTimeout（abort 兜底，2026-08-29 根因修复）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('fetch 挂起（永不 settle）→ 超时后立即 reject AbortError（不等待 undici 延迟）', async () => {
    // 挂起连接：promise 永不 settle——旧实现下 abort 后 reject 延迟，此测试挂起/超时
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))

    const pending = embedOpenAI(['测试文本'], { baseUrl: 'https://example.com/v1', apiKey: 'sk-test' })
    const rejection = pending.catch((e: Error) => e)

    // 推进到超时点：abort + race 立即 reject（应在超时时刻完成，而非等待 undici 延迟）
    await vi.advanceTimersByTimeAsync(EMBEDDING_TIMEOUT_MS + 1)

    const err = await rejection
    expect(err).toBeInstanceOf(Error)
    expect((err as DOMException).name).toBe('AbortError')
  })

  it('正常响应 → resolve（超时 timer 清理，无 abort 副作用）', async () => {
    const okResponse = {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }] }),
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn(async () => okResponse))

    const result = await embedOpenAI(['测试'], { baseUrl: 'https://example.com/v1', apiKey: 'sk-test' })
    expect(result).toEqual([[0.1, 0.2, 0.3]])

    // 推进超时点后无异常（timer 已清理）
    await vi.advanceTimersByTimeAsync(EMBEDDING_TIMEOUT_MS + 1)
  })

  it('fetch 快速 reject（网络错误）→ 错误传播不被吞', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))

    await expect(
      embedOpenAI(['测试'], { baseUrl: 'https://example.com/v1', apiKey: 'sk-test' }),
    ).rejects.toThrow('fetch failed')
  })
})
