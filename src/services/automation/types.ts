/**
 * 写作自动化（D 档）类型与常量
 *
 * 参照 Denova `internal/automation/types.go`，按 NovelForge 的信息架构重做：
 * - 执行目标两选一（workflow / agent），Denova 只有 agent 会话
 * - ActionPolicy 三态真做（Denova 的 EffectiveActionPolicy 恒为 auto_run，confirm/notify_only 是残缺兼容路径）
 * - 不移植 write_confirmation（Denova 只有消费方没有生产方）
 *
 * 设计依据：docs/superpowers/specs/2026-09-26-writing-automation-design.md
 */

// ===== 基础枚举 =====

/** 四类触发器（manual 不参与自动评估，由「立即运行」构造） */
export type TriggerType = 'manual' | 'schedule' | 'chapter_batch' | 'semantic'

/** 触发后的处置策略（三态都完整实现） */
export type ActionPolicy = 'auto_run' | 'confirm' | 'notify_only'

/** 执行目标：跑工作流 或 发起 Agent 任务 */
export type AutomationTargetType = 'workflow' | 'agent'

/** Agent 目标的会话策略：每 run 新会话 / 每任务复用会话 */
export type SessionStrategy = 'per_run' | 'per_task'

export type InboxStatus = 'pending' | 'confirmed' | 'dismissed' | 'auto_run'

export type AutomationRunStatus = 'running' | 'success' | 'failed' | 'aborted'

// ===== 触发器 =====

/** 定时触发器的友好频率描述（UI 编辑，不暴露原始 cron） */
export interface Schedule {
  kind: 'hourly' | 'daily' | 'weekly' | 'monthly'
  /** kind='hourly'：每 N 小时 */
  everyHours?: number
  /** kind='daily'|'weekly'|'monthly'：时刻 */
  hour?: number
  minute?: number
  /** kind='weekly'：0-6（周日=0） */
  weekday?: number
  /** kind='monthly'：1-31 */
  dayOfMonth?: number
}

export interface TriggerDefinition {
  id: string
  type: TriggerType
  enabled: boolean
  name?: string
  /** 触发器级策略；缺省时用任务的 defaultActionPolicy */
  actionPolicy?: ActionPolicy
  /** type='schedule' 时必填 */
  schedule?: Schedule
  /** type='semantic' 时必填：自然语言条件 */
  semanticCondition?: string
  /** type='chapter_batch'：批次大小，缺省 3，下限 1 */
  chapterBatchSize?: number
}

/** 触发证据（收件箱卡片展示用；也是对模型判定的"可核查性"承诺） */
export interface TriggerEvidence {
  /** 'chapter' | 'foreshadowing' | 'character' | ... */
  source: string
  title: string
  /** 章节号 / id 等可定位引用 */
  ref?: string
  snippet?: string
}

/** 一次触发命中（评估产物；fingerprint 是去重身份） */
export interface TriggerMatch {
  triggerId: string
  title: string
  summary: string
  evidence: TriggerEvidence[]
  /** 触发身份指纹：同指纹只处置一次 */
  fingerprint: string
}

/** 评估上下文：外部事实全部由调用方注入（评估函数保持纯函数可测） */
export interface TriggerContext {
  now: number
  /** 定稿章节（wordCount=0 的占位章节会被评估函数过滤） */
  chapters: Array<{ number: number; title: string; wordCount: number }>
  /** 区间回溯下界（上次检查时间）；首次评估为 undefined */
  lastCheckedAt?: number
  /** semantic 专用：模型调用（注入以便测试 mock；生产实现走 budget 层） */
  callModel?: (prompt: string) => Promise<string>
  /** semantic 专用：章节正文取用（按章节号取全文，供有界上下文构建） */
  readChapterText?: (chapterNumber: number) => string
}

/** semantic 评估的解析结果（模型输出经校验后的形态） */
export interface SemanticEvaluation {
  matched: boolean
  confidence: number
  reason: string
  title: string
  evidenceRefs: string[]
}

// ===== 实体 =====

