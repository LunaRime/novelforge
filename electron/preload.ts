import { ipcRenderer, contextBridge, webFrame } from 'electron'

/**
 * Vela Preload Script — 安全地暴露 IPC 通信能力到渲染进程
 *
 * 通过 contextBridge 暴露类型安全的 API，避免直接暴露 ipcRenderer
 * 所有 IPC 通道必须在此白名单中，防止 XSS 注入调用任意主进程功能
 */
/** IPC 通道白名单 — 使用 as const 派生字面量联合类型，新增前缀时类型自动扩展 */
const ALLOWED_INVOKE_CHANNELS = [
  'config:',
  'db:',
  'fs:',
  'project:',
  'kb:',
  'llm:',
  'embedding:',
  'mcp:',
  'log:',
  'dialog:',
  'update:',
  'import:',
  'uninstall:',
  'health:',
] as const

/** 合法的 invoke 通道前缀字面量类型（由白名单自动派生） */
export type AllowedInvokePrefix = (typeof ALLOWED_INVOKE_CHANNELS)[number]

const ALLOWED_EVENT_CHANNELS = [
  'llm:',
  'update:',
] as const

/** 合法的 event 通道前缀字面量类型 */
export type AllowedEventPrefix = (typeof ALLOWED_EVENT_CHANNELS)[number]

/** 运行时白名单校验 + 编译时类型约束 */
function checkChannel(channel: string, allowed: readonly string[]): void {
  if (!allowed.some(p => channel.startsWith(p))) {
    throw new Error(`[preload] 不允许的 IPC 通道: ${channel}`)
  }
}

contextBridge.exposeInMainWorld('velaAPI', {
  // ===== 双向请求/响应（invoke/handle） =====
  /** 调用主进程并等待结果 */
  invoke: (channel: string, ...args: unknown[]) => {
    checkChannel(channel, ALLOWED_INVOKE_CHANNELS)
    return ipcRenderer.invoke(channel, ...args)
  },

  // ===== 主进程 → 渲染进程事件 =====
  /** 监听主进程推送的事件 */
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    checkChannel(channel, ALLOWED_EVENT_CHANNELS)
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, listener)
    // 返回取消订阅函数
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },

  /** 一次性监听 */
  once: (channel: string, callback: (...args: unknown[]) => void) => {
    checkChannel(channel, ALLOWED_EVENT_CHANNELS)
    ipcRenderer.once(channel, (_event, ...args) => callback(...args))
  },

  // ===== 渲染进程 → 主进程单向发送 =====
  /** 单向发送消息（无返回值） */
  send: (channel: string, ...args: unknown[]) => {
    checkChannel(channel, ALLOWED_EVENT_CHANNELS)
    ipcRenderer.send(channel, ...args)
  },

  // ===== UI 控制 =====
  /** 设置窗口缩放级别 (Electron WebFrame) */
  setZoomLevel: (level: number) => {
    webFrame.setZoomLevel(level)
  },
  /** 设置绝对缩放比例 */
  setZoomFactor: (factor: number) => {
    webFrame.setZoomFactor(factor)
  },
  /** 等级获取 */
  getZoomLevel: () => {
    return webFrame.getZoomLevel()
  }
})
