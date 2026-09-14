/**
 * embedding 服务测试 — 重点锁定 fetchWithTimeout 的 abort 兜底
 *
 * 背景（2026-08-29 冒烟实测根因）：embedding API 请求挂起（限流/网络）时，
 * 旧实现 setTimeout abort 触发后 undici 对挂起连接的 reject 可能延迟 ~20s，
 * 导致 IPC 30s 窗口内降级链来不及完成 → kb:import-text 三次超时 → 后处理管线中止。
 * 修复 = Promise.race 兜底：超时即 abort + 立即 reject，不依赖 fetch 对 abort 的响应及时性。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embedOpenAI, fetchWithTimeout } from './embedding'

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

/**
 * T1（Ollama 本地向量档）：fetchWithTimeout 导出 + 超时参数化。
 * T2 的 Ollama pull 是长任务（300s），需要复用同一个 abort 兜底实现而不改默认 10s 行为。
 */
describe('fetchWithTimeout 超时参数化（T1：Ollama pull 长任务复用）', () => {
  const URL = 'https://example.com/v1/embeddings'
  const INIT: RequestInit = { method: 'POST' }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('不传第三参 → 默认超时仍为 10s（挂起 fetch 在 10s 时刻 reject AbortError）', async () => {
    // 挂起连接：promise 永不 settle
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))

    const pending = fetchWithTimeout(URL, INIT)
    const rejection = pending.catch((e: Error) => e)

    await vi.advanceTimersByTimeAsync(EMBEDDING_TIMEOUT_MS + 1)

    const err = await rejection
    expect(err).toBeInstanceOf(Error)
    expect((err as DOMException).name).toBe('AbortError')
  })

  it('显式长超时 300s → 10s 不 reject，推进到 300s 才 reject AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))

    let settled: 'pending' | 'rejected' | 'resolved' = 'pending'
    const pending = fetchWithTimeout(URL, INIT, 300_000).then(
      () => { settled = 'resolved'; return null },
      (e: Error) => { settled = 'rejected'; return e },
    )

    // 跨过默认 10s 超时点：显式 300s 未到 → 不得 abort/reject（这正是 T2 依赖的行为）
    await vi.advanceTimersByTimeAsync(EMBEDDING_TIMEOUT_MS + 1)
    expect(settled).toBe('pending')

    // 推进到显式超时点 → abort + 立即 reject
    await vi.advanceTimersByTimeAsync(300_000 - EMBEDDING_TIMEOUT_MS)
    const err = await pending
    expect(settled).toBe('rejected')
    expect((err as DOMException).name).toBe('AbortError')
  })

  it('正常返回不误伤 → 返回 Response，signal 未被 abort，timer 已清理', async () => {
    const okResponse = { ok: true, status: 200 } as unknown as Response
    const calls: Array<[string, RequestInit]> = []
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      calls.push([url, init])
      return Promise.resolve(okResponse)
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await fetchWithTimeout(URL, INIT)
    expect(res).toBe(okResponse)

    // 真实传参断言：url 原样透传，signal 存在且未被 abort
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe(URL)
    expect(calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(calls[0][1].signal?.aborted).toBe(false)

    // 推进超时点后无异常（finally 已清 timer）
    await vi.advanceTimersByTimeAsync(EMBEDDING_TIMEOUT_MS + 1)
  })
})
