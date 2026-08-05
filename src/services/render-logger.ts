/**
 * 渲染进程日志落盘 — 与主进程文件日志打通
 *
 * 设计（2026-08-05）：
 * - 工作流日志（workflow-store addLog）与全局渲染错误（error / unhandledrejection）
 *   通过 log:write 写入主进程日志文件——用户反馈问题时文件日志完整可查（此前仅内存 500 条）
 * - fire-and-forget：不阻塞渲染主线程，失败静默（IPC 不可用 / 早期启动 / 浏览器模式）
 * - 调用方自行控制频率：LLM 流式 chunk 等高频路径不走这里（写文件会爆炸）
 */
import { ipc } from './ipc-client'
import type { LogEnvMode } from '../shared/ipc-channels'

export type RenderLogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 判定日志环境（与主进程 detectLogEnvironment 逻辑一致；dev 模式 / 内测版 → dev，公测/正式 → release） */
export function detectLogEnvMode(devMode: boolean, version: string): LogEnvMode {
  if (devMode) return 'dev'
  // 内测版：编号式 prerelease（-alpha.N）或历史日期式（-YYYYMMDD，如 0.1.4-20260804）
  if (/-alpha\.\d+/i.test(version) || /-\d{8}$/.test(version)) return 'dev'
  return 'release'
}

/** 判定当前应用的日志环境（Vite define 注入 __APP_VERSION__） */
export function getCurrentLogEnv(): LogEnvMode {
  return detectLogEnvMode(import.meta.env.DEV, __APP_VERSION__)
}

/** 写入主进程日志文件（异步落盘，不等待结果） */
export function renderLog(level: RenderLogLevel, source: string, message: string): void {
  try {
    ipc.invoke('log:write', level, source, message).catch(() => { /* 主进程侧失败静默 */ })
  } catch {
    // 测试/浏览器模式（velaAPI 未注入）时静默
  }
}

/** 渲染进程全局错误捕获 → ERROR 落盘（在应用入口调用一次） */
export function installRendererErrorCapture(): void {
  window.addEventListener('error', (event) => {
    const err = event.error
    const detail = err instanceof Error
      ? `${err.message}${err.stack ? `\n${err.stack}` : ''}`
      : `${event.message}${event.filename ? ` @ ${event.filename}:${event.lineno}:${event.colno}` : ''}`
    renderLog('error', 'Renderer', `全局错误: ${detail}`)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const detail = reason instanceof Error
      ? `${reason.message}${reason.stack ? `\n${reason.stack}` : ''}`
      : String(reason)
    renderLog('error', 'Renderer', `未处理 Promise 拒绝: ${detail}`)
  })
}
