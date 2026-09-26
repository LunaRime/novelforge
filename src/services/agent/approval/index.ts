/** 工具审批决策层出口（A 档：A1 参数语义边界 / A2 workspace 批准记忆 / A3 危险硬拒绝） */
export type {
  ApprovalAction,
  ApprovalRisk,
  ApprovalRequest,
  ApprovalDecision,
  ApprovalRule,
  RuleProposal,
  CriticalHit,
} from './types'

export { matchCritical } from './critical'
export { proposeRule, matchesRule, makeRule, MATCHER, MATCHER_VERSION } from './proposal'
export { evaluateApproval, ruleFromApproval } from './policy'
export {
  loadApprovalRules,
  appendApprovalRule,
  clearApprovalRules,
  APPROVALS_RELATIVE_PATH,
} from './store'
