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
    if (channel === 'llm:list-providers') return { accounts: [], revision: 0 }
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

/**
 * 2026-10-16 修复：`updateModelRoutes` 在 `modelRouter === null` 时**整段静默 no-op**。
 *
 * 现场：router 只在 `init()`（AI 面板挂载）时创建，而设置页可以更早打开 ——
 * 于是「模型路由里勾好模型 → 保存」什么都不发生（界面不变、也没落盘），
 * 用户看到的现象就是「这条路由不显示 / 不生效」。
 */
describe('路由保存不依赖 router 是否已初始化', () => {
  it('modelRouter 为 null 时保存仍然生效并落盘', async () => {
    useLLMStore.setState({
      modelRouter: null,
      modelRoutes: { elite: [], standard: [], budget: [], strategy: 'static' },
    })
    useLLMStore.getState().updateModelRoutes({ elite: ['m1'] })

    // ① 界面读的 state 必须变（卡片按它对账）
    expect(useLLMStore.getState().modelRoutes.elite).toEqual(['m1'])
    // ② 必须落盘（否则重启丢）
    const saved = invokeMock.mock.calls.find(c => c[0] === 'llm:set-routes')
    expect(saved, 'llm:set-routes 未被调用 —— 保存被静默丢弃').toBeTruthy()
    expect((saved![1] as { elite: string[] }).elite).toEqual(['m1'])
    // ③ router 顺带补齐（后续路由调用不再走 null 回退）
    expect(useLLMStore.getState().modelRouter).not.toBeNull()
  })

  it('保存单层不清空其它层（patch 语义）', () => {
    useLLMStore.setState({
      modelRouter: null,
      modelRoutes: { elite: ['m1'], standard: ['m2'], budget: [], strategy: 'static' },
    })
    useLLMStore.getState().updateModelRoutes({ elite: [] })
    const routes = useLLMStore.getState().modelRoutes
    expect(routes.elite).toEqual([])
    expect(routes.standard).toEqual(['m2']) // 未提及的层原样保留
    expect(routes.strategy).toBe('static')
  })
})
