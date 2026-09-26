import { describe, it, expect } from 'vitest'
import { evaluateApproval, ruleFromApproval } from './policy'
import { proposeRule, makeRule } from './proposal'
import type { ApprovalDecision, ApprovalRequest } from './types'

function base(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    projectPath: 'E:/novels/demo',
    toolName: 'start_workflow',
    args: { workflow: 'generate_draft' },
    descriptor: { requiresConfirmation: true, isReadOnly: false },
    source: 'builtin',
    rules: [],
    ...over,
  }
}

describe('evaluateApproval 优先级：deny > 规则命中 > prompt', () => {
  it('危险命中 → deny（即使存在匹配的已固化规则也拒绝）', () => {
    const dangerous = base({ toolName: 'write_file', args: { file_path: '.novelforge/x.json', content: 'x' } })
    const proposal = proposeRule(dangerous)!
    expect(proposal).not.toBeNull()                                    // 该调用本可固化
    const rule = makeRule(proposal, 'E:/novels/demo', dangerous.args)
    const d = evaluateApproval({ ...dangerous, rules: [rule] })
    expect(d.action).toBe('deny')
    expect(d.ruleId).toBe('critical_protected_path')
  })

  it('命中已固化规则 → allow（ruleId 来自规则，理由含描述）', () => {
    const proposal = proposeRule(base())!
    const rule = makeRule(proposal, 'E:/novels/demo', { workflow: 'generate_draft' })
    const d = evaluateApproval(base({ rules: [rule] }))
    expect(d.action).toBe('allow')
    expect(d.ruleId).toBe(rule.id)
    expect(d.reasonParams?.pattern).toContain('generate_draft')
  })

  it('无规则命中 → prompt 且带提案（可固化）', () => {
    const d = evaluateApproval(base())
    expect(d.action).toBe('prompt')
    expect(d.remember?.toolName).toBe('start_workflow')
  })

  it('规则存在但 identity 不匹配 → 仍 prompt', () => {
    const other = base({ args: { workflow: 'finalize' } })
    const rule = makeRule(proposeRule(other)!, 'E:/novels/demo', other.args)
    const d = evaluateApproval(base({ rules: [rule] }))
    expect(d.action).toBe('prompt')
  })

  it('只读工具 → allow（不产生提案）', () => {
    const d = evaluateApproval(base({ descriptor: { requiresConfirmation: false, isReadOnly: true } }))
    expect(d.action).toBe('allow')
    expect(d.remember).toBeUndefined()
  })

  it('不可固化工具（MCP）→ prompt 无提案、风险定为 high', () => {
    const d = evaluateApproval(base({ source: 'mcp', toolName: 'mcp__x__y' }))
    expect(d.action).toBe('prompt')
    expect(d.remember).toBeUndefined()
    expect(d.risk).toBe('high')
  })

  it('无项目（projectPath=null）→ prompt 无提案（不可固化）', () => {
    const d = evaluateApproval(base({ projectPath: null }))
    expect(d.action).toBe('prompt')
    expect(d.remember).toBeUndefined()
  })
})

describe('ruleFromApproval 批准后的规则固化决策（store 闭包的可测部分）', () => {
  const decision: ApprovalDecision = {
    action: 'prompt',
    risk: 'medium',
    ruleId: 'prompt_rememberable',
    reasonKey: 'approval.promptWithRemember',
    remember: {
      toolName: 'start_workflow',
      matcher: 'args-identity',
      matcherVersion: 1,
      matchKey: '["start_workflow","generate_draft"]',
      displayPattern: 'start_workflow → generate_draft',
    },
  }

  it('批准 + 始终允许 + 有提案 → 产出规则', () => {
    const rule = ruleFromApproval(decision, 'E:/novels/demo', { workflow: 'generate_draft' }, true, true)
    expect(rule?.toolName).toBe('start_workflow')
    expect(rule?.id.startsWith('approval-')).toBe(true)
  })

  it('仅批准（未选始终允许）→ 不产出规则', () => {
    expect(ruleFromApproval(decision, 'E:/novels/demo', {}, true, false)).toBeUndefined()
  })

  it('拒绝 → 不产出规则（即使勾了始终允许）', () => {
    expect(ruleFromApproval(decision, 'E:/novels/demo', {}, false, true)).toBeUndefined()
  })

  it('决策无提案（MCP 工具 / 危险路径）→ 不产出规则', () => {
    expect(ruleFromApproval({ ...decision, remember: undefined }, 'E:/novels/demo', {}, true, true)).toBeUndefined()
  })

  it('无项目路径 → 不产出规则（scope 必须 workspace）', () => {
    expect(ruleFromApproval(decision, null, {}, true, true)).toBeUndefined()
  })
})
