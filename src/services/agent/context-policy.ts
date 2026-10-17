/**
 * 上下文策略（W1，上下文治理二期批 2）——按**模型档位**决定上下文预算，取代"全局常量"。
 *
 * 目标（用户拍板口径）：**不拖累强模型、抬高弱模型**。设计前提是那条不对称：
 * 精简/压缩对强模型近无损、对弱模型是灾难；而结构化契约与更短的上下文对弱模型是脚手架、
 * 对强模型是噪音。所以同一个"最优预算"不存在，必须按档位分：
 *
 * | 档位 | 判定 | 历史 | 预算上限（2026-10-17 起按窗口分档） | 工具契约 | M1 | L1 |
 * |---|---|---|---|---|---|---|
 * | 强 | 路由 elite（且窗口 ≥128k）或窗口 ≥200k | 90% | 300K / 600K / 1M | 6000 | 400 | 600 |
 * | 标准 | 其余（百分比与引入前一致） | 80% | 300K / 600K / 1M | 4000 | 300 | 600 |
 * | 弱 | 路由 budget 或窗口 <64k | 60% | 300K / 600K / 1M | 4000 | 200 | 300 |
 *
 * **百万上下文时代（2026-10-17 用户裁决）**：预算绝对上限不再固定 32k/64k/128k，而是按
 * **模型窗口自动分三档**（`resolveContextBudgetCeiling`）：
 *   - 窗口 < 600K       → 300K
 *   - 600K ≤ 窗口 < 1M  → 600K
 *   - 窗口 ≥ 1M         → 1M
 * 有效预算仍是 `min(挡位, 窗口 × historyPercent%)`——挡位只是天花板，小窗口模型算出来天然更小
 * （如 32k 窗口 × 60% = 19.2k），不会因挡位变大而超窗。
 *
 * 几条刻意的不变量：
 * - **百分比档位语义不变**：标准档 80% 仍是绝大多数用户的缺省；挡位只放宽绝对上限。
 * - **窗口是主信号，路由档位是辅信号**：窗口是客观规格；路由档位只说明"用户把它配在哪一层"，
 *   它既可能高估（elite 配了小窗口模型）也可能低估，故强档额外要求窗口 ≥128k——
 *   否则 90% 会把输出空间与系统提示挤掉。
 * - **无窗口信息 → 标准档 + 最小挡位 300K**（保守，不猜）。
 * - **用户显式配置优先**：本模块只提供**缺省值**，由 `resolveCompactionPrefs(cfg, defaults)` 消费，
 *   用户在手写 `config.compaction` 里给过的值不会被策略覆盖。
 * - **弱档不砍工具契约**（工具预算同为 4000）：看不见的工具 = 不可调用，而弱模型最不会
 *   从签名反推参数语义——"按意图给子集"需要可靠的意图→工具映射，本批没有，故不做。
 */
import type { ModelTier } from '../llm/model-router'
import { useLLMStore } from '../../stores/llm-store'

export interface ContextPolicy {
  /** 命中的档位（面板/日志可据此解释"为什么这个模型的预算不同"） */
  tier: ModelTier
  /** 历史预算百分比（作为用户未配置时的缺省） */
  historyPercent: number
  /**
   * 历史/消息预算的**绝对上限**（2026-10-17 起按模型窗口自动分档：300K / 600K / 1M，
   * 见 `resolveContextBudgetCeiling`；不再按 strong/standard/weak 固定 128k/64k/32k）。
   */
  historyCeilingTokens: number
  /** 工具契约段预算 */
  toolBudgetTokens: number
  /** 会话摘要（M1）：注入上限，且**同时**作为生成端长度指令（两者必须同源，否则是死额度） */
  m1BudgetTokens: number
  /** 编辑器上下文（L1）上限 */
  l1BudgetTokens: number
  /** 是否启用任务锚点（S2/W2；当前三档皆开——锚点对强模型的多步任务同样有益） */
  taskAnchor: boolean
  /**
   * W3 自动召回（命中本轮请求的 manual 记忆正文）：**仅弱档**。
   * 强模型会自己 `read_memory` / `@`，自动注入只会挤占它的上下文预算。
   */
  autoRecall: boolean
  /**
   * W4 未完成自检（弱模型过早收尾的兜底提醒）：**仅弱档**，且每会话至多一次。
   * 强档自己做得到"检查是否还有未完成步骤"，注入提醒是噪音。
   */
  unfinishedCheck: boolean
}

/** 弱档窗口上限：窗口小于它 → 塞满上下文对模型是干扰而非帮助 */
export const WEAK_WINDOW_MAX = 64_000
/** 强档窗口门槛（不看路由档位） */
export const STRONG_WINDOW = 200_000
/** 路由 elite **且**窗口达到它才算强档（避免小窗口 + 90% 挤掉输出空间） */
export const STRONG_MIN_WINDOW_FOR_ELITE = 128_000

// ===== 上下文预算挡位（百万上下文时代，2026-10-17 用户裁决）=====
//
// 按**模型窗口**自动分三档，作为历史/消息预算的绝对上限（有效预算 = min(挡位, 窗口×百分比)）。
// 窗口不足时百分比自然算出更小值，挡位不会让小窗口超窗。
/** 挡位 1：窗口 < 600K（含未知窗口）→ 300K 预算上限 */
export const CONTEXT_CEILING_300K = 300_000
/** 挡位 2：600K ≤ 窗口 < 1M → 600K 预算上限 */
export const CONTEXT_CEILING_600K = 600_000
/** 挡位 3：窗口 ≥ 1M → 1M 预算上限 */
export const CONTEXT_CEILING_1M = 1_000_000
/** 600K 挡位的窗口门槛 */
export const CEILING_600K_MIN_WINDOW = 600_000
/** 1M 挡位的窗口门槛 */
export const CEILING_1M_MIN_WINDOW = 1_000_000

