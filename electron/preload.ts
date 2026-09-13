import { ipcRenderer, contextBridge, webFrame } from 'electron'
import { t } from '../src/shared/locale'
import { IPC_CHANNEL_POLICY, IPC_EVENT_CHANNELS } from '../src/shared/ipc-policy'

/**
 * NovelForge Preload Script — 安全地暴露 IPC 通信能力到渲染进程
 *
 * 通过 contextBridge 暴露类型安全的 API，避免直接暴露 ipcRenderer
 * 所有 IPC 通道必须在此白名单中，防止 XSS 注入调用任意主进程功能
 *
 * L4 S7：白名单**由真源派生**，不再手工维护——
 *   - invoke 前缀 ← `IPC_CHANNEL_POLICY`（主进程策略表的同一个对象）
 *   - event 前缀  ← `IPC_EVENT_CHANNELS`
 * 这样「加了通道忘了加白名单」在结构上不可能发生（此前手工元组就漂移过一次：
 * `import:progress` 长期不在白名单，渲染层订阅直接抛错）。
 *
 * ⚠️ 本文件被打进 sandbox preload（`vite.config.ts` 的 preload 块**没有** external），
 * 所以 `src/shared/ipc-policy.ts` 必须是零运行时依赖的纯数据 —— 它只 `import type`，
 * 类型会被完全擦除。
 */
function prefixesOf(channels: readonly string[]): readonly string[] {
  return [...new Set(channels.map(c => c.slice(0, c.indexOf(':') + 1)))]
}

const ALLOWED_INVOKE_CHANNELS: readonly string[] = prefixesOf(Object.keys(IPC_CHANNEL_POLICY))
const ALLOWED_EVENT_CHANNELS: readonly string[] = prefixesOf(IPC_EVENT_CHANNELS)

/** 运行时白名单校验 + 编译时类型约束 */
function checkChannel(channel: string, allowed: readonly string[]): void {
  if (!allowed.some(p => channel.startsWith(p))) {
    throw new Error(t('error.ipcChannelNotAllowed').replace('{channel}', channel))
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
