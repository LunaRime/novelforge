import { BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { readJsonFile, writeJsonFile, GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG, VELA_HOME } from '../utils/config-utils'
import { logger, LogLevel, LogEnvironment, LOG_DIRS, getLogPathFor } from '../utils/logger'
import { safeErrorMessage } from '../utils/error-utils'
import { t, setCurrentLocale, type SupportedLocale } from '../../src/shared/locale'
import { GlobalConfig, type LogEnvMode, type LogFileInfo } from '../../src/shared/ipc-channels'

/** 渲染进程日志等级字符串 → 主进程 LogLevel 映射 */
const RENDER_LOG_LEVELS: Record<'debug' | 'info' | 'warn' | 'error', LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
}

/** IPC 环境参数 → 主进程日志环境（缺省用当前环境） */
function envFromMode(mode: LogEnvMode | undefined): LogEnvironment {
  return mode === 'dev' ? LogEnvironment.Dev : LogEnvironment.Release
}

/** 读取日志目录下的 vela-*.log 文件列表（新→旧） */
function listLogFilesIn(dir: string, env: LogEnvMode): LogFileInfo[] {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.startsWith('vela-') && f.endsWith('.log'))
      .map(name => {
        try {
          const stat = fs.statSync(path.join(dir, name))
          return { env, name, size: stat.size, mtime: stat.mtimeMs }
        } catch {
          return { env, name, size: 0, mtime: 0 }
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

export function registerConfigController() {
  /** 读取全局配置 */
  ipcMain.handle('config:get', async () => {
    return readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
  })

  /** 保存全局配置 */
  ipcMain.handle('config:set', async (_event, config: Partial<GlobalConfig>) => {
    try {
      const existing = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      const updated = { ...existing, ...config }
      writeJsonFile(GLOBAL_CONFIG_PATH, updated)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  /** 获取 ~/.novelforge 路径 */
  ipcMain.handle('config:get-vela-home', async () => {
    return VELA_HOME
  })

  /** 同步 UI 语言到主进程（主进程对话框/菜单/窗口标题用 t() 读取当前 locale） */
  ipcMain.handle('config:set-locale', async (_event, locale: SupportedLocale) => {
    setCurrentLocale(locale)
    // 同步更新窗口标题（渲染层 document.title 是主覆盖源，此处兜底原生标题栏/焦点窗口场景）
    for (const w of BrowserWindow.getAllWindows()) w.setTitle(t('window.title'))
    return { success: true }
  })

  // ===== 日志管理（双环境：dev=开发/内测，release=公测/正式） =====

  /** 获取指定环境今天的日志文件内容（默认当前环境） */
  ipcMain.handle('log:get-today', async (_event, env?: LogEnvMode, maxLines?: number) => {
    try {
      const logPath = getLogPathFor(envFromMode(env))
      if (!fs.existsSync(logPath)) return ''
      // 文件一律 UTF-8 编码（logger 写入端保证），读取端统一 utf-8
      const content = fs.readFileSync(logPath, 'utf-8')
      if (!maxLines) return content
      const lines = content.split('\n')
      return lines.slice(-maxLines).join('\n')
    } catch (error) {
      return `读取日志失败: ${error}`
    }
  })

  /** 获取两个环境的日志文件列表（新→旧，带环境标记/大小/时间） */
  ipcMain.handle('log:list-files', async () => {
    return [
      { env: 'release' as const, files: listLogFilesIn(LOG_DIRS[LogEnvironment.Release], 'release') },
      { env: 'dev' as const, files: listLogFilesIn(LOG_DIRS[LogEnvironment.Dev], 'dev') },
    ]
  })

  /** 读取指定环境的日志文件（maxLines 截断为尾部 N 行，防大文件卡 UI） */
  ipcMain.handle('log:read-file', async (_event, env: LogEnvMode, fileName: string, maxLines?: number) => {
    try {
      // 安全检查：文件名必须合法（basename 防路径遍历）+ 前缀/后缀校验
      const safeName = path.basename(fileName)
      if (!safeName.startsWith('vela-') || !safeName.endsWith('.log')) {
        return { success: false, error: t('error.invalidLogFileName') }
      }
      const filePath = path.join(LOG_DIRS[envFromMode(env)], safeName)
      if (!fs.existsSync(filePath)) {
        return { success: false, error: t('error.logFileNotFound') }
      }
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
      const shown = maxLines && lines.length > maxLines ? lines.slice(-maxLines) : lines
      return { success: true, content: shown.join('\n'), totalLines: lines.length }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  /** 在系统文件管理器中打开日志目录（用户反馈问题时可快速定位日志文件） */
  ipcMain.handle('log:open-dir', async () => {
    try {
      const dir = logger.getLogDir()
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const err = await shell.openPath(dir)
      if (err) return { success: false, error: err }
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  /** 记录前端日志（渲染进程通过 IPC 写入；level 为字符串，主进程映射到 LogLevel） */
  ipcMain.handle('log:write', async (_event, level: 'debug' | 'info' | 'warn' | 'error', source: string, message: string) => {
    const logLevel = RENDER_LOG_LEVELS[level] ?? LogLevel.INFO
    switch (logLevel) {
      case LogLevel.DEBUG: logger.debug(source, message); break
      case LogLevel.INFO: logger.info(source, message); break
      case LogLevel.WARN: logger.warn(source, message); break
      case LogLevel.ERROR: logger.error(source, message); break
    }
    return { success: true }
  })
}
