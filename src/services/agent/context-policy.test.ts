/**
 * context-policy（W1，批 2）——按模型档位的上下文策略契约。
 *
 * 最重要的两组断言：
 * 1. **标准档 = 引入前常量**：绝大多数用户走这一档，行为必须零变化（与 context-builder 的
 *    既有常量跨模块对齐，防两处漂移）。
 * 2. **判定顺序**：显式路由（budget）> 客观窗口 > 路由 elite > 标准；无信息一律标准（不猜）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveContextPolicy, resolveContextPolicyFor,
  WEAK_WINDOW_MAX, STRONG_WINDOW, STRONG_MIN_WINDOW_FOR_ELITE,
} from './context-policy'
import { TOOL_PROMPT_MAX_TOKENS, SESSION_SUMMARY_BUDGET_TOKENS, L1_EDITOR_BUDGET_TOKENS } from './context-builder'
import { useLLMStore } from '../../stores/llm-store'
import type { ModelProfile } from '../../shared/ipc-channels'

const profile = (id: string, contextWindow: number): ModelProfile => ({
  id,
  name: id,
  provider: 'openai',
  protocol: 'openai',
  modelName: id,
  baseUrl: 'https://example.invalid',
  temperature: 0.7,
  maxTokens: 4096,
  contextWindow,
  purposes: ['generation'],
})

describe('resolveContextPolicy：档位判定（W1 批 2）', () => {
  it('标准档 = 引入前常量（绝大多数用户零变化；跨模块对齐防漂移）', () => {
    const p = resolveContextPolicy({ contextWindow: 128_000 })
    expect(p).toMatchObject({
      tier: 'standard',
      historyPercent: 80,
      historyCeilingTokens: 64_000,
      toolBudgetTokens: TOOL_PROMPT_MAX_TOKENS,          // 4000
      m1BudgetTokens: SESSION_SUMMARY_BUDGET_TOKENS,     // 300
      l1BudgetTokens: L1_EDITOR_BUDGET_TOKENS,           // 600
    })
  })

  it('无窗口信息 → 标准档（保守，不猜）', () => {
    expect(resolveContextPolicy({}).tier).toBe('standard')
    expect(resolveContextPolicy({ contextWindow: 0 }).tier).toBe('standard')
    expect(resolveContextPolicy({ contextWindow: Number.NaN }).tier).toBe('standard')
  })

  it('窗口 ≥200k → 强档（客观规格，与路由怎么配无关）', () => {
    const p = resolveContextPolicy({ contextWindow: STRONG_WINDOW })
    expect(p).toMatchObject({ tier: 'elite', historyPercent: 90, historyCeilingTokens: 128_000, m1BudgetTokens: 400 })
    // 边界：略小于门槛仍走标准档
    expect(resolveContextPolicy({ contextWindow: STRONG_WINDOW - 1 }).tier).toBe('standard')
  })

  it('窗口 <64k → 弱档（物理空间不够，塞满就是干扰）', () => {
    const p = resolveContextPolicy({ contextWindow: WEAK_WINDOW_MAX - 1 })
    expect(p).toMatchObject({ tier: 'budget', historyPercent: 60, historyCeilingTokens: 32_000, m1BudgetTokens: 200, l1BudgetTokens: 300 })
  })

  it('路由 budget 层：即使窗口很大也走弱档（尊重用户的成本意图）', () => {
    const p = resolveContextPolicy({ contextWindow: 1_000_000, tier: 'budget' })
    expect(p.tier).toBe('budget')
    expect(p.historyCeilingTokens).toBe(32_000)
  })

  it('路由 elite + 窗口 ≥128k → 强档；elite 但窗口不足 → 标准档（90% 会挤掉输出空间）', () => {
    expect(resolveContextPolicy({ contextWindow: STRONG_MIN_WINDOW_FOR_ELITE, tier: 'elite' }).tier).toBe('elite')
    const smallElite = resolveContextPolicy({ contextWindow: 64_000, tier: 'elite' })
    expect(smallElite.tier).toBe('standard')
    expect(smallElite.historyPercent).toBe(80)
  })

  it('预算单调有界：强档 ≥ 标准档 ≥ 弱档（历史/摘要/工具三条都成立）', () => {
    const strong = resolveContextPolicy({ contextWindow: 200_000 })
    const standard = resolveContextPolicy({ contextWindow: 128_000 })
    const weak = resolveContextPolicy({ contextWindow: 32_000 })
    for (const key of ['historyPercent', 'historyCeilingTokens', 'm1BudgetTokens'] as const) {
      expect(strong[key]).toBeGreaterThanOrEqual(standard[key])
      expect(standard[key]).toBeGreaterThanOrEqual(weak[key])
    }
    // 工具契约：弱档**不砍**（看不见的工具 = 不可调用，弱模型最不会从签名反推语义）
    expect(weak.toolBudgetTokens).toBe(standard.toolBudgetTokens)
  })
})

describe('resolveContextPolicyFor：读 store 的档位解析', () => {
  beforeEach(() => {
    useLLMStore.setState({
      models: [profile('big', 200_000), profile('small', 32_000), profile('mid', 128_000)],
      modelRoutes: { elite: [], standard: [], budget: [] },
      defaultModelId: 'mid',
    })
  })

  it('未配路由 → 只看窗口（mid 128k → 标准；big 200k → 强；small 32k → 弱）', () => {
    expect(resolveContextPolicyFor('mid').tier).toBe('standard')
    expect(resolveContextPolicyFor('big').tier).toBe('elite')
    expect(resolveContextPolicyFor('small').tier).toBe('budget')
  })

  it('显式路由成员生效：elite 层的大窗口模型走强档 / budget 层走弱档', () => {
    useLLMStore.setState({ modelRoutes: { elite: ['mid'], standard: [], budget: [] } })
    expect(resolveContextPolicyFor('mid').tier).toBe('elite')
    useLLMStore.setState({ modelRoutes: { elite: [], standard: [], budget: ['big'] } })
    expect(resolveContextPolicyFor('big').tier).toBe('budget')
  })

  it('回归：无 router 时 getModelForTier 对所有层返回默认模型，**不得**据此把默认模型误判成 elite', () => {
    // 该场景下 getModelForTier('elite') === 'mid'（实现细节），但路由配置里没有任何层含它
    expect(useLLMStore.getState().getModelForTier('elite')).toBe('mid')
    expect(resolveContextPolicyFor('mid').tier).toBe('standard')   // 只看窗口 → 标准
  })

  it('未知 / 缺省 modelId → 标准档（不猜）', () => {
    expect(resolveContextPolicyFor(undefined).tier).toBe('standard')
    expect(resolveContextPolicyFor('不存在').tier).toBe('standard')
  })
})
