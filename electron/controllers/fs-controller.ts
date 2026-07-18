import { ipcMain } from 'electron'
import { DEFAULT_LOCALE } from '../../src/shared/locale'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FileNode } from '../../src/shared/ipc-channels'
import { VELA_HOME } from '../utils/config-utils'
import { safeErrorMessage } from '../utils/error-utils'

/** 路径沙箱：允许访问的根目录列表 */
const SANDBOX_ROOTS = [VELA_HOME, os.homedir()]

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
    throw new Error(`[fs-sandbox] 拒绝访问: 路径 "${filePath}" 不在允许的目录范围内`)
  }
  // 检查是否在禁止列表中
  const isBlocked = BLOCKED_PATHS.some(blocked => {
    const normalized = path.resolve(blocked)
    return resolved.startsWith(normalized + path.sep) || resolved === normalized
  })
  if (isBlocked) {
    throw new Error(`[fs-sandbox] 拒绝访问: 路径 "${filePath}" 指向受保护的目录`)
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
        const content = await fsPromises.readFile(safePath, 'utf-8')
        return { success: true, content }
      })
    } catch (error) {
      return { success: false, content: '', error: safeErrorMessage(error) }
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
