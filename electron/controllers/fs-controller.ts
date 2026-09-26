import { DEFAULT_LOCALE, t } from '../../src/shared/locale'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { FileNode, WorkflowOutputTailOptions } from '../../src/shared/ipc-channels'
import { VELA_HOME } from '../utils/config-utils'
import { getCurrentProjectPath } from '../database'
import {
  assertPathAllowed,
  currentGrants,
  grantPath,
  hasGrantFor,
  revokeGrant,
  type PathIntent,
  type PathPolicy,
} from '../security/grants'
import { safeErrorMessage } from '../utils/error-utils'
import { scanTextWindow } from '../utils/read-text-window'
import { logger } from '../utils/logger'
import { WorkflowOutputFileStore } from '../utils/workflow-output-store'
import { guardedHandle } from '../security/ipc-guard'

/**
 * 路径权限（L4 S8）——判定逻辑在 `electron/security/grants.ts`（纯模块，可离线单测）。
 *
 * 改造前这里是 `SANDBOX_ROOTS = [VELA_HOME, os.homedir()]` + 黑名单，实质等于
 * **整个用户主目录可读写**，且授权可由渲染层自行登记（`fs:grant-external-file`）。现在：
 *   白名单 = VELA_HOME ∪ 当前项目根 ∪ 会话内**由主进程签发**的授权
 *   + 意图分级（读/写/删分别判定）
 *   + 拒绝名单（纵深防御）
 * ⚠️ `legacyHomeDir` 在 S8 过渡期仍等于主目录（与改造前等价）；**S9 置空即完成收紧**。
 */

/** 外部文件读取限制（Agent 添加项目外文件专用通道）：
 * 用户通过系统对话框显式选择，信任用户意图，不套沙箱（可能在任何磁盘），
 * 以可读扩展名 + 大小上限做防御。
 * ⚠️ 安全边界（2026-08-07 修复）：仅放行「用户对话框显式选择过」的路径（grantedExternalFiles
 * 登记，见 fs:grant-external-file）或项目目录内文件；BLOCKED_PATHS 同样适用。
 * 此前 LLM 可传任意绝对路径（含 ~/.ssh/AppData 的 .json）无确认读取，注入 LLM 上下文。 */
const EXTERNAL_MAX_BYTES = 1_048_576 // 1MB
const INTERNAL_MAX_BYTES = 5 * 1_048_576 // 5MB（项目内读取上限）
const EXTERNAL_READABLE_EXTS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.markdown'])

// ===== C1 窗口读（read_file offset/limit 流式化）： =====
// - 无 offset/limit → 既有全量读路径（大小上限 = 安全网，行为兼容）；
// - 带 offset/limit → 主进程按 [offset, offset+limit) 读窗口：≤ 上限文件整读切片（精确 totalChars），
//   > 上限文件流式扫描（scanTextWindow：只累计窗口内内容，窗口外仅计数，读 100GB 文件首窗口不爆 RSS）
const WINDOW_LIMIT_MAX = 1_000_000 // 窗口内容长度上限（字符）——防 LLM 请求荒谬 limit 引发超长扫描

interface ReadWindowSpec {
  windowed: boolean
  offset: number
  limit: number
}

/** 清洗渲染层可选窗口参数（与 read_file 工具 parse 语义对齐：offset<0→0；limit<1→非窗口） */
function parseReadWindow(options: unknown): ReadWindowSpec {
  if (!options || typeof options !== 'object') return { windowed: false, offset: 0, limit: 0 }
  const o = options as { offset?: unknown; limit?: unknown }
  const offset =
    typeof o.offset === 'number' && Number.isFinite(o.offset) && o.offset >= 0 ? Math.floor(o.offset) : 0
  const rawLimit = typeof o.limit === 'number' && Number.isFinite(o.limit) ? Math.floor(o.limit) : 0
  if (rawLimit < 1) return { windowed: false, offset: 0, limit: 0 }
  return { windowed: true, offset, limit: Math.min(rawLimit, WINDOW_LIMIT_MAX) }
}

/** 窗口读快路径（文件 ≤ 全量上限）：整读 + 内存切片，totalChars 精确 */
function windowFromFullText(
  fullText: string,
  spec: ReadWindowSpec,
): { content: string; totalChars: number; beyond: boolean } {
  const total = fullText.length
  if (spec.offset >= total) return { content: '', totalChars: total, beyond: true }
  return {
    content: fullText.slice(spec.offset, spec.offset + spec.limit),
    totalChars: total,
    beyond: false,
  }
}

