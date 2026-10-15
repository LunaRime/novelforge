/**
 * 自学习压缩 v1 —— TACO 式本地规则引擎（无训练 / 无新增 LLM 调用）。
 *
 * 设计审阅见 `docs/superpowers/specs/2026-10-15-self-learning-compression-design.md`：
 * 四个候选方法（TACO / Accordion-Thinking / Agent-Omit / Cartridges）中仅 TACO 式的
 * 「无训练信号反馈环」可移植（其余需要模型权重或训练设施）；v1 以「固定规则目录 +
 * 统计自适应」落地，规则文本是 i18n 键（可审计、零注入风险），学习对象有三：
 *
 * - **时机**：最小降幅阈值倍率 `minChangeFactor ∈ [0.5, 1.5]`——
 *   跳过（无收益）→ 上调；压缩后仍被硬截断 → 下调；正常成功 → 向 1.0 缓慢回中
 * - **内容**（keep 规则）：保真缺失（写入目标 / 角色名 / 章节号）累计 ≥2 → 激活
 *   「保留提示」注入摘要 prompt；激活后继续缺失 ≥3 → 退役（提示无效）
 * - **省略**（omit 规则）：低增益压缩（降幅比 < 15%）累计 ≥3 → 激活「省略提示」；
 *   激活期间出现保真告警 ≥2 → 退役（省略伤到了保真）
 *
 * 安全阀：默认关闭；倍率有界；证据门槛 + 迟滞（退役后需新增 ≥2 证据才可复活）；
 * 规则数固定 ≤4；全部决策由调用方 renderLog 留痕；一键重置。
 * 更新只在**压缩事件**（稀有）发生时进行——健康会话里不产生任何写盘；只有「上下文真的丢了消息」
 * （硬截断）的会话会每轮写一次状态（统计真实性优先于写盘频率，见 applyCompressionOutcome 注释）。
 */
import { t, type TextKey } from '../../shared/locale'
import type { FidelityEntityKind } from './ccr-fidelity'

// ===== 类型 =====

export type CompressionRuleId =
  | 'keep-write-targets'
  | 'keep-characters'
  | 'keep-chapter-refs'
  | 'omit-read-noise'

export interface CompressionRuleState {
  id: CompressionRuleId
  /** 是否激活（激活 = 提示进入摘要 prompt） */
  active: boolean
  /** 支持证据：keep=该类别保真缺失次数；omit=低增益压缩次数 */
  evidence: number
  /** 反证：keep=激活后继续缺失次数；omit=激活期间保真告警次数 */
  backfire: number
  /** 上次决策（激活/退役）时的 evidence——退役后需再攒 RESURRECT_EVIDENCE 条才可复活（防抖） */
  evidenceAtLastDecision: number
  /** 激活时的 backfire 基线（退役判定用） */
  backfireAtActivation: number
}

export interface CompressionLearningState {
  version: 1
  /** 总开关（设置页；默认关——关闭时本模块全程零副作用） */
  enabled: boolean
  /** 最小降幅自适应倍率：有效阈值 = clamp(用户值 × 倍率, 0, 2000) */
  minChangeFactor: number
  updatedAt: number
  stats: {
    compressions: number
    skipped: number
    truncations: number
    fidelityWarns: number
    reverts: number
    regenerations: number
  }
  rules: CompressionRuleState[]
}

/** 一次压缩事件的观察结果（调用方从压缩路径采集，全部零 LLM 成本） */
export interface CompressionOutcome {
  /** 进入了压缩分支（历史超预算且有批次） */
  attempted: boolean
  /** 摘要生成成功但降幅低于阈值 → 跳过 */
  skipped: boolean
  /** 成功替换历史 */
  success: boolean
  /** 成功时的降幅比 = changeTokens / batchTokens（低增益 → omit 证据） */
  gainRatio?: number
  /** 保真检查缺失的实体类别（成功时） */
  missingKinds?: FidelityEntityKind[]
  /** 保真告警是否触发（同一阈值口径） */
  fidelityWarned?: boolean
  /** 本轮最终被硬截断丢弃的消息数（>0 = 压缩不足） */
  truncationDropped: number
}

/** 需要落进 LogsView 的学习决策（调用方 renderLog('info', 'Agent', …)） */
export interface CompressionLearningEvent {
  message: string
}

// ===== 规则目录（固定、可审计） =====

