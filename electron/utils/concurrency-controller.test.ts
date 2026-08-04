import { describe, it, expect } from 'vitest'
import { ConcurrencyController } from './concurrency-controller'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

describe('ConcurrencyController', () => {
  it('直接执行时指定 timeoutMs=0 不超时', async () => {
    const ctrl = new ConcurrencyController({ maxConcurrent: 1, defaultTimeoutMs: 20 })
    const result = await ctrl.execute(async () => {
      await delay(60)
      return 'ok'
    }, { timeoutMs: 0 })
    expect(result).toBe('ok')
  })

  it('排队请求保留调用方指定的 timeoutMs=0（不因排队回落默认超时）', async () => {
    const ctrl = new ConcurrencyController({ maxConcurrent: 1, maxQueueSize: 10, defaultTimeoutMs: 30 })
    let releaseBlocked!: () => void
    const blocked = new Promise<void>((r) => { releaseBlocked = r })
    const first = ctrl.execute(() => blocked, { timeoutMs: 0 }) // 占住唯一槽位（不超时）
    const second = ctrl.execute(async () => 'done', { timeoutMs: 0 }) // 排队 + 无超时

    await delay(60) // 超过 defaultTimeoutMs(30ms)，仍在排队
    releaseBlocked() // 释放槽位
    await first

    expect(await second).toBe('done') // 排队执行未被默认超时截断
  })

  it('排队请求未指定 timeoutMs 时沿用默认超时（开始执行后超时则拒绝）', async () => {
    const ctrl = new ConcurrencyController({ maxConcurrent: 1, maxQueueSize: 10, defaultTimeoutMs: 30 })
    let releaseBlocked!: () => void
    const blocked = new Promise<void>((r) => { releaseBlocked = r })
    const first = ctrl.execute(() => blocked, { timeoutMs: 0 }) // 占住槽位
    const second = ctrl.execute(async () => { await delay(100); return 'done' }) // 排队 + 默认 30ms，执行耗时 100ms

    releaseBlocked() // 释放槽位，second 开始执行 → 30ms 后超时拒绝
    await first
    await expect(second).rejects.toThrow('请求超时')
  })
})
