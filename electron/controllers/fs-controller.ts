import { ipcMain } from 'electron'
import { DEFAULT_LOCALE, t } from '../../src/shared/locale'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FileNode } from '../../src/shared/ipc-channels'
import { VELA_HOME } from '../utils/config-utils'
import { safeErrorMessage } from '../utils/error-utils'

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

/** 用户显式授权过的外部文件路径（dialog:select-files 选择成功后由渲染层登记，会话级） */
const grantedExternalFiles = new Set<string>()

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
 * 验证文件路径是否在允许的沙箱范围内
 * @throws 如果路径逃逸沙箱则抛出错误
 */
function validateSandbox(filePath: string): string {
  const resolved = path.resolve(filePath)
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
  ipcMain.handle('fs:read-file', async (_event, filePath: string) => {
    try {
      const safePath = validateSandbox(filePath)
      return await withFileMutex(filePath, async () => {
        // 项目内读取也加大小上限（P3 修复）：50MB 文本全量跨 IPC 再被截断到 800 token，
        // 内存与 IPC 成本浪费且可能撞工具超时竞态
        const stat = await fsPromises.stat(safePath)
        if (stat.size > INTERNAL_MAX_BYTES) {
          return { success: false, content: '', error: t('error.fileTooLarge').replace('{limit}', String(Math.round(INTERNAL_MAX_BYTES / 1024 / 1024))) }
        }
        const content = await fsPromises.readFile(safePath, 'utf-8')
        return { success: true, content }
      })
    } catch (error) {
      return { success: false, content: '', error: safeErrorMessage(error) }
    }
  })

  // 项目外文件只读（Agent "添加外部文件"）：不走沙箱（用户显式选择，任意磁盘），
  // 扩展名白名单 + 1MB 大小限制 + 只读（无写通道）
  // ⚠️ 安全边界：仅放行「用户对话框显式选择过」的路径（fs:grant-external-file 登记）或项目目录内文件；
  //    BLOCKED_PATHS（.ssh/.aws/AppData/Windows 等）同样适用——此前 LLM 可传任意绝对路径无确认读取
  ipcMain.handle('fs:read-external-file', async (_event, filePath: string) => {
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
      if (stat.size > EXTERNAL_MAX_BYTES) {
        return { success: false, content: '', error: `文件过大（超过 ${Math.round(EXTERNAL_MAX_BYTES / 1024)}KB），拒绝读取` }
      }
      const content = await fsPromises.readFile(filePath, 'utf-8')
      return { success: true, content }
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