export interface AutomationTask {
  id: string
  name: string
  enabled: boolean
  targetType: AutomationTargetType
  /** workflow: 工作流类型标识；agent: 任务提示词 */
  targetRef: string
  sessionStrategy: SessionStrategy
  /** per_task 复用的会话 id（首次运行时创建并写回；per_run 恒为 null） */
  sessionId?: string | null
  triggers: TriggerDefinition[]
  defaultActionPolicy: ActionPolicy
  createdAt: number
  updatedAt: number
}

export interface InboxItem {
  id: string
  automationId: string
  triggerId: string
  status: InboxStatus
  actionPolicy: ActionPolicy
  title: string
  summary: string
  evidence: TriggerEvidence[]
  fingerprint: string
  /** 确认运行/自动运行后写入 */
  runId?: string | null
  /** 执行失败原因（卡片上可见，不静默） */
  actionError?: string | null
  createdAt: number
  readAt?: number | null
  handledAt?: number | null
}

export interface AutomationRun {
  id: string
  automationId: string
  triggerType: TriggerType
  targetType: AutomationTargetType
  /** workflow → runId；agent → conversationId */
  refId?: string | null
  status: AutomationRunStatus
  summary?: string
  error?: string
  evidence: TriggerEvidence[]
  startedAt: number
  finishedAt?: number | null
  /** 恢复判定结果（如 'interrupted'） */
  recoveryState?: string | null
}

/** per-trigger 去重状态（automations.trigger_state 列的解析形态） */
export type TriggerStateMap = Record<string, {
  lastCheckedAt?: number
  lastFingerprint?: string
  /**
   * semantic 专用：上次观察到的章节身份（章节号列表）。
   * 未变化时跳过模型调用 —— 指纹只挡重复入箱，挡不住"每 tick 一次调用"的固定成本。
   */
  lastObservationFingerprint?: string
}>

/**
 * 一次触发处置的完整产物 —— **事务写入的输入**（`db:automation-apply-outcome`）。
 * 定义在渲染层 types 里（而非主进程 repository）：渲染层是构造方，
 * 主进程 repository 反向 import 本文件使用（electron 侧已依赖 src 的类型）。
 */
export interface TriggerOutcomeInput {
  automationId: string
  /** 该次评估后要写回的 per-trigger 状态（覆盖式） */
  triggerState: TriggerStateMap
  /** 要入箱的条目（可为空：指纹已处置但无新条目时只推进状态） */
  inboxItems: Array<{
    id: string
    triggerId: string
    status: InboxStatus
    actionPolicy: ActionPolicy
    match: TriggerMatch
    /** auto_run 时关联的 run id（调用方构造产物时确定，入库前显式带过来） */
    runId?: string | null
  }>
  /** auto_run 策略下同时建 run */
  runs: AutomationRun[]
  now: number
}

/** 一次 tick 的产出（调度器内部使用，供测试断言） */
export interface TickOutcome {
  /** 本次提交的收件箱条目 */
  inboxItems: InboxItem[]
  /** 本次推进后的 trigger_state（按 automationId） */
  triggerState: Record<string, TriggerStateMap>
  /** 需要执行的（auto_run 或用户确认后） */
  starts: Array<{ task: AutomationTask; match: TriggerMatch }>
}

// ===== 常量 =====

/** semantic：单章正文截断字符数 */
export const SEMANTIC_CHAPTER_TRUNCATE = 1200
/** semantic：纳入上下文的最大章节数 */
export const SEMANTIC_MAX_CHAPTERS = 20
/** semantic：上下文总预算（字节） */
export const SEMANTIC_CONTEXT_BUDGET = 64 * 1024
/** semantic：置信度阈值（低于即不触发） */
export const SEMANTIC_CONFIDENCE_THRESHOLD = 0.55
/** schedule：首次评估的回溯窗（毫秒）——避免首次运行刷出历史触发点 */
export const SCHEDULE_FIRST_LOOKBACK_MS = 60_000
/** chapter_batch：默认批次大小 */
export const DEFAULT_CHAPTER_BATCH_SIZE = 3
/** 调度器 tick 间隔（毫秒） */
export const SCHEDULER_TICK_MS = 60_000
