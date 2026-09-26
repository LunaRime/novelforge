import { describe, it, expect } from 'vitest'
import { proposeRule, matchesRule, makeRule } from './proposal'
import type { ApprovalRequest } from './types'

function req(
  toolName: string,
  args: Record<string, unknown>,
  source: 'builtin' | 'mcp' | 'skill' = 'builtin',
): ApprovalRequest {
  return {
    projectPath: 'E:/novels/demo',
    toolName,
    args,
    descriptor: { requiresConfirmation: true, isReadOnly: false },
    source,
    rules: [],
  }
}

describe('proposeRule 可固化边界（对标 Denova「单一静态调用 + 已知命令族」）', () => {
  it('open_editor：按 tab_type + 目录固化', () => {
    const p = proposeRule(req('open_editor', { file_path: 'drafts/ch1.md', tab_type: 'draft' }))
    expect(p?.toolName).toBe('open_editor')
    expect(p?.displayPattern).toContain('draft')
    expect(p?.matchKey).toContain('drafts')
  })

  it('start_workflow：按工作流名固化（章节号不影响 identity）', () => {
    const p = proposeRule(req('start_workflow', { workflow: 'generate_draft', chapter_number: 3 }))
    expect(p?.matchKey).toBe(JSON.stringify(['start_workflow', 'generate_draft']))
    expect(p?.displayPattern).toContain('generate_draft')
  })

  it('update_config：按字段固化', () => {
    const p = proposeRule(req('update_config', { field: 'totalChapters', value: '120' }))
    expect(p?.matchKey).toBe(JSON.stringify(['update_config', 'totalChapters']))
  })

  it('write_file：仅按目录固化，不按整份文件内容', () => {
    const a = proposeRule(req('write_file', { file_path: 'drafts/ch1.md', content: 'A' }))
    const b = proposeRule(req('write_file', { file_path: 'drafts/ch2.md', content: 'B' }))
    expect(a?.matchKey).toBe(b?.matchKey)          // 同目录 → 同一规则
    expect(a?.displayPattern).toContain('drafts')
  })

  it('call_external_api：只读方法可固化，写方法保持一次性', () => {
    expect(proposeRule(req('call_external_api', { path: '/api/status', method: 'GET' }))).not.toBeNull()
    expect(proposeRule(req('call_external_api', { path: '/api/status', method: 'POST', body: '{}' }))).toBeNull()
    expect(proposeRule(req('call_external_api', { path: '/api/x', method: 'DELETE' }))).toBeNull()
  })

  it('MCP 工具与 skill 来源不可固化（参数 schema 未知）', () => {
    expect(proposeRule(req('mcp__foo__bar', { x: 1 }, 'mcp'))).toBeNull()
    expect(proposeRule(req('skill__demo', {}, 'skill'))).toBeNull()
  })

  it('无项目时不可固化', () => {
    const r = req('open_editor', { file_path: 'a.md', tab_type: 'draft' })
    expect(proposeRule({ ...r, projectPath: null })).toBeNull()
  })
})

describe('matchesRule 匹配与失效', () => {
  const base = req('start_workflow', { workflow: 'generate_draft' })
  const proposal = proposeRule(base)!
  const rule = makeRule(proposal, 'E:/novels/demo', base.args)

  it('同工具同 identity 命中（章节号等非 identity 参数不影响）', () => {
    const next = proposeRule(req('start_workflow', { workflow: 'generate_draft', chapter_number: 9 }))!
    expect(matchesRule(rule, next)).toBe(true)
  })

  it('不同 identity 不命中', () => {
    const other = proposeRule(req('start_workflow', { workflow: 'finalize' }))!
    expect(matchesRule(rule, other)).toBe(false)
  })

  it('matcherVersion 不同 → 不命中（fail-closed）', () => {
    const p = proposeRule(req('start_workflow', { workflow: 'generate_draft' }))!
    expect(matchesRule(rule, { ...p, matcherVersion: p.matcherVersion + 1 })).toBe(false)
  })

  it('规则 id 稳定且含项目隔离', () => {
    const other = makeRule(proposal, 'E:/novels/other', base.args)
    expect(rule.id).not.toBe(other.id)
    expect(rule.id.startsWith('approval-')).toBe(true)
    // 同项目同提案 → 同 id（稳定）
    expect(makeRule(proposal, 'E:/novels/demo', base.args).id).toBe(rule.id)
  })
})
