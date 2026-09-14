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
  // T1 nit：原为 `const URL`，遮蔽了全局 URL 构造器（同文件内再想用 `new URL(...)` 就会炸）→ 改名
  const EMBEDDINGS_URL = 'https://example.com/v1/embeddings'
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

    // T1 M1：原用例只锁**上界**（advance(10_001) 后要求 reject → 任何 ≤10_001 的默认值都绿）。
    // 先推进到超时点**之前** 1ms 断言仍未 settle，再推进 1ms → 同时锁住下界与上界。
    let settled: 'pending' | 'rejected' | 'resolved' = 'pending'
    const pending = fetchWithTimeout(EMBEDDINGS_URL, INIT).then(
      () => { settled = 'resolved'; return null },
      (e: Error) => { settled = 'rejected'; return e },
    )

    await vi.advanceTimersByTimeAsync(EMBEDDING_TIMEOUT_MS - 1)
    expect(settled).toBe('pending') // 9_999ms 时**不得**已超时（下界）

    await vi.advanceTimersByTimeAsync(1)
    const err = await pending
    expect(settled).toBe('rejected')
    expect(err).toBeInstanceOf(Error)
    expect((err as DOMException).name).toBe('AbortError')
  })

  it('显式长超时 300s → 10s 不 reject，推进到 300s 才 reject AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))

    let settled: 'pending' | 'rejected' | 'resolved' = 'pending'
    const pending = fetchWithTimeout(EMBEDDINGS_URL, INIT, 300_000).then(
      () => { settled = 'resolved'; return null },
      (e: Error) => { settled = 'rejected'; return e },
    )

    // 跨过默认 10s 超时点：显式 300s 未到 → 不得 abort/reject（这正是 T2 依赖的行为）
    const pastDefault = EMBEDDING_TIMEOUT_MS + 1
    await vi.advanceTimersByTimeAsync(pastDefault)
    expect(settled).toBe('pending')

    // 推进**到**显式超时点。T1 M3：原为 `300_000 - EMBEDDING_TIMEOUT_MS`（未扣除上面那 1ms）→
    // 累计 300_001ms，多推进 1ms 掩盖了显式值偏大 1ms 的实现。这里补齐 1ms，总时长正好 300_000ms。
    await vi.advanceTimersByTimeAsync(300_000 - pastDefault)
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

    const res = await fetchWithTimeout(EMBEDDINGS_URL, INIT)
    expect(res).toBe(okResponse)

    // 真实传参断言：url 原样透传，signal 存在且未被 abort
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe(EMBEDDINGS_URL)
    expect(calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(calls[0][1].signal?.aborted).toBe(false)
    // 立刻返回时超时 timer 已清（`finally` 在 Promise.race 落地后即 clearTimeout）
    expect(vi.getTimerCount()).toBe(0)

    // T1 M2：原断言在此**推进之前**求值 → 「timer 已清理」其实从未被断言（推进后无异常并不能
    // 区分「timer 被清」与「timer 触发但 abort 无副作用」）。改为推进之后直接数残留 timer：
    // 若 `fetchWithTimeout` 的 `finally` 漏掉 `clearTimeout`，此处会是 1 → 转红。
    await vi.advanceTimersByTimeAsync(EMBEDDING_TIMEOUT_MS + 1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