interface RuleDef {
  kind: 'keep' | 'omit'
  /** 激活门槛（证据数） */
  activateAt: number
  /** 退役门槛（反证数） */
  retireAt: number
  /** 激活时追加到摘要 prompt 的提示（i18n 键） */
  hintKey: TextKey
  /** 设置面板展示名（i18n 键） */
  labelKey: TextKey
}

const RULE_IDS: CompressionRuleId[] = [
  'keep-write-targets', 'keep-characters', 'keep-chapter-refs', 'omit-read-noise',
]

const RULE_DEFS: Record<CompressionRuleId, RuleDef> = {
  'keep-write-targets': {
    kind: 'keep', activateAt: 2, retireAt: 3,
    hintKey: 'ccr.learnHintKeepTargets', labelKey: 'ccr.ruleKeepWriteTargets',
  },
  'keep-characters': {
    kind: 'keep', activateAt: 2, retireAt: 3,
    hintKey: 'ccr.learnHintKeepCharacters', labelKey: 'ccr.ruleKeepCharacters',
  },
  'keep-chapter-refs': {
    kind: 'keep', activateAt: 2, retireAt: 3,
    hintKey: 'ccr.learnHintKeepChapterRefs', labelKey: 'ccr.ruleKeepChapterRefs',
  },
  'omit-read-noise': {
    kind: 'omit', activateAt: 3, retireAt: 2,
    hintKey: 'ccr.learnHintOmitReadNoise', labelKey: 'ccr.ruleOmitReadNoise',
  },
}

/** 保真缺失类别 → keep 规则（一一对应） */
const KIND_TO_RULE: Record<FidelityEntityKind, CompressionRuleId> = {
  'write-target': 'keep-write-targets',
  'character': 'keep-characters',
  'chapter': 'keep-chapter-refs',
}

// ===== 常量（有界安全阀） =====

export const FACTOR_MIN = 0.5
export const FACTOR_MAX = 1.5
const FACTOR_STEP = 0.1
/** 成功时向 1.0 回中的比例（收敛信号：正常压缩不需要调节） */
const FACTOR_RECENTER = 0.2
/** 退役后复活所需的新增证据数（防抖：不允许退役后立刻复活） */
const RESURRECT_EVIDENCE = 2
/** 低增益阈值：降幅比低于它视为「压缩收益有限」→ omit 证据 */
export const LOW_GAIN_RATIO = 0.15
/** 有效阈值钳制上限（与 compaction-prefs.RANGES.minimumChangeTokens 同口径） */
const MIN_CHANGE_MAX = 2000

// ===== 状态构造与解析（fail-safe：坏形状一律回默认） =====

export function defaultCompressionLearning(enabled = false): CompressionLearningState {
  return {
    version: 1,
    enabled,
    minChangeFactor: 1,
    updatedAt: 0,
    stats: { compressions: 0, skipped: 0, truncations: 0, fidelityWarns: 0, reverts: 0, regenerations: 0 },
    rules: RULE_IDS.map(id => ({ id, active: false, evidence: 0, backfire: 0, evidenceAtLastDecision: 0, backfireAtActivation: 0 })),
  }
}

/** 解析全局配置里的 compactionLearning；缺段/坏形状一律回默认 → 老配置零迁移 */
export function resolveCompressionLearning(raw: unknown): CompressionLearningState {
  const base = defaultCompressionLearning()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  // 版本失配 → 整段回默认（设计 §3.6「形状破坏时 fail-safe」）。缺 version 仍按本文形状宽容解析
  // （手工编辑/早期写入可能不带该字段）；显式写了别的版本号说明形状已不属于本实现，**不做部分解析**
  // ——部分解析会把未知形状的字段当成本版本语义，比回默认更危险。
  if (typeof r.version === 'number' && r.version !== 1) return base

  const num = (v: unknown, fallback: number, min = 0): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : fallback

  const rawStats = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>
  const rawRules = Array.isArray(r.rules) ? r.rules : []
  const rules = RULE_IDS.map(id => {
    const found = rawRules.find(x =>
      !!x && typeof x === 'object' && (x as { id?: unknown }).id === id) as Record<string, unknown> | undefined
    if (!found) return { id, active: false, evidence: 0, backfire: 0, evidenceAtLastDecision: 0, backfireAtActivation: 0 }
    return {
      id,
      active: found.active === true,
      evidence: num(found.evidence, 0),
      backfire: num(found.backfire, 0),
      evidenceAtLastDecision: num(found.evidenceAtLastDecision, 0),
      backfireAtActivation: num(found.backfireAtActivation, 0),
    }
  })

  return {
    version: 1,
    enabled: r.enabled === true,
    minChangeFactor: clampFactor(typeof r.minChangeFactor === 'number' && Number.isFinite(r.minChangeFactor) ? r.minChangeFactor : 1),
    updatedAt: num(r.updatedAt, 0),
    stats: {
      compressions: num(rawStats.compressions, 0),
      skipped: num(rawStats.skipped, 0),
      truncations: num(rawStats.truncations, 0),
      fidelityWarns: num(rawStats.fidelityWarns, 0),
      reverts: num(rawStats.reverts, 0),
      regenerations: num(rawStats.regenerations, 0),
    },
    rules,
  }
}

