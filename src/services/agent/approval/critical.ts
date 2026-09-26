/**
 * 危险操作硬拒绝（fail-closed）—— A3，参照 Denova `toolapproval/critical.go`
 *
 * 与路径沙箱（`src/services/agent/tools/safe-path.ts` + 主进程 `fs-controller` 的
 * BLOCKED_PATHS）是**两道独立防线**：沙箱在工具实现内部，这里在审批层——
 * 防止未来新增工具忘记接沙箱。
 *
 * NF 与 Denova 的差异：NF 没有 shell 工具，`rm -rf /` 类规则没有落点；
 * 这里映射的是 NF 真实存在的危险面（凭据外泄 / SSRF / 沙箱绕过）。
 */
import type { CriticalHit } from './types'

/** 受保护目录段（与 src/services/agent/tools/safe-path.ts 的 PROJECT_DATA_DIR_SEGMENTS 同源） */
const PROTECTED_SEGMENTS = ['.novelforge', '.vela', '.git', 'node_modules']

function firstString(args: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = args[k]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

/** 归一化路径分隔符后判断是否落在受保护目录内（含中段形式 sub/.git/config） */
function touchesProtectedDir(p: string): boolean {
  const normalized = p.replace(/\\/g, '/').toLowerCase()
  return PROTECTED_SEGMENTS.some(seg =>
    normalized === seg || normalized.startsWith(seg + '/') || normalized.includes('/' + seg + '/'),
  )
}

/** 相对路径是否向上越界（.. 段使深度 < 0） */
function escapesRoot(p: string): boolean {
  const parts = p.replace(/\\/g, '/').split('/')
  let depth = 0
  for (const seg of parts) {
    if (seg === '..') {
      depth--
      if (depth < 0) return true
    } else if (seg !== '.' && seg !== '') {
      depth++
    }
  }
  return false
}

/** 出站内容里的凭据形态（保守模式：只作用于 call_external_api，避免误杀正文写作） */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/i,
  // JSON body 的键名带引号（"api_key": "..."）——键名后允许引号再跟分隔符
  /\b(api[_-]?key|apikey|access[_-]?token|secret)["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i,
]

/**
 * 危险操作硬拒绝：命中即 deny，用户批准也不放行。
 * 顺序：路径逃逸 → 受保护目录 →（外呼）绝对 URL →（外呼）出站凭据。
 */
export function matchCritical(toolName: string, args: Record<string, unknown>): CriticalHit | null {
  if (toolName === 'write_file' || toolName === 'edit_file') {
    const p = firstString(args, ['file_path', 'path'])
    if (p && escapesRoot(p)) {
      return {
        ruleId: 'critical_path_escape',
        risk: 'critical',
        reasonKey: 'approval.critical.pathEscape',
        reasonParams: { path: p },
      }
    }
    if (p && touchesProtectedDir(p)) {
      return {
        ruleId: 'critical_protected_path',
        risk: 'critical',
        reasonKey: 'approval.critical.protectedPath',
        reasonParams: { path: p },
      }
    }
  }

  if (toolName === 'call_external_api') {
    const path = firstString(args, ['path'])
    if (/^[a-z]+:\/\//i.test(path) || path.startsWith('//')) {
      return {
        ruleId: 'critical_absolute_url',
        risk: 'critical',
        reasonKey: 'approval.critical.absoluteUrl',
        reasonParams: { path },
      }
    }
    const outbound = firstString(args, ['body'])
    if (outbound && CREDENTIAL_PATTERNS.some(re => re.test(outbound))) {
      return {
        ruleId: 'critical_external_credentials',
        risk: 'critical',
        reasonKey: 'approval.critical.credentials',
      }
    }
  }

  return null
}
