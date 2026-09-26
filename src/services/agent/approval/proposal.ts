/**
 * 可固化规则提案与匹配 —— A1，参照 Denova `toolapproval/rule_proposal.go`
 *
 * 核心约束（Denova 原文）：只有「**单一静态调用 + 已知工具族**」才能固化为可复用授权，
 * 其余保持一次性。NF 化后的语义边界宽度：
 *   - 文件类 → **目录**（不按完整路径、更不按内容）
 *   - 工作流类 → **动作名**
 *   - 配置类 → **字段名**
 *   - 外呼 → 仅只读方法（GET/HEAD）+ 路径目录
 * 未知工具族（MCP / skill / 新增未定义边界的工具）一律不产出提案。
 */
import type { ApprovalRequest, ApprovalRule, RuleProposal } from './types'

/** 匹配器标识：语义边界一旦调整必须同时 +1 MATCHER_VERSION，旧规则自动失效（fail-closed 回到询问） */
export const MATCHER = 'args-identity'
export const MATCHER_VERSION = 1

/** 稳定序列化：同一语义的提案逐字节一致（顺序固定，无键排序问题） */
function stableKey(parts: string[]): string {
  return JSON.stringify(parts)
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  return typeof v === 'string' ? v : ''
}

/** 取文件所在目录（归一化分隔符；无目录 → '.'） */
function dirOf(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(0, idx) : '.'
}

/** 路径归一化：统一分隔符、去尾分隔符；Windows 路径大小写不敏感 */
function normalizeProjectPath(p: string): string {
  const unified = p.replace(/\\/g, '/').replace(/\/+$/, '')
  const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
  return isWindows ? unified.toLowerCase() : unified
}

/** FNV-1a 32 位哈希（零依赖、确定性；仅用于 id/审计，非安全用途） */
function fnv1a(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * 规则提案：可固化才产出，否则 null（保持一次性授权）。
 * 前置条件：有项目（scope = workspace）、来源为内置工具、identity 必填参数齐全。
 */
export function proposeRule(req: ApprovalRequest): RuleProposal | null {
  if (!req.projectPath || req.source !== 'builtin') return null

  const p = (identity: string[], pattern: string): RuleProposal => ({
    toolName: req.toolName,
    matcher: MATCHER,
    matcherVersion: MATCHER_VERSION,
    matchKey: stableKey(identity),
    displayPattern: pattern,
  })

  switch (req.toolName) {
    case 'open_editor': {
      const tabType = str(req.args, 'tab_type')
      if (!tabType) return null
      const dir = dirOf(str(req.args, 'file_path'))
      return p(['open_editor', tabType, dir], `open_editor → ${tabType} in ${dir}/`)
    }
    case 'start_workflow': {
      const workflow = str(req.args, 'workflow')
      if (!workflow) return null
      return p(['start_workflow', workflow], `start_workflow → ${workflow}`)
    }
    case 'update_config': {
      const field = str(req.args, 'field')
      if (!field) return null
      return p(['update_config', field], `update_config → ${field}`)
    }
    case 'write_file':
    case 'edit_file': {
      const dir = dirOf(str(req.args, 'file_path'))
      return p([req.toolName, dir], `${req.toolName} → ${dir}/`)
    }
    case 'index_content':
      return p(['index_content'], 'index_content')
    case 'call_external_api': {
      const method = (str(req.args, 'method') || 'GET').toUpperCase()
      // 写方法（POST/PUT/DELETE/PATCH）保持一次性授权：影响面不可界定
      if (method !== 'GET' && method !== 'HEAD') return null
      const dir = dirOf(str(req.args, 'path'))
      return p(['call_external_api', method, dir], `${method} ${dir}/`)
    }
    default:
      // 未定义语义边界的工具族（MCP / skill / 未来新增）保持一次性
      return null
  }
}

/**
 * 规则是否匹配当次提案：**项目路径 + 工具名 + matcher + matcherVersion + matchKey** 五项全等。
 * 项目路径必须重新比对：规则文件随项目目录走（复制/改名/迁移后仍会被读到），
 * 少了这一项，用户在 A 项目的授权会在 B 项目静默生效。
 * 旧规则无 projectPath 字段一律不匹配（fail-closed：多问一次，绝不静默放行）。
 */
export function matchesRule(rule: ApprovalRule, proposal: RuleProposal, projectPath: string): boolean {
  if (!rule.projectPath) return false
  if (normalizeProjectPath(rule.projectPath) !== normalizeProjectPath(projectPath)) return false
  return rule.toolName === proposal.toolName
    && rule.matcher === proposal.matcher
    && rule.matcherVersion === proposal.matcherVersion
    && rule.matchKey === proposal.matchKey
}

/** 由提案生成可持久化规则（id 与 projectPath 字段都绑定项目 —— 复制/改名后规则失效） */
export function makeRule(proposal: RuleProposal, projectPath: string, args: Record<string, unknown>): ApprovalRule {
  const normalized = normalizeProjectPath(projectPath)
  const hash = fnv1a(`${normalized}::${proposal.toolName}::${proposal.matchKey}`)
  return {
    id: `approval-${hash}`,
    toolName: proposal.toolName,
    matcher: proposal.matcher,
    matcherVersion: proposal.matcherVersion,
    matchKey: proposal.matchKey,
    projectPath: normalized,
    displayPattern: proposal.displayPattern,
    approvedArgsHash: fnv1a(JSON.stringify(args)),
    createdAt: new Date().toISOString(),
  }
}
