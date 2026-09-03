import { ipcMain } from 'electron'
import { DEFAULT_LOCALE, t } from '../../src/shared/locale'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { FileNode, WorkflowOutputTailOptions } from '../../src/shared/ipc-channels'
import { VELA_HOME } from '../utils/config-utils'
import { safeErrorMessage } from '../utils/error-utils'
import { scanTextWindow } from '../utils/read-text-window'
import { logger } from '../utils/logger'
import { WorkflowOutputFileStore } from '../utils/workflow-output-store'

/** 路径沙箱：允许访问的根目录列表 */
const SANDBOX_ROOTS = [VELA_HOME, os.homedir()]

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

/** 用户显式授权过的外部文件路径（dialog:select-files 选择成功后由渲染层登记，会话级） */
const grantedExternalFiles = new Set<string>()

/**
 * 工作流任务输出文件仓库（M2，CC §三.4 双轨补充通道）：
 * `{VELA_HOME}/workflow-output/<runId>/<stepIndex>.txt`——纯 fs 单测见 utils 测试。
 * 崩溃残留兜底清理窗口：7 天（超龄 run 目录启动时 sweep；保留窗口内文件供恢复续读）
 */
const WORKFLOW_OUTPUT_DIR = path.join(VELA_HOME, 'workflow-output')
const WORKFLOW_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const workflowOutputStore = new WorkflowOutputFileStore(WORKFLOW_OUTPUT_DIR)

/** 禁止访问的敏感目录（即使在 SANDBOX_ROOTS 内） */
const BLOCKED_PATHS = [
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.aws'),
  path.join(os.homedir(), '.docker'),
  path.join(os.homedir(), 'AppData', 'Roaming'),
  path.join(os.homedir(), 'AppData', 'Local'),
  process.env.WINDIR || 'C:\\Windows',
  process.env.SYSTEMROOT || 'C:\\Windows',
  '/etc', '/sys', '/proc', '/dev',
]

/**
 * 用户通过系统对话框显式选择的目录（会话级授权）。
 * 导出/分享卡保存到任意用户目录：dialog:select-folder / dialog:save-file /
 * export:select-output-dir 返回路径时登记，fs 写通道对已登记目录放行。
 */
const grantedDirs = new Set<string>()

/** 登记用户通过系统对话框确认的目录（外部授权链路——与 fs:grant-external-file 同模式） */
export function grantDirectory(dirPath: string): void {
  if (!dirPath) return
  grantedDirs.add(path.resolve(dirPath))
}

/** 路径是否位于已登记的授权目录内 */
function isGranted(filePath: string): boolean {
  const abs = path.resolve(filePath)
  return [...grantedDirs].some(dir => abs === dir || abs.startsWith(dir + path.sep))
}

/**
 * 验证文件路径是否在允许的沙箱范围内
 * @throws 如果路径逃逸沙箱则抛出错误
 */
