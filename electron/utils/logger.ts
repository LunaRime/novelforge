/**
 * NovelForge 日志模块 — 主进程使用
 *
 * 双环境日志流（2026-08-05 升级）：
 * - Dev 环境（npm run dev + 内测版 alpha）：DEBUG 全量 → logs/dev/vela-dev-YYYY-MM-DD.log，终端全等级彩色输出
 * - Release 环境（公测版 beta + 正式版）：INFO 起（丢弃 DEBUG）→ logs/vela-YYYY-MM-DD.log，终端仅 ERROR（打包应用无控制台）
 *
 * 乱码处理策略：
 * - 文件一律 UTF-8 编码（Node fs 默认），读取端（log:read-file）统一 utf-8
 * - 终端 ANSI 颜色仅在 TTY 下启用——重定向/管道/CI 输出纯文本，杜绝 \x1b[ 转义垃圾进文件
 * - Windows 控制台代码页（GBK 936 默认）导致的中文乱码由 scripts/dev-utf8.cjs 在 dev 脚本中切换为 UTF-8
 *   （chcp 必须由持有控制台的进程执行——npm 脚本进程持有控制台，Electron 主进程被 Vite 管道化不持有，主进程内调用无效）
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { VELA_HOME, readJsonFile, GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG } from './config-utils'
import type { GlobalConfig } from '../../src/shared/ipc-channels'
import { t } from '../../src/shared/locale'

// ===== 常量 =====

/** 每环境默认最多保留日志文件数（数量约束；可在设置 → 开发者 → 日志保留中调整） */
const MAX_LOG_FILES = 5
/** 默认最多保留天数（时间窗约束；可在设置 → 开发者 → 日志保留中调整） */
const MAX_LOG_DAYS = 7

/** 读取日志保留配置（缺省回退默认值；容错旧 config.json 无该字段） */
function getRetentionConfig(): { files: number; days: number } {
  const cfg = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
  const r = cfg?.logRetention
  return {
    files: typeof r?.files === 'number' && r.files > 0 ? Math.min(r.files, 30) : MAX_LOG_FILES,
    days: typeof r?.days === 'number' && r.days > 0 ? Math.min(r.days, 365) : MAX_LOG_DAYS,
  }
}

/**
 * 计算应删除的日志文件（双约束：超时间窗 或 数量超限的最旧文件）。
 * 纯函数可单测；返回删除顺序（按 mtime 旧→新）。
 */
export function computeLogFilesToDelete(
  files: Array<{ name: string; mtime: number }>,
  keepFiles: number,
  keepDays: number,
): string[] {
  // 只参与合法日志文件（vela- 前缀 + .log 后缀）
  const valid = files.filter(f => f.name.startsWith('vela-') && f.name.endsWith('.log'))
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000
  const expireDays = valid.filter(f => f.mtime < cutoff)
  const keepByCount = [...valid].sort((a, b) => b.mtime - a.mtime).slice(keepFiles)
  const toDelete = new Map<string, number>() // name → mtime(双约束去重)
  for (const f of [...expireDays, ...keepByCount]) toDelete.set(f.name, f.mtime)
  return [...toDelete.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name)
}

// ===== 日志环境 =====

export enum LogEnvironment {
  /** 开发环境：npm run dev + 内测版（alpha）——DEBUG 全量，供开发定位问题 */
  Dev = 'dev',
  /** 发布环境：公测版（beta）+ 正式版——INFO 起，面向用户反馈 */
  Release = 'release',
}

/** 各环境的日志目录 */
export const LOG_DIRS: Record<LogEnvironment, string> = {
  [LogEnvironment.Dev]: path.join(VELA_HOME, 'logs', 'dev'),
  [LogEnvironment.Release]: path.join(VELA_HOME, 'logs'),
}

/**
 * 判定日志环境：
 * - dev 模式（VITE_DEV_SERVER_URL）→ Dev
 * - 内测版：编号式 prerelease（-alpha.N）或历史日期式（-YYYYMMDD，如 0.1.4-20260804）→ Dev
 * - 公测版（-beta.N）与正式版（0.x.y）→ Release
 */
export function detectLogEnvironment(devMode: boolean, version: string): LogEnvironment {
  if (devMode) return LogEnvironment.Dev
  if (/-alpha\.\d+/i.test(version) || /-\d{8}$/.test(version)) return LogEnvironment.Dev
  return LogEnvironment.Release
}

