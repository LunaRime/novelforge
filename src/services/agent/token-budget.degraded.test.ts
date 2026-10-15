/**
 * token-budget 降级路径（S1）——`gpt-tokenizer` 不可用时的**状态可见性**契约。
 *
 * 独立文件的原因与 `token-budget.encoder.test.ts` 同：模块级 `gptEncoder`/`engineState` 是单例，
 * 这里 mock 掉 gpt-tokenizer **抛错**，会污染同进程内其他文件的精确计数路径，故必须隔离。
 *
 * 为什么必须测：降级后中文高估 ≈1.7×（实测工具契约 6059 vs 3612），全部预算按保守口径判定
 * → 压缩提前约 40% 触发。方向安全但**静默损失质量**，所以状态必须能被上层读出来留痕。
 */
import { describe, it, expect, vi } from 'vitest'

// 动态 import 时抛错 = 模拟打包缺模块 / 加载失败
vi.mock('gpt-tokenizer', () => {
  throw new Error('模拟：gpt-tokenizer 不可用')
})

import { initTokenEngine, getTokenEngineState, estimateTokens, estimateTokensHeuristic } from './token-budget'

describe('token 引擎降级（S1）', () => {
  it('初始化前状态为 unknown（上层据此不误报）', () => {
    expect(getTokenEngineState()).toBe('unknown')
  })

  it('加载失败 → 状态 heuristic，且估算走启发式（不抛）', async () => {
    const state = await initTokenEngine()
    expect(state).toBe('heuristic')
    expect(getTokenEngineState()).toBe('heuristic')
    const text = '第三章的重逢场景需要更克制一些。'
    expect(estimateTokens(text)).toBe(estimateTokensHeuristic(text))
  })

  it('降级下单位估算仍可用（不返回 0 / NaN）', () => {
    expect(estimateTokens('测试')).toBeGreaterThan(0)
    expect(Number.isFinite(estimateTokens('测试'))).toBe(true)
  })
})
