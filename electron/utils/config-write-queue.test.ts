/**
 * 串行写队列（模型管理 v3 §5「写入：逐字段最小操作 + revision 冲突拒绝」）
 *
 * 存在理由：「整份 JSON 读-改-写」两个并发调用会**丢更新**（后写者基于旧快照）。
 * 核销口径 = 一次「读→改→写」全程在**同一个 serialize 任务内**（见 llm-controller 的
 * mutateProviders / mutateModels）。本文件只验证队列本身的两条硬性质：
 *   ① 同 key 严格串行（后任务等到前任务 settle 才开始）；
 *   ② 任务抛错**不断链**（否则一次失败会让该 key 后续所有写永久跳过）。
 */
import { describe, it, expect, vi } from 'vitest'

// ⚠️ CI 一致性：队列失败分支要打日志，而真实 logger 会往 ~/.novelforge/logs/ 写盘 → 必须打桩
vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogDir: () => '' },
}))

import { serialize } from './config-write-queue'

describe('serialize', () => {
  it('同 key 串行：慢任务未完成前第二个不开始', async () => {
    const order: string[] = []
    const p1 = serialize('k', async () => { await new Promise(r => setTimeout(r, 20)); order.push('a') })
    const p2 = serialize('k', () => { order.push('b') })
    await Promise.all([p1, p2])
    expect(order).toEqual(['a', 'b'])
  })

  it('任务抛错不断链', async () => {
    await expect(serialize('k', () => { throw new Error('x') })).rejects.toThrow('x')
    await expect(serialize('k', () => 1)).resolves.toBe(1)
  })

  it('串行而非并发：三个任务按提交序执行，且任一时刻只有一个在跑', async () => {
    const order: string[] = []
    let running = 0
    let maxRunning = 0
    const mk = (tag: string, ms: number) => () => new Promise<void>((resolve) => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      order.push(`start:${tag}`)
      setTimeout(() => { order.push(`end:${tag}`); running -= 1; resolve() }, ms)
    })

    await Promise.all([
      serialize('k', mk('a', 15)),
      serialize('k', mk('b', 1)),   // 提交更早结束的任务也必须排在 a 之后
      serialize('k', mk('c', 1)),
    ])

    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
    expect(maxRunning).toBe(1)
  })

  it('返回值与异常都透传给调用方（队列不吞结果）', async () => {
    await expect(serialize('r', async () => ({ n: 42 }))).resolves.toEqual({ n: 42 })
    await expect(serialize('r', async () => { throw new Error('boom') })).rejects.toThrow('boom')
  })

  it('不同 key 互不阻塞（providers 与 models 两个队列各自串行）', async () => {
    const order: string[] = []
    // k1 先占住；k2 的任务应当**立刻**跑完，不被 k1 的那个 20ms 拖住
    const p1 = serialize('k1', async () => { await new Promise(r => setTimeout(r, 20)); order.push('k1') })
    const p2 = serialize('k2', () => { order.push('k2') })
    await p2
    expect(order).toEqual(['k2'])   // k1 尚未结束
    await p1
    expect(order).toEqual(['k2', 'k1'])
  })
})