function validateSandbox(filePath: string): string {
  const resolved = path.resolve(filePath)
  // 用户显式授权的目录优先放行（会话级，进程重启后失效）
  if (isGranted(filePath)) return resolved
  // 检查是否在允许的根目录内
  const isAllowed = SANDBOX_ROOTS.some(root => {
    const normalized = path.resolve(root)
    return resolved.startsWith(normalized + path.sep) || resolved === normalized
  })
  if (!isAllowed) {
    throw new Error(t('error.fsAccessDenied').replace('{path}', filePath))
  }
  // 检查是否在禁止列表中
  const isBlocked = BLOCKED_PATHS.some(blocked => {
    const normalized = path.resolve(blocked)
    return resolved.startsWith(normalized + path.sep) || resolved === normalized
  })
  if (isBlocked) {
    throw new Error(t('error.fsAccessProtected').replace('{path}', filePath))
  }
  return resolved
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
  ipcMain.handle('fs:read-file', async (_event, filePath: string, options?: unknown) => {
    try {
      const safePath = validateSandbox(filePath)
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
  ipcMain.handle('fs:read-external-file', async (_event, filePath: string, options?: unknown) => {
    try {
      const resolved = path.resolve(filePath)

      // 1. 授权检查：仅放行用户显式选择过的路径（fs:grant-external-file 登记，
      //    渲染层在 dialog:select-files 成功与内部白名单读取前调用）
      if (!grantedExternalFiles.has(resolved)) {
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

  // 用户显式选择外部文件后登记授权（dialog:select-files 成功路径由渲染层调用）
  ipcMain.handle('fs:grant-external-file', async (_event, filePath: string) => {
    try {
      if (typeof filePath === 'string' && filePath.trim()) {
        grantedExternalFiles.add(path.resolve(filePath))
      }
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  // 二进制写入（PNG 截图导出——年度报告/分享卡；与 write-file 同安全模式）
  ipcMain.handle('fs:write-buffer', async (_event, filePath: string, content: Uint8Array) => {
    try {
      const safePath = validateSandbox(filePath)
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
  ipcMain.handle('fs:write-file', async (_event, filePath: string, content: string) => {
    try {
      const safePath = validateSandbox(filePath)
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

  ipcMain.handle('fs:list-dir', async (_event, dirPath: string): Promise<FileNode[]> => {
    try {
      return readDirRecursive(validateSandbox(dirPath))
    } catch {
      return []
    }
  })

  ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
    try {
      const safePath = validateSandbox(dirPath)
      fs.mkdirSync(safePath, { recursive: true })
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  ipcMain.handle('fs:check-exists', async (_event, filePath: string) => {
    try {
      return fs.existsSync(validateSandbox(filePath))
    } catch {
      return false
    }
  })

  ipcMain.handle('fs:delete-file', async (_event, filePath: string) => {
    try {
      const safePath = validateSandbox(filePath)
      await fsPromises.unlink(safePath)
      return { success: true }
    } catch (error) {
      // 文件不存在视为成功（幂等删除）
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { success: true }
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  ipcMain.handle('fs:read-json', async (_event, filePath: string) => {
    try {
      const safePath = validateSandbox(filePath)
      return await withFileMutex(filePath, async () => {
        const content = await fsPromises.readFile(safePath, 'utf-8')
        return { success: true, data: JSON.parse(content) }
      })
    } catch (error) {
      return { success: false, data: null, error: safeErrorMessage(error) }
    }
  })

  ipcMain.handle('fs:write-json', async (_event, filePath: string, data: unknown) => {
    try {
      const safePath = validateSandbox(filePath)
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

  ipcMain.handle('fs:agent-archive-list', async (): Promise<{ id: string; title: string; updatedAt: number }[]> => {
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

  ipcMain.handle('fs:agent-archive-read', async (_e, id: string): Promise<string | null> => {
    try {
      return await fsPromises.readFile(archivePath(id), 'utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle('fs:agent-archive-write', async (_e, id: string, content: string): Promise<{ success: boolean }> => {
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

  ipcMain.handle('fs:agent-archive-delete', async (_e, id: string): Promise<{ success: boolean }> => {
    try {
      await fsPromises.unlink(archivePath(id))
      return { success: true }
    } catch (error) {
      // 文件不存在视为成功（幂等删除），与 fs:delete-file 惯例对齐
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { success: true }
      return { success: false }
    }
  })

  // ===== Agent 长工具结果落盘（~/.novelforge/agent-results/<sha1-12>.txt，P0-1 写盘引用） =====
  // 同内容同哈希同文件（确定性命名 + wx 防重 = 决策冻结）；文件保留（rewind/fork/存档重放需引用仍在）
  ipcMain.handle('fs:agent-result-write', async (_e, content: unknown): Promise<{ success: boolean; path?: string; error?: string }> => {
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
      // P0-1 再读授权：read_file 绝对路径分支走 fs:read-external-file（:147 检查 grantedExternalFiles），
      // 落盘文件必须登记，否则 LLM 按注入文案「用 read_file 读取」必被拒——登记后 .txt 在扩展名
      // 白名单内、不在 BLOCKED_PATHS，其余防线仍生效（grantedExternalFiles 会话级，进程重启失效）
      grantedExternalFiles.add(path.resolve(target))
      return { success: true, path: target }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // ===== 工作流任务输出落盘（~/.novelforge/workflow-output/<runId>/<stepIndex>.txt，M2 CC §三.4） =====
  // 双轨补充通道：渲染层在既有 appendText 100ms 共享 flush 点把流式文本镜像到文件（fd 'w' 直写、
  // 显式字节偏移），内存 step.result 流式渲染不变；文件供崩溃恢复续读 + 尾部轮询。
  // 渲染进程不持有 VELA_HOME 路径，目录由主进程统一定位（同 agent-archive/agent-results 惯例）。
  ipcMain.handle('fs:workflow-output-append', async (_e, runId: string, stepIndex: number, text: string) => {
    return workflowOutputStore.append(runId, stepIndex, text)
  })

  ipcMain.handle('fs:workflow-output-tail', async (_e, runId: string, stepIndex: number, options?: WorkflowOutputTailOptions) => {
    // M-7：直接引用共享类型（ipc-channels 两端同源）；readTail 内部已对数值入参做防御清洗
    return workflowOutputStore.readTail(runId, stepIndex, options)
  })

  ipcMain.handle('fs:workflow-output-delete-run', async (_e, runId: string) => {
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
