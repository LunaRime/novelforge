/**
 * 工具审批（tool approval）决策层类型 —— A 档，参照 Denova `internal/agents/toolapproval/policy.go`
 *
 * 三态语义：allow = 放行；prompt = 需要用户确认；deny = 硬拒绝（用户也无法放行）。
 * 决策层是**纯函数**：调用方（agent-store）负责持久化与 UI。
 */

/** 审批决策三态 */
export type ApprovalAction = 'allow' | 'prompt' | 'deny'

/** 风险分级（UI 展示与审计用） */
export type ApprovalRisk = 'low' | 'medium' | 'high' | 'critical'

/** 危险规则命中结果（critical.ts 产出） */
export interface CriticalHit {
  ruleId: string
  risk: 'critical'
  /** i18n key（UI 本地化），参数见 reasonParams */
  reasonKey: string
  reasonParams?: Record<string, string>
}

/** 已固化的 workspace 批准规则（持久化于 {project}/.novelforge/approvals.json） */
export interface ApprovalRule {
  /** 稳定 id：approval-<hash(projectPath + toolName + matchKey)> */
  id: string
  toolName: string
  matcher: string
  matcherVersion: number
  /** 参数身份 JSON（稳定序列化）；命中需与当次提案逐字节一致 */
  matchKey: string
  /** 人类可读描述（如 `write_file → drafts/`） */
  displayPattern: string
  /** 审计：批准时的参数哈希 */
  approvedArgsHash: string
  createdAt: string
}

/** 当次调用可固化的规则提案（仅 prompt 决策时给出） */
export interface RuleProposal {
  toolName: string
  matcher: string
  matcherVersion: number
  matchKey: string
  displayPattern: string
}

/** 审批决策请求（全部为稳定事实，调用方不得自行推断 workspace） */
export interface ApprovalRequest {
  /** 项目根绝对路径；null = 无项目 → 不可固化、不可匹配规则 */
  projectPath: string | null
  toolName: string
  args: Record<string, unknown>
  /** 工具声明的静态属性 */
  descriptor: { requiresConfirmation: boolean; isReadOnly: boolean }
  /** 工具来源：builtin / mcp（参数 schema 未知，不可固化）/ skill */
  source: 'builtin' | 'mcp' | 'skill'
  /** 该项目已固化的规则 */
  rules: ApprovalRule[]
}

export interface ApprovalDecision {
  action: ApprovalAction
  risk: ApprovalRisk
  ruleId: string
  reasonKey: string
  reasonParams?: Record<string, string>
  /** 仅 prompt 且可固化时存在 */
  remember?: RuleProposal
}
