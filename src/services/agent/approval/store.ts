/**
 * workspace 级批准记忆持久化 —— A2，参照 Denova `config/agent_approval.go`
 * （原文注明 workspace 是 *deliberately the only persisted scope*）
 *
 * 落点选择理由：
 *   ① scope 必须是 workspace（A2 要求）→ 项目内 `.novelforge/` 是 NF 里 workspace 的等价物
 *   ② 该目录被 `isProtectedRelativePath`（src/services/agent/tools/safe-path.ts）列为
 *      agent 不可写 —— 规则文件不会被 agent 自己篡改
 *
 * 通道沿用项目内既有范式（对照 src/services/audit/audit-context.ts 的白名单读写）。
 */
import { ipc } from '../../ipc-client'
import { DIR_VELA_INTERNAL } from '../../../shared/project-paths'
import type { ApprovalRule } from './types'

export const APPROVALS_RELATIVE_PATH = `${DIR_VELA_INTERNAL}/approvals.json`

interface ApprovalsFile {
  version: 1
  rules: ApprovalRule[]
}

function fullPath(projectPath: string): string {
  return `${projectPath.replace(/[\\/]+$/, '')}/${APPROVALS_RELATIVE_PATH}`
}

function isValidRule(v: unknown): v is ApprovalRule {
  const r = v as Partial<ApprovalRule> | null
  return !!r
    && typeof r.id === 'string' && r.id.length > 0
    && typeof r.toolName === 'string'
    && typeof r.matcher === 'string'
    && typeof r.matcherVersion === 'number'
    && typeof r.matchKey === 'string'
    // projectPath 必填：旧格式（无此字段）的规则一律丢弃 —— fail-closed，重新询问一次
    && typeof r.projectPath === 'string' && r.projectPath.length > 0
}

/**
 * 读取项目级批准规则。
 * 任何异常（文件不存在 / JSON 损坏 / 形状不符）→ 空数组：fail-closed，
 * 宁可多问一次用户，不可静默放行。
 */
export async function loadApprovalRules(projectPath: string): Promise<ApprovalRule[]> {
  try {
    const res = await ipc.invoke('fs:read-file', fullPath(projectPath)) as { success?: boolean; content?: string } | null
    if (!res?.success || !res.content) return []
    const parsed = JSON.parse(res.content) as Partial<ApprovalsFile>
    if (!Array.isArray(parsed?.rules)) return []
    return parsed.rules.filter(isValidRule)
  } catch {
    return []
  }
}

/**
 * 写入规则文件；失败必须抛出 —— 调用方据此记录日志（评审 I3）。
 * 静默吞掉 `{success:false}` 会让用户以为"已记住"（确认卡上写了「将记住：…」），
 * 而下次同一调用又弹卡且无任何解释。
 */
async function writeApprovalsFile(projectPath: string, payload: ApprovalsFile): Promise<void> {
  const res = await ipc.invoke('fs:write-file', fullPath(projectPath), JSON.stringify(payload, null, 2)) as { success?: boolean; error?: string } | null
  if (!res?.success) throw new Error(res?.error ?? 'approval rule write failed')
}

/** 追加规则（同 id 去重）：读-合并-写全量 */
export async function appendApprovalRule(projectPath: string, rule: ApprovalRule): Promise<void> {
  const existing = await loadApprovalRules(projectPath)
  const merged = existing.some(r => r.id === rule.id) ? existing : [...existing, rule]
  await writeApprovalsFile(projectPath, { version: 1, rules: merged })
}

/** 清空项目全部规则（规则管理 UI 的预留接口） */
export async function clearApprovalRules(projectPath: string): Promise<void> {
  await writeApprovalsFile(projectPath, { version: 1, rules: [] })
}