// ===== 日志等级 =====

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

/** 各环境的最低日志等级（低于此等级的日志被静默丢弃） */
const DEFAULT_MIN_LEVEL: Record<LogEnvironment, LogLevel> = {
    [LogEnvironment.Dev]: LogLevel.DEBUG,
    [LogEnvironment.Release]: LogLevel.INFO,
}

/** 当前日志环境（安全默认 Release：未初始化时走发布环境路径，避免 DEBUG 写错目录） */
let environment: LogEnvironment = LogEnvironment.Release
/** 当前生效的最低日志等级 */
let minLevel: LogLevel = DEFAULT_MIN_LEVEL[environment]

// ===== 终端颜色（ANSI） =====

const COLORS: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: '\x1b[36m', // 青色
    [LogLevel.INFO]: '\x1b[32m',  // 绿色
    [LogLevel.WARN]: '\x1b[33m',  // 黄色
    [LogLevel.ERROR]: '\x1b[31m', // 红色
}
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

const LEVEL_LABELS: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
}

/**
 * 终端是否启用 ANSI 颜色：
 * - 非 TTY（重定向/管道/CI）→ false，输出纯文本（防转义码污染文件/CI 日志）
 * - NO_COLOR / TERM=dumb 显式禁用 → false
 */
export function shouldUseColors(): boolean {
    if (process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb') return false
    return Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY)
}

// ===== 文件写入 =====

/** 当前日志文件的写入路径 */
let currentLogPath: string | null = null
/** 文件写入流 */
let logStream: fs.WriteStream | null = null

/** 获取指定环境今天的日志文件路径（Dev 环境带 -dev 前缀，与 Release 文件区分） */
export function getLogPathFor(env: LogEnvironment): string {
    const now = new Date()
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const prefix = env === LogEnvironment.Dev ? 'vela-dev-' : 'vela-'
    return path.join(LOG_DIRS[env], `${prefix}${date}.log`)
}

/** 获取今天（当前环境）的日志文件路径 */
export function getTodayLogPath(): string {
    return getLogPathFor(environment)
}

/** 确保日志目录和当日文件就绪 */
function ensureLogStream(): fs.WriteStream {
    const todayPath = getTodayLogPath()

    // 日期变更 → 切换文件
    if (todayPath !== currentLogPath) {
        if (logStream) {
            logStream.end()
            logStream = null
        }
        currentLogPath = todayPath

        // 确保目录存在
        if (!fs.existsSync(LOG_DIRS[environment])) {
            fs.mkdirSync(LOG_DIRS[environment], { recursive: true })
        }

        // 清理过期日志（双约束：数量 + 时间窗，配置来自设置页）
        cleanupOldLogs(getRetentionConfig().files, getRetentionConfig().days)

        logStream = fs.createWriteStream(todayPath, { flags: 'a' })
    }

    return logStream!
}

/** 删除超时间窗或数量超限的日志文件（双约束，两环境目录都清理） */
function cleanupOldLogs(keepFiles: number, keepDays: number): void {
    for (const dir of Object.values(LOG_DIRS)) {
        try {
            const files = fs.readdirSync(dir)
                .map((name): { name: string; mtime: number } | null => {
                    try { return { name, mtime: fs.statSync(path.join(dir, name)).mtimeMs } }
                    catch { return null }
                })
                .filter((f): f is { name: string; mtime: number } => f !== null)
            for (const name of computeLogFilesToDelete(files, keepFiles, keepDays)) {
                try { fs.unlinkSync(path.join(dir, name)) } catch { /* 忽略单个文件的错误 */ }
            }
        } catch { /* 目录可能不存在 */ }
    }
}

// ===== 核心写入 =====

/** 格式化一条日志消息（文件格式，UTF-8） */
export function formatMessage(level: LogLevel, source: string, message: string): string {
    const now = new Date()
    const timestamp = now.toISOString()
    const label = LEVEL_LABELS[level]
    return `[${timestamp}] [${label.padEnd(5)}] [${source}] ${message}`
}