/** 重置学习数据（保留当前开关状态；调用方负责落盘） */
export function resetCompressionLearning(enabled: boolean): CompressionLearningState {
  return { ...defaultCompressionLearning(enabled), updatedAt: Date.now() }
}

function clampFactor(v: number): number {
  const clamped = Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, v))
  return Math.round(clamped * 100) / 100
}

// ===== 应用面（只影响之后的压缩） =====

/**
 * 有效最小降幅阈值：`clamp(用户值 × 倍率, 0, 2000)`。
 * 关闭时逐字返回用户值（行为零变化）。
 */
export function effectiveMinChangeTokens(userValue: number, state: CompressionLearningState): number {
  if (!state.enabled) return userValue
  return Math.min(MIN_CHANGE_MAX, Math.max(0, Math.round(userValue * state.minChangeFactor)))
}

/** 激活规则的提示列表（注入摘要 prompt；关闭/无激活规则 → 空） */
export function composeLearningHints(state: CompressionLearningState): string[] {
  if (!state.enabled) return []
  return state.rules.filter(r => r.active).map(r => t(RULE_DEFS[r.id].hintKey))
}

/** 激活规则展示名（设置面板） */
export function activeRuleLabels(state: CompressionLearningState): string[] {
  return state.rules.filter(r => r.active).map(r => t(RULE_DEFS[r.id].labelKey))
}

// ===== 学习更新（事件驱动、稀有写盘） =====

export interface LearningUpdateResult {
  state: CompressionLearningState
  /** 是否需要落盘（倍率/规则/统计发生变化；纯截断计数不触发——防长对话每轮写盘） */
  changed: boolean
  /** 需要 LogsView 留痕的决策 */
  events: CompressionLearningEvent[]
}

/**
 * 应用一次压缩事件的观察结果。
 * 关闭时直接返回原状态（changed=false）——调用方也可先行跳过。
 */