/** 超大文件窗口读（size > 全量上限）：流式扫描 + 元数据回填 */
async function windowFromHugeFile(
  filePath: string,
  spec: ReadWindowSpec,
  statSize: number,
): Promise<{ content: string; totalChars?: number; beyond?: boolean }> {
  // 字符数 ≤ 字节数（UTF-8 每字符 ≥ 1 字节）：offset 字符 ≥ 字节数 ⇒ 必越界，免扫描
  if (spec.offset >= statSize) return { content: '', beyond: true }
  const scanned = await scanTextWindow(filePath, spec.offset, spec.limit)
  const res: { content: string; totalChars?: number; beyond?: boolean } = { content: scanned.content }
  const total = scanned.eof ? scanned.totalChars : undefined
  if (total !== undefined) {
    res.totalChars = total
    if (spec.offset >= total) res.beyond = true
  }
  return res
}

/**
 * 工作流任务输出文件仓库（M2，CC §三.4 双轨补充通道）：
 * `{VELA_HOME}/workflow-output/<runId>/<stepIndex>.txt`——纯 fs 单测见 utils 测试。
 * 崩溃残留兜底清理窗口：7 天（超龄 run 目录启动时 sweep；保留窗口内文件供恢复续读）
 */
const WORKFLOW_OUTPUT_DIR = path.join(VELA_HOME, 'workflow-output')
const WORKFLOW_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const workflowOutputStore = new WorkflowOutputFileStore(WORKFLOW_OUTPUT_DIR)

/** 禁止访问的敏感目录（纵深防御第二道；边界由白名单承担）——S8 补齐了评审点名缺失的项 */
const BLOCKED_PATHS = [
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.aws'),
  path.join(os.homedir(), '.docker'),
  path.join(os.homedir(), '.kube'),
  path.join(os.homedir(), '.npmrc'),
  path.join(os.homedir(), '.git-credentials'),
  path.join(os.homedir(), '.config'),
  path.join(os.homedir(), '.local'),
  path.join(os.homedir(), '.vscode'),
  path.join(os.homedir(), 'AppData', 'Roaming'),
  path.join(os.homedir(), 'AppData', 'Local'),
  path.join(os.homedir(), 'AppData', 'LocalLow'),
  process.env.WINDIR || 'C:\\Windows',
  process.env.SYSTEMROOT || 'C:\\Windows',
  '/etc', '/sys', '/proc', '/dev',
]

/**
 * 组装当前策略。**每次调用现取**：项目根会随打开/关闭项目变化，授权集是会话级可变的。
 */
function currentPathPolicy(): PathPolicy {
  return {
    velaHome: VELA_HOME,
    projectRoot: getCurrentProjectPath(),
    granted: currentGrants(),
    blockedPaths: BLOCKED_PATHS,
    // ⚠️ S9（本行即「移除主目录根」的**单点开关**）：
    //   改造前 `SANDBOX_ROOTS = [VELA_HOME, os.homedir()]` —— 整个用户主目录可读写。
    //   现在起边界 = VELA_HOME ∪ 当前项目根 ∪ 主进程对话框签发的授权，其余默认拒绝。
    //   回滚方式：把本行改回 `os.homedir()` 即恢复 S8 的过渡态（行为与改造前等价）。
    //   注意：项目根是 `getCurrentProjectPath()`，与盘符无关 —— 因此「主目录之外的
    //   项目」（如 D:\…）反而因此**修好了**（改造前它连文件树都读不出来）。
    legacyHomeDir: null,
  }
}

/**
 * 登记用户通过系统对话框确认的目录（会话级授权）。
 * **只应由主进程的对话框处理器调用**——渲染层没有登记入口（这正是改造前缺口 A）。
 */
export function grantDirectory(dirPath: string): void {
  grantPath(dirPath, ['read', 'write', 'delete'])
}

/** 登记单个文件（对话框选中的外部文件） */
export function grantExternalFile(absPath: string): void {
  grantPath(absPath, ['read'])
}

/** 注销授权（测试/撤销用） */
export function revokeGrantedPath(absPath: string): void {
  revokeGrant(absPath)
}

