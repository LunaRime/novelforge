/**
 * 审批决策编排 —— 参照 Denova `toolapproval.Evaluate(request)`
 *
 * 优先级**不可调换**：
 *   ① 危险硬拒绝（matchCritical，fail-closed）
 *   ② 只读工具直接放行
 *   ③ 已固化规则命中（workspace 级批准记忆）
 *   ④ 兜底：prompt（可固化时附提案）
 *
 * 纯函数：调用方负责持久化（store.ts）与 UI（ConfirmCard）。决策携带稳定 `ruleId`
 * 供审计与 UI 本地化 —— 理由文案不在此处拼接。
 */
import { matchCritical } from './critical'
import { proposeRule, matchesRule, makeRule } from './proposal'
import type { ApprovalDecision, ApprovalRequest, ApprovalRule } from './types'

export function evaluateApproval(req: ApprovalRequest): ApprovalDecision {
  // ① 危险硬拒绝：用户批准也不放行（与路径沙箱互为独立防线）
  const critical = matchCritical(req.toolName, req.args)
  if (critical) {
    return {
      action: 'deny',
      risk: critical.risk,
      ruleId: critical.ruleId,
      reasonKey: critical.reasonKey,
      reasonParams: critical.reasonParams,
    }
  }

  // ② 只读工具：无副作用，直接放行
  if (req.descriptor.isReadOnly && !req.descriptor.requiresConfirmation) {
    return { action: 'allow', risk: 'low', ruleId: 'read_only', reasonKey: 'approval.readOnly' }
  }

  // ③ 已固化规则命中（仅当次调用仍能产出同一身份时才算数——fail-closed）
  const proposal = proposeRule(req)
  if (proposal) {
    const hit = req.rules.find(r => matchesRule(r, proposal))
    if (hit) {
      return {
        action: 'allow',
        risk: 'medium',
        ruleId: hit.id,
        reasonKey: 'approval.ruleHit',
        reasonParams: { pattern: hit.displayPattern },
      }
    }
  }

  // ④ 兜底：需要用户确认；可固化时把提案一并交给 UI（"始终允许"按钮的数据源）
  return {
    action: 'prompt',
    risk: proposal ? 'medium' : 'high',
    ruleId: proposal ? 'prompt_rememberable' : 'prompt_one_shot',
    reasonKey: proposal ? 'approval.promptWithRemember' : 'approval.promptOneShot',
    remember: proposal ?? undefined,
  }
}

/**
 * 用户响应后的规则固化决策 —— 从 agent-store 闭包提取为纯函数以便单测。
 * 三条前置全满足才产出规则：用户批准 + 选了「本项目内始终允许」+ 决策带可固化提案且有项目。
 * 返回 undefined 表示本次不固化（保持一次性批准）。
 */
export function ruleFromApproval(
  decision: ApprovalDecision | undefined,
  projectPath: string | null | undefined,
  args: Record<string, unknown>,
  confirmed: boolean,
  alwaysAllow: boolean,
): ApprovalRule | undefined {
  if (!confirmed || !alwaysAllow) return undefined
  if (!decision?.remember || !projectPath) return undefined
  return makeRule(decision.remember, projectPath, args)
}