export function applyCompressionOutcome(
  state: CompressionLearningState,
  outcome: CompressionOutcome,
): LearningUpdateResult {
  if (!state.enabled) return { state, changed: false, events: [] }
  const events: CompressionLearningEvent[] = []
  const stats = { ...state.stats }
  const rules = state.rules.map(r => ({ ...r }))
  let changed = false

  // ---- 统计 ----
  if (outcome.success) stats.compressions += 1
  if (outcome.skipped) stats.skipped += 1
  if (outcome.truncationDropped > 0) stats.truncations += 1
  if (outcome.fidelityWarned) stats.fidelityWarns += 1
  // 截断计数**必须**触发写盘（修复）：此前把它排除在 changed 之外（怕长对话每轮 config:set），
  // 结果是「只发生硬截断」的会话里计数每轮被推高又在调用方被丢弃 → 设置页的「截断 N」永远停在旧值，
  // 恰好是本批（可观测性）最不该发生的失真。代价可控：该分支只在**上下文真的丢过消息**时进入，
  // 健康会话 dropped=0、不写盘；病态会话每轮一次小 JSON 写，换来统计为真。
  if (stats.compressions !== state.stats.compressions
    || stats.skipped !== state.stats.skipped
    || stats.fidelityWarns !== state.stats.fidelityWarns
    || stats.truncations !== state.stats.truncations) {
    changed = true
  }

  // ---- 时机（互斥方向：压缩不足优先；成功则向 1.0 回中） ----
  const prevFactor = state.minChangeFactor
  let factor = state.minChangeFactor
  if (outcome.attempted && outcome.truncationDropped > 0) {
    factor = clampFactor(factor - FACTOR_STEP)          // 上下文真的丢了 → 更积极地压
  } else if (outcome.attempted && outcome.skipped) {
    factor = clampFactor(factor + FACTOR_STEP)          // 压了没收益 → 少压（省摘要调用）
  } else if (outcome.success) {
    factor = clampFactor(factor + (1 - factor) * FACTOR_RECENTER)
  }
  if (factor !== prevFactor) {
    changed = true
    events.push({ message: t('ccr.learnFactorAdjusted').replace('{factor}', factor.toFixed(2)) })
  }

  // ---- 保真缺失 → keep 规则证据（激活/退役/复活） ----
  if (outcome.success && outcome.missingKinds && outcome.missingKinds.length > 0) {
    for (const kind of outcome.missingKinds) {
      const rule = rules.find(r => r.id === KIND_TO_RULE[kind])!
      const def = RULE_DEFS[rule.id]
      if (rule.active) {
        rule.backfire += 1
        if (rule.backfire - rule.backfireAtActivation >= def.retireAt) {
          rule.active = false
          rule.evidenceAtLastDecision = rule.evidence
          changed = true
          events.push({ message: t('ccr.learnRuleRetired').replace('{rule}', t(def.labelKey)) })
        }
      } else {
        rule.evidence += 1
        // 首次激活用规则门槛；退役后复活需新增 RESURRECT_EVIDENCE 条证据（防抖）
        const need = rule.evidenceAtLastDecision > 0 ? RESURRECT_EVIDENCE : def.activateAt
        if (rule.evidence - rule.evidenceAtLastDecision >= need) {
          rule.active = true
          rule.backfireAtActivation = rule.backfire
          changed = true
          events.push({ message: t('ccr.learnRuleActivated').replace('{rule}', t(def.labelKey)) })
        }
      }
    }
  }

  // ---- omit 规则：低增益 → 证据；激活期间保真告警 → 反证 ----
  const omit = rules.find(r => r.id === 'omit-read-noise')!
  const omitDef = RULE_DEFS['omit-read-noise']
  if (outcome.success && omit.active && outcome.fidelityWarned) {
    omit.backfire += 1
    if (omit.backfire - omit.backfireAtActivation >= omitDef.retireAt) {
      omit.active = false
      omit.evidenceAtLastDecision = omit.evidence
      changed = true
      events.push({ message: t('ccr.learnRuleRetired').replace('{rule}', t(omitDef.labelKey)) })
    }
  } else if (outcome.success && outcome.gainRatio !== undefined && outcome.gainRatio < LOW_GAIN_RATIO && !omit.active) {
    omit.evidence += 1
    const need = omit.evidenceAtLastDecision > 0 ? RESURRECT_EVIDENCE : omitDef.activateAt
    if (omit.evidence - omit.evidenceAtLastDecision >= need) {
      omit.active = true
      omit.backfireAtActivation = omit.backfire
      changed = true
      events.push({ message: t('ccr.learnRuleActivated').replace('{rule}', t(omitDef.labelKey)) })
    }
  }

  const nextState: CompressionLearningState = { ...state, minChangeFactor: factor, stats, rules }
  if (!changed) {
    // 状态已推进（如纯截断计数）但无需落盘——返回推进后的状态，调用方按 changed 决定是否写回
    return { state: nextState, changed: false, events: [] }
  }
  return { state: { ...nextState, updatedAt: Date.now() }, changed: true, events }
}

/** 用户移除压缩（强负反馈，v1 只统计不自动动作——移除动机多样，避免误伤） */
export function recordCompressionRevert(state: CompressionLearningState): LearningUpdateResult {
  if (!state.enabled) return { state, changed: false, events: [] }
  return {
    state: { ...state, stats: { ...state.stats, reverts: state.stats.reverts + 1 }, updatedAt: Date.now() },
    changed: true,
    events: [],
  }
}

/** 用户重生成摘要（弱负反馈，v1 只统计） */
export function recordCompressionRegeneration(state: CompressionLearningState): LearningUpdateResult {
  if (!state.enabled) return { state, changed: false, events: [] }
  return {
    state: { ...state, stats: { ...state.stats, regenerations: state.stats.regenerations + 1 }, updatedAt: Date.now() },
    changed: true,
    events: [],
  }
}

/** 测试/可见性用：规则定义只读快照 */
export function ruleDefsForTest(): Record<CompressionRuleId, RuleDef> {
  return RULE_DEFS
}