/**
 * 按模型窗口解析**预算绝对上限**（纯函数；无窗口/非法窗口 → 最小挡位 300K，保守不猜）。
 *
 * 分档依据（用户 2026-10-17 裁决，百万上下文时代）：
 * - 窗口 < 600K       → 300K
 * - 600K ≤ 窗口 < 1M  → 600K
 * - 窗口 ≥ 1M         → 1M
 */
export function resolveContextBudgetCeiling(contextWindow?: number): number {
  const window = contextWindow && contextWindow > 0 ? contextWindow : 0
  if (window >= CEILING_1M_MIN_WINDOW) return CONTEXT_CEILING_1M
  if (window >= CEILING_600K_MIN_WINDOW) return CONTEXT_CEILING_600K
  return CONTEXT_CEILING_300K
}

/** 档位策略中**与窗口无关**的部分（预算上限由 `resolveContextBudgetCeiling` 另行给出） */
type PolicyBody = Omit<ContextPolicy, 'tier' | 'historyCeilingTokens'>

/** 强档：长窗口/elite —— 少压多留、契约给足、摘要更长（W3/W4 关：它会自助） */
const POLICY_STRONG: PolicyBody = {
  historyPercent: 90,
  toolBudgetTokens: 6000,
  m1BudgetTokens: 400,
  l1BudgetTokens: 600,
  taskAnchor: true,
  autoRecall: false,
  unfinishedCheck: false,
}

/** 标准档：百分比与引入前逐字一致（80 / 4000 / 300 / 600 + W3/W4 关）；上限改由窗口挡位给 */
const POLICY_STANDARD: PolicyBody = {
  historyPercent: 80,
  toolBudgetTokens: 4000,
  m1BudgetTokens: 300,
  l1BudgetTokens: 600,
  taskAnchor: true,
  autoRecall: false,
  unfinishedCheck: false,
}

/** 弱档：更早压（上下文更干净）、摘要更短更结构化，并开启 W3/W4 两条弱模型脚手架 */
const POLICY_WEAK: PolicyBody = {
  historyPercent: 60,
  toolBudgetTokens: 4000,
  m1BudgetTokens: 200,
  l1BudgetTokens: 300,
  taskAnchor: true,
  autoRecall: true,
  unfinishedCheck: true,
}

/**
 * 纯函数：按（窗口规格 + 路由档位）解析策略。
 *
 * 判定顺序（**显式配置 > 客观窗口 > 缺省**）：
 * 1. 路由显式配在 `budget` 层 → 弱档（尊重用户的**成本意图**：他为省钱才把它放这一层）
 * 2. 窗口 ≥200k → 强档（客观规格，与用户怎么配无关）
 * 3. 窗口 <64k → 弱档（物理空间不够，塞满就是干扰）
 * 4. 路由 `elite` 且窗口 ≥128k → 强档（90% 才不会把输出空间挤掉）
 * 5. 其余 → 标准档（**与引入前逐字一致**）
 *
 * ⚠️ 刻意**不用 Agent 面板档位**（`agentModeToTier`）当能力代理：那是"投入档位"而非模型能力，
 * 且 store 默认 mode 就是 `deep`——用它会把所有默认用户悄悄提到强档，违反"标准档零变化"的承诺。
 */
export function resolveContextPolicy(input: { contextWindow?: number; tier?: ModelTier }): ContextPolicy {
  const window = input.contextWindow && input.contextWindow > 0 ? input.contextWindow : 0
  const tier = input.tier
  // 预算上限只由**窗口挡位**决定（与强/标准/弱档正交）：300K / 600K / 1M
  const historyCeilingTokens = resolveContextBudgetCeiling(window)
  if (tier === 'budget') return { tier: 'budget', historyCeilingTokens, ...POLICY_WEAK }
  if (window >= STRONG_WINDOW) return { tier: 'elite', historyCeilingTokens, ...POLICY_STRONG }
  if (window > 0 && window < WEAK_WINDOW_MAX) return { tier: 'budget', historyCeilingTokens, ...POLICY_WEAK }
  if (tier === 'elite' && window >= STRONG_MIN_WINDOW_FOR_ELITE) return { tier: 'elite', historyCeilingTokens, ...POLICY_STRONG }
  return { tier: 'standard', historyCeilingTokens, ...POLICY_STANDARD }
}

/**
 * 便捷入口（读 store）：由"该模型被显式配在哪一层"解析档位，再据此取策略。
 *
 * ⚠️ 必须读 `modelRoutes[tier].includes(modelId)` 而不是 `getModelForTier(tier)`：
 * 后者在没有 modelRouter 时对**任何**层都返回 `defaultModelId`，拿它反查会把默认模型误判成
 * elite（本批实现中实际踩到，用例已锁定）。没配路由 → 档位未知 → 只看窗口信号。
 */
export function resolveContextPolicyFor(modelId: string | undefined): ContextPolicy {
  const llm = useLLMStore.getState()
  const model = modelId ? llm.models.find(m => m.id === modelId) : undefined
  let tier: ModelTier | undefined
  if (modelId) {
    const routes = llm.modelRoutes
    for (const t of ['elite', 'standard', 'budget'] as ModelTier[]) {
      if (routes?.[t]?.includes(modelId)) { tier = t; break }
    }
  }
  return resolveContextPolicy({ contextWindow: model?.contextWindow, tier })
}