/**
 * 校验路径在指定意图下是否允许，返回解析后的绝对路径。
 * @throws 越界 → error.fsAccessDenied；命中拒绝名单/凭据文件 → error.fsAccessProtected
 */
function validateSandbox(filePath: string, intent: PathIntent = 'read'): string {
  return assertPathAllowed(filePath, intent, currentPathPolicy())
}

/**
 * 供**其它 controller** 复用的路径断言（同一套策略，避免各写一份白名单）。
 * 用于那些自己直接碰盘、不走 `fs:` 通道的通道 —— 评审点名的两个 blocker 属此类：
 * `project:delete-folder`（可递归删任意目录）与 `export:export-chapters`（可写任意路径）。
 */
export function assertPathAllowedForIpc(filePath: string, intent: PathIntent): string {
  return validateSandbox(filePath, intent)
}

// 全局文件操作锁（按文件绝对路径分配 Mutex 队列）
const fileMutexMap = new Map<string, Promise<void>>()

/** 互斥锁执行器：确保同一文件的读写完全串行排队 */
async function withFileMutex<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  // Normalize path across OS
  const normalPath = path.resolve(filePath)
  const previousTask = fileMutexMap.get(normalPath) || Promise.resolve()
  
  const currentTask = (async () => {
    try {
      await previousTask
    } catch { /* 前置任务错误不影响后续任务启动 */ }
    return task()
  })()

  // 缓存 stored promise 引用，供 finally 比较用
  const stored = currentTask.then(() => {}).catch(() => {})
  fileMutexMap.set(normalPath, stored)
  
  try {
    return await currentTask
  } finally {
    // 垃圾回收防御：如果当前任务是最后在等待的，则移除记录
    if (fileMutexMap.get(normalPath) === stored) {
      fileMutexMap.delete(normalPath)
    }
  }
}

