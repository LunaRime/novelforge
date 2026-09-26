// @vitest-environment jsdom
/**
 * llm-store × 路由配置清理（评审 I2 回归）
 *
 * deleteModel / deleteProvider 会重建三层路由表（剔除已删模型的 id）。
 * 此前重建用的是新构造的对象字面量、只带 elite/standard/budget 三个字段，
 * 漏掉 strategy → 动态路由开关被静默重置为 static（用户没碰过路由 UI 却失效）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

// isElectron: true —— 否则 loadModels 开头直接 return，models 不被清空，
// deleteProvider 的长度判定不成立 → 测试假阳性
vi.mock('../services/ipc-client', () => ({ ipc: { invoke: invokeMock, isElectron: true } }))
vi.mock('../services/render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { useLLMStore } from './llm-store'

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel: string) => {
    // 注意：loadModels 直接对返回值调 .map，通道必须返回数组本身（返回 {models:[]} 会抛错，
    // 走 catch 分支 → 测试变成假阳性）
    if (channel === 'llm:list-models') return []
    if (channel === 'llm:list-providers') return []
    return { success: true }
  })
  useLLMStore.setState({
    models: [
      { id: 'm1', name: 'M1', modelName: 'm1', provider: 'p' },
      { id: 'm2', name: 'M2', modelName: 'm2', provider: 'p' },
    ] as never,
    modelRoutes: { elite: ['m1', 'm2'], standard: [], budget: [], strategy: 'dynamic' },
  })
})

describe('路由清理时保留 strategy（评审 I2）', () => {
  it('deleteModel 后 strategy 仍为 dynamic', async () => {
    await useLLMStore.getState().deleteModel('m1')
    expect(useLLMStore.getState().modelRoutes.strategy).toBe('dynamic')
  })

  it('deleteProvider 后 strategy 仍为 dynamic', async () => {
    await useLLMStore.getState().deleteProvider('acc-1')
    expect(useLLMStore.getState().modelRoutes.strategy).toBe('dynamic')
  })
})