/** 终端输出（仅当环境允许 + 等级达标；颜色仅在 TTY 下启用） */
function outputToTerminal(level: LogLevel, message: string): void {
    // Release 环境终端只出 ERROR（打包应用无控制台；从控制台启动正式版也不刷屏）
    if (environment === LogEnvironment.Release && level < LogLevel.ERROR) return

    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    const label = LEVEL_LABELS[level]

    const useColors = shouldUseColors()
    const prefix = useColors
        ? `${DIM}${time}${RESET} ${COLORS[level]}[${label}]${RESET}`
        : `${time} [${label}]`

    if (level >= LogLevel.ERROR) {
        console.error(`${prefix} ${message}`)
    } else if (level >= LogLevel.WARN) {
        console.warn(`${prefix} ${message}`)
    } else {
        console.log(`${prefix} ${message}`)
    }
}

/** 写入日志（内部函数） */
function write(level: LogLevel, source: string, message: string): void {
    if (level < minLevel) return

    outputToTerminal(level, message)

    // 文件写入（UTF-8，与读取端编码一致）
    try {
        const stream = ensureLogStream()
        stream.write(formatMessage(level, source, message) + '\n')
    } catch {
        // 文件写入失败时回退到 console
        console.warn('[Logger] 文件写入失败，仅输出到终端')
    }
}

// ===== 初始化 =====

/** 初始化日志系统：设定环境、最低等级并输出启动横幅（幂等，重复调用仅刷新横幅） */
export function initLogger(env: LogEnvironment, version: string): void {
    environment = env
    minLevel = DEFAULT_MIN_LEVEL[env]

    const envLabel = env === LogEnvironment.Dev ? t('log.envDev') : t('log.envRelease')
    logger.info('Logger', t('log.logger.envInfo')
      .replace('{env}', envLabel)
      .replace('{version}', version)
      .replace('{dir}', LOG_DIRS[env]))
    logger.info('Logger', t('log.logger.platformInfo')
      .replace('{os}', `${os.platform()} ${os.release()}`)
      .replace('{node}', process.version)
      .replace('{arch}', os.arch()))
    if (env === LogEnvironment.Dev) {
        logger.debug('Logger', t('log.logger.devDebugEnabled'))
    }
}

// ===== 公共 API =====

export const logger = {
    /** 动态设置日志等级 */
    setLevel(level: LogLevel): void {
        minLevel = level
    },

    debug(source: string, message: string): void {
        write(LogLevel.DEBUG, source, message)
    },

    info(source: string, message: string): void {
        write(LogLevel.INFO, source, message)
    },

    warn(source: string, message: string): void {
        write(LogLevel.WARN, source, message)
    },

    error(source: string, message: string | Error): void {
        const msg = message instanceof Error
            ? `${message.message}\n${message.stack ?? '(无堆栈)'}`
            : message
        write(LogLevel.ERROR, source, msg)
    },

    /** 获取今天的日志文件路径（当前环境） */
    getLogPath(): string {
        return getTodayLogPath()
    },

    /** 获取当前环境的日志目录 */
    getLogDir(): string {
        return LOG_DIRS[environment]
    },

    /** 获取当前日志环境 */
    getEnvironment(): LogEnvironment {
        return environment
    },

    /** 关闭日志流（应用退出时调用） */
    close(): void {
        if (logStream) {
            logStream.end()
            logStream = null
            currentLogPath = null
        }
    },
}

// ===== 全局异常处理 =====

/** 记录未捕获异常 */
function captureUncaughtException(error: Error): void {
    logger.error('Process', t('log.process.uncaughtException').replace('{err}', error.message))
    logger.error('Process', error)
}

/** 记录未处理的 Promise 拒绝 */
function captureUnhandledRejection(reason: unknown): void {
    const msg = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason)
    logger.error('Process', t('log.process.unhandledRejection').replace('{err}', msg))
}

/**
 * 安装全局异常处理器（在 app.whenReady() 之前调用）
 * @param env 日志环境（dev/内测 → Dev；公测/正式 → Release）
 * @param version 应用版本（启动横幅用，app.getVersion()）
 */
export function installGlobalErrorHandlers(env?: LogEnvironment, version?: string): void {
    if (env !== undefined) {
        initLogger(env, version ?? 'unknown')
    }

    process.on('uncaughtException', captureUncaughtException)
    process.on('unhandledRejection', captureUnhandledRejection)

    logger.info('Logger', t('log.logger.initialized').replace('{dir}', LOG_DIRS[environment]))
}

/** 卸载全局异常处理器（应用退出时调用） */
export function uninstallGlobalErrorHandlers(): void {
    process.off('uncaughtException', captureUncaughtException)
    process.off('unhandledRejection', captureUnhandledRejection)
    logger.close()
}