export function registerFSController() {
  // 安全的异步读取
  guardedHandle('fs:read-file', async (_event, filePath: string, options?: unknown) => {
    try {
      const safePath = validateSandbox(filePath, 'read')
      return await withFileMutex(filePath, async () => {
        const spec = parseReadWindow(options)
        // 项目内读取也加大小上限（P3 修复）：50MB 文本全量跨 IPC 再被截断到 800 token，
        // 内存与 IPC 成本浪费且可能撞工具超时竞态。上限仅约束「无 offset/limit 的全量读」；
        // 窗口读（C1）不受上限约束但只返回窗口内内容（超大文件流式扫描）
        const stat = await fsPromises.stat(safePath)
        if (!spec.windowed) {
          if (stat.size > INTERNAL_MAX_BYTES) {
            return { success: false, content: '', error: t('error.fileTooLarge').replace('{limit}', String(Math.round(INTERNAL_MAX_BYTES / 1024 / 1024))) }
          }
          const content = await fsPromises.readFile(safePath, 'utf-8')
          return { success: true, content }
        }
        // 窗口读：≤ 上限快路径（精确 totalChars，行为与旧渲染层切片一致）；> 上限流式扫描
        if (stat.size <= INTERNAL_MAX_BYTES) {
          const full = await fsPromises.readFile(safePath, 'utf-8')
          const w = windowFromFullText(full, spec)
          return { success: true, content: w.content, totalChars: w.totalChars, beyond: w.beyond }
        }
        const w = await windowFromHugeFile(safePath, spec, stat.size)
        return { success: true, content: w.content, ...(w.totalChars !== undefined ? { totalChars: w.totalChars } : {}), ...(w.beyond ? { beyond: true } : {}) }
      })
    } catch (error) {
      return { success: false, content: '', error: safeErrorMessage(error) }
    }
  })

  // 项目外文件只读（Agent "添加外部文件"）：不走沙箱（用户显式选择，任意磁盘），
  // 扩展名白名单 + 1MB 大小限制 + 只读（无写通道）
  // ⚠️ 安全边界：仅放行「用户对话框显式选择过」的路径（fs:grant-external-file 登记）或项目目录内文件；
  //    BLOCKED_PATHS（.ssh/.aws/AppData/Windows 等）同样适用——此前 LLM 可传任意绝对路径无确认读取
  guardedHandle('fs:read-external-file', async (_event, filePath: string, options?: unknown) => {
    try {
      const resolved = path.resolve(filePath)

      // 1. 授权检查（L4 S8）：只放行**精确登记**过读授权的路径 —— 授权只能由主进程的
      //    对话框处理器签发（grantExternalFile）。改造前这里是渲染层可自行上报的
      //    `fs:grant-external-file`，等于自己给自己发通行证（该通道已删除）。
      //    刻意不用「在白名单内即可」：过渡期主目录根仍在白名单里，那样会形同虚设。
      if (!hasGrantFor(resolved, 'read')) {
        return {
          success: false,
          content: '',
          error: t('error.externalFileNotAuthorized').replace('{path}', filePath),
        }
      }

      // 2. BLOCKED_PATHS 敏感目录检查（与沙箱通道一致——此前外部通道完全绕过）
      const isBlocked = BLOCKED_PATHS.some(blocked => {
        const normalized = path.resolve(blocked)
        return resolved.startsWith(normalized + path.sep) || resolved === normalized
      })
      if (isBlocked) {
        return { success: false, content: '', error: t('error.fsAccessProtected').replace('{path}', filePath) }
      }

      const ext = path.extname(filePath).toLowerCase()
      if (!EXTERNAL_READABLE_EXTS.has(ext)) {
        return { success: false, content: '', error: `不支持的文件类型「${ext}」（仅支持文本文件）` }
      }
      const stat = await fsPromises.stat(filePath)
      if (!stat.isFile()) {
        return { success: false, content: '', error: '目标不是文件' }
      }
      const spec = parseReadWindow(options)
      if (!spec.windowed) {
        if (stat.size > EXTERNAL_MAX_BYTES) {
          return { success: false, content: '', error: `文件过大（超过 ${Math.round(EXTERNAL_MAX_BYTES / 1024)}KB），拒绝读取` }
        }
        const content = await fsPromises.readFile(filePath, 'utf-8')
        return { success: true, content }
      }
      // C1 窗口读：授权/扩展名/类型检查不变；1MB 上限仅约束全量读，窗口读流式切片
      if (stat.size <= EXTERNAL_MAX_BYTES) {
        const full = await fsPromises.readFile(filePath, 'utf-8')
        const w = windowFromFullText(full, spec)
        return { success: true, content: w.content, totalChars: w.totalChars, beyond: w.beyond }
      }
      const w = await windowFromHugeFile(filePath, spec, stat.size)
      return { success: true, content: w.content, ...(w.totalChars !== undefined ? { totalChars: w.totalChars } : {}), ...(w.beyond ? { beyond: true } : {}) }
    } catch (error) {
      return { success: false, content: '', error: safeErrorMessage(error) }
    }
  })

  // 二进制写入（PNG 截图导出——年度报告/分享卡；与 write-file 同安全模式）
  guardedHandle('fs:write-buffer', async (_event, filePath: string, content: Uint8Array) => {
    try {
      const safePath = validateSandbox(filePath, 'write')
      return await withFileMutex(filePath, async () => {
        await fsPromises.mkdir(path.dirname(safePath), { recursive: true })
        const tempPath = `${safePath}.${Date.now()}.tmp`
        await fsPromises.writeFile(tempPath, Buffer.from(content))
        await fsPromises.rename(tempPath, safePath)
        return { success: true }
      })
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // 跨平台绝对安全异步写入（防踩空）
  guardedHandle('fs:write-file', async (_event, filePath: string, content: string) => {
    try {
      const safePath = validateSandbox(filePath, 'write')
      return await withFileMutex(filePath, async () => {
        await fsPromises.mkdir(path.dirname(safePath), { recursive: true })
        // 先写到临时文件再原位替换，绝对防止 0KB 碎屑踩空现象
        const tempPath = `${safePath}.${Date.now()}.tmp`
        await fsPromises.writeFile(tempPath, content, 'utf-8')
        await fsPromises.rename(tempPath, safePath)
        return { success: true }
      })
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  guardedHandle('fs:list-dir', async (_event, dirPath: string): Promise<FileNode[]> => {
    try {
      return readDirRecursive(validateSandbox(dirPath, 'read'))
    } catch {
      return []
    }
  })

  guardedHandle('fs:mkdir', async (_event, dirPath: string) => {
    try {
      const safePath = validateSandbox(dirPath, 'write')
      fs.mkdirSync(safePath, { recursive: true })
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  guardedHandle('fs:check-exists', async (_event, filePath: string) => {
    try {
      return fs.existsSync(validateSandbox(filePath, 'read'))
    } catch {
      return false
    }
  })

  guardedHandle('fs:delete-file', async (_event, filePath: string) => {
    try {
      const safePath = validateSandbox(filePath, 'delete')
      await fsPromises.unlink(safePath)
      return { success: true }
    } catch (error) {
      // 文件不存在视为成功（幂等删除）
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { success: true }
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  guardedHandle('fs:read-json', async (_event, filePath: string) => {
    try {
      const safePath = validateSandbox(filePath, 'read')
      return await withFileMutex(filePath, async () => {
        const content = await fsPromises.readFile(safePath, 'utf-8')
        return { success: true, data: JSON.parse(content) }
      })
    } catch (error) {
      return { success: false, data: null, error: safeErrorMessage(error) }
    }
  })

  guardedHandle('fs:write-json', async (_event, filePath: string, data: unknown) => {
    try {
      const safePath = validateSandbox(filePath, 'write')
      return await withFileMutex(filePath, async () => {
        await fsPromises.mkdir(path.dirname(safePath), { recursive: true })
        const tempPath = `${safePath}.${Date.now()}.tmp`
        await fsPromises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8')
        await fsPromises.rename(tempPath, safePath)
        return { success: true }
      })
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // ===== Agent 会话归档（~/.novelforge/agent-archive/<id>.json，CCR 持久化层） =====
  // 渲染进程不持有 VELA_HOME 路径，归档目录由主进程统一定位（同模板/技能/日志惯例）
  const archivePath = (id: string): string => {
    const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '') // uuid 防御性清洗，防路径穿越
    return path.join(VELA_HOME, 'agent-archive', `${safe}.json`)
  }
  /** 被压缩对话的原文分卷（B 档第二轮）：与会话 JSON 同目录、不同后缀 */
  const archiveOriginalsPath = (id: string): string => {
    const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '')
    return path.join(VELA_HOME, 'agent-archive', `${safe}.originals.json`)
  }

  guardedHandle('fs:agent-archive-list', async (): Promise<{ id: string; title: string; updatedAt: number }[]> => {
    const dir = path.join(VELA_HOME, 'agent-archive')
    try {
      await fsPromises.mkdir(dir, { recursive: true })
      const entries = await fsPromises.readdir(dir, { withFileTypes: true })
      const out: { id: string; title: string; updatedAt: number }[] = []
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const id = entry.name.slice(0, -5)
        try {
          const raw = await fsPromises.readFile(path.join(dir, entry.name), 'utf-8')
          const data = JSON.parse(raw) as { title?: string; updatedAt?: number }
          out.push({ id, title: data.title ?? id, updatedAt: data.updatedAt ?? 0 })
        } catch {
          // 损坏归档跳过（列表仍可用，读取时再降级）
        }
      }
      return out.sort((a, b) => b.updatedAt - a.updatedAt)
    } catch {
      return []
    }
  })

  guardedHandle('fs:agent-archive-read', async (_e, id: string): Promise<string | null> => {
    try {
      return await fsPromises.readFile(archivePath(id), 'utf-8')
    } catch {
      return null
    }
  })

  guardedHandle('fs:agent-archive-write', async (_e, id: string, content: string): Promise<{ success: boolean }> => {
    try {
      const dir = path.join(VELA_HOME, 'agent-archive')
      await fsPromises.mkdir(dir, { recursive: true })
      const target = archivePath(id)
      const temp = `${target}.${Date.now()}.tmp`
      await fsPromises.writeFile(temp, content, 'utf-8')
      await fsPromises.rename(temp, target)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  guardedHandle('fs:agent-archive-delete', async (_e, id: string): Promise<{ success: boolean }> => {
    try {
      await fsPromises.unlink(archivePath(id))
      return { success: true }
    } catch (error) {
      // 文件不存在视为成功（幂等删除），与 fs:delete-file 惯例对齐
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { success: true }
      return { success: false }
    }
  })

  // 原文分卷（B 档第二轮）：写用临时文件 + rename（与 archive-write 同款原子写）
  guardedHandle('fs:agent-archive-original-read', async (_e, id: string): Promise<{ success: boolean; content?: string | null }> => {
    try {
      const content = await fsPromises.readFile(archiveOriginalsPath(id), 'utf-8')
      return { success: true, content }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { success: true, content: null }
      return { success: false }
    }
  })
  guardedHandle('fs:agent-archive-original-write', async (_e, id: string, content: string): Promise<{ success: boolean }> => {
    try {
      const dir = path.join(VELA_HOME, 'agent-archive')
      await fsPromises.mkdir(dir, { recursive: true })
      const target = archiveOriginalsPath(id)
      const temp = `${target}.${Date.now()}.tmp`
      await fsPromises.writeFile(temp, content, 'utf-8')
      await fsPromises.rename(temp, target)
      return { success: true }
    } catch {
      return { success: false }
    }
  })
  guardedHandle('fs:agent-archive-original-delete', async (_e, id: string): Promise<{ success: boolean }> => {
    try {
      await fsPromises.unlink(archiveOriginalsPath(id))
      return { success: true }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { success: true }
      return { success: false }
    }
  })

  // ===== Agent 长工具结果落盘（~/.novelforge/agent-results/<sha1-12>.txt，P0-1 写盘引用） =====
  // 同内容同哈希同文件（确定性命名 + wx 防重 = 决策冻结）；文件保留（rewind/fork/存档重放需引用仍在）
  guardedHandle('fs:agent-result-write', async (_e, content: unknown): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const text = typeof content === 'string' ? content : String(content ?? '')
      const dir = path.join(VELA_HOME, 'agent-results')
      await fsPromises.mkdir(dir, { recursive: true })
      const hash = createHash('sha1').update(text).digest('hex').slice(0, 12)
      const target = path.join(dir, `${hash}.txt`)
      try {
        await fsPromises.writeFile(target, text, { encoding: 'utf-8', flag: 'wx' })
      } catch (error) {
        // EEXIST = 同内容已落盘（同哈希）→ 幂等成功；其他错误上抛
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      // P0-1 再读授权（L4 S8 保留）：read_file 的绝对路径分支走 fs:read-external-file，
      //   而该通道只放行**精确登记过**的路径（见 hasGrantFor）。这里由**主进程自己**登记刚写的
      //   spill 文件（不是渲染层上报），否则 LLM 按注入文案「用 read_file 读取」必被拒。
      //   ⚠️ 删除这行会让 spill 链路整体失效——评审专门点名的「必须保留」项。
      grantExternalFile(path.resolve(target))
      return { success: true, path: target }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // ===== 工作流任务输出落盘（~/.novelforge/workflow-output/<runId>/<stepIndex>.txt，M2 CC §三.4） =====
  // 双轨补充通道：渲染层在既有 appendText 100ms 共享 flush 点把流式文本镜像到文件（fd 'w' 直写、
  // 显式字节偏移），内存 step.result 流式渲染不变；文件供崩溃恢复续读 + 尾部轮询。
  // 渲染进程不持有 VELA_HOME 路径，目录由主进程统一定位（同 agent-archive/agent-results 惯例）。
  guardedHandle('fs:workflow-output-append', async (_e, runId: string, stepIndex: number, text: string) => {
    return workflowOutputStore.append(runId, stepIndex, text)
  })

  guardedHandle('fs:workflow-output-tail', async (_e, runId: string, stepIndex: number, options?: WorkflowOutputTailOptions) => {
    // M-7：直接引用共享类型（ipc-channels 两端同源）；readTail 内部已对数值入参做防御清洗
    return workflowOutputStore.readTail(runId, stepIndex, options)
  })

  guardedHandle('fs:workflow-output-delete-run', async (_e, runId: string) => {
    const res = await workflowOutputStore.deleteRun(runId)
    // W-3：清理失败不能静默——任务级清理不变量破坏（残留目录将由 7 天 sweep 兜底），主进程日志留痕
    if (!res.success) {
      logger.warn('FS', t('log.fs.workflowOutputDeleteFailed').replace('{err}', () => res.error ?? t('log.fs.unknownError')))
    }
    return res
  })

  // 崩溃残留兜底清理：超龄（7 天）run 目录删除；保留窗口内文件供「任务中途崩溃下次可续读」
  void workflowOutputStore.sweep(WORKFLOW_OUTPUT_RETENTION_MS).catch(() => {})
}

function readDirRecursive(dirPath: string): FileNode[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  return entries
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name, DEFAULT_LOCALE)
    })
    .map((entry) => {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        return { name: entry.name, path: fullPath, isDir: true, children: readDirRecursive(fullPath) }
      }
      return { name: entry.name, path: fullPath, isDir: false }
    })
}
