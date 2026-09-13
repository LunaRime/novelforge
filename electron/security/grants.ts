/**
 * 路径授权与判定（L4 设计 §4.3）——**纯逻辑，不 import electron**，可离线单测。
 *
 * 两个职责分开，避免把「策略」和「登记」搅在一个可变状态里：
 *  - `isPathAllowed(candidate, intent, policy)`：**判定**。纯函数，根与授权集都由入参给定。
 *  - `grantPath/revokeGrant/...`：**登记**。会话级授权集（进程重启即失效，与改造前一致）。
 *
 * 改造前的边界（`fs-controller.ts` 的 `SANDBOX_ROOTS = [VELA_HOME, os.homedir()]` + 黑名单）
 * 实质等于「整个用户主目录可读写」，且 `fs:grant-external-file` 允许渲染层自报路径登记授权。
 * 本模块把边界换成**显式白名单 + 意图分级**：
 *   VELA_HOME ∪ 当前项目根 ∪ 会话内由主进程签发的授权，其余默认拒绝。
 *
 * ⚠️ S8/S9 的过渡：`PathPolicy.legacyHomeDir` 保留主目录根（与改造前等价），
 * 便于先接线、后收紧；S9 只需把它置空（单点可回滚）。
 */
import path from 'node:path'
import { t } from '../../src/shared/locale'

/** 路径意图——读授权 ≠ 写授权 ≠ 删授权 */
export type PathIntent = 'read' | 'write' | 'delete'

/** 判定所需的全部外部输入（纯函数入参；便于单测构造任意场景） */
export interface PathPolicy {
  /** 应用数据目录（`~/.novelforge`）：本应用自己的数据，默认可读写删 */
  velaHome: string
  /** 当前打开的项目根；未打开项目时为 null */
  projectRoot?: string | null
  /** 会话内授权（主进程对话框签发）：绝对路径 → 允许的意图集合 */
  granted: ReadonlyMap<string, ReadonlySet<PathIntent>>
  /**
   * ⚠️ S8 过渡期保留的「主目录」根（改造前 `SANDBOX_ROOTS` 含 `os.homedir()`）。
   * S9 将其置空即完成收紧——**只改这一处**，便于单点回滚。
   */
  legacyHomeDir?: string | null
}

/**
 * 即使在白名单内也**不得经 IPC 读写**的文件（只允许主进程内部访问）。
 * 含 API Key / MCP 环境变量等凭据，渲染层没有任何合法读取理由。
 */
const IPC_FORBIDDEN_BASENAMES = new Set(['config.json', 'mcp_config.json'])

/** 绝对化 + 平台归一化（Windows 大小写不敏感，避免 CONFIG.JSON 绕过拒绝名单） */
function norm(p: string): string {
  const abs = path.resolve(p)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

/** candidate 是否等于 root 或位于 root 之内（按路径段比较，防 `/a/bc` 命中 `/a/b`） */
function isInside(candidate: string, root: string): boolean {
  const c = norm(candidate)
  const r = norm(root)
  if (c === r) return true
  return c.startsWith(r.endsWith(path.sep) ? r : r + path.sep)
}

/** 该路径是否落在 `velaHome` 内且属于「禁止经 IPC 访问」的凭据文件 */
function isForbiddenCredentialFile(candidate: string, velaHome: string): boolean {
  const c = norm(candidate)
  const home = norm(velaHome)
  const rel = c.startsWith(home + path.sep) ? c.slice(home.length + 1) : null
  if (rel === null) return false
  // 只拦截 velaHome 根级的凭据文件（子目录里的同名文件不敏感，如项目内 config.json）
  return !rel.includes(path.sep) && IPC_FORBIDDEN_BASENAMES.has(rel)
}

/**
 * 判定 `candidate` 在 `policy` 下是否允许 `intent` 操作。
 *
 * 放行条件（任一成立）：
 *  ① 位于 `velaHome` 内（且不是凭据文件）；
 *  ② 位于当前项目根内；
 *  ③ 位于某个**带该意图**的会话授权内；
 *  ④ 位于过渡期的 `legacyHomeDir` 内（S9 移除）。
 */
export function isPathAllowed(candidate: string, intent: PathIntent, policy: PathPolicy): boolean {
  if (!candidate || typeof candidate !== 'string' || !candidate.trim()) return false
  if (isForbiddenCredentialFile(candidate, policy.velaHome)) return false

  if (isInside(candidate, policy.velaHome)) return true
  if (policy.projectRoot && isInside(candidate, policy.projectRoot)) return true
  for (const [grantedPath, intents] of policy.granted) {
    if (intents.has(intent) && isInside(candidate, grantedPath)) return true
  }
  if (policy.legacyHomeDir && isInside(candidate, policy.legacyHomeDir)) return true
  return false
}

/**
 * 断言版：不允许时抛错。错误消息沿用既有 i18n key（`validateSandbox` 原本就用这两个）。
 * @throws Error 路径越界（`error.fsAccessDenied`）或命中凭据拒绝名单（`error.fsAccessProtected`）
 */
export function assertPathAllowed(candidate: string, intent: PathIntent, policy: PathPolicy): string {
  if (isForbiddenCredentialFile(candidate, policy.velaHome)) {
    throw new Error(t('error.fsAccessProtected').replace('{path}', () => candidate))
  }
  if (!isPathAllowed(candidate, intent, policy)) {
    throw new Error(t('error.fsAccessDenied').replace('{path}', () => candidate))
  }
  return path.resolve(candidate)
}

// ===== 会话级授权登记（由主进程签发；渲染层无法自行登记） =====

const grantedPaths = new Map<string, Set<PathIntent>>()

/**
 * 登记一条授权。**只应由主进程在对话框结果处理点调用**——
 * 改造前渲染层可自行调用 `fs:grant-external-file` 上报任意路径，这正是要消除的缺口。
 */
export function grantPath(absPath: string, intents: readonly PathIntent[]): void {
  if (!absPath || typeof absPath !== 'string' || !absPath.trim()) return
  const key = norm(absPath)
  const set = grantedPaths.get(key) ?? new Set<PathIntent>()
  for (const i of intents) set.add(i)
  grantedPaths.set(key, set)
}

export function revokeGrant(absPath: string): void {
  grantedPaths.delete(norm(absPath))
}

/** 当前授权集（供构造 `PathPolicy`；返回只读视图的副本） */
export function currentGrants(): ReadonlyMap<string, ReadonlySet<PathIntent>> {
  return new Map(grantedPaths)
}

/** 仅供测试：清空授权集（进程重启即失效的真实语义） */
export function clearGrantsForTest(): void {
  grantedPaths.clear()
}
