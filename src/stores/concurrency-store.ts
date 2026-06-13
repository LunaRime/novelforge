/**
 * Vela 并发状态 Store — 前端并发状态监控
 *
 * 提供 API 并发状态的实时查询和配置接口。
 * 配合 electron/utils/concurrency-controller.ts 使用。
 */

import { create } from 'zustand'
import { ipc } from '../services/ipc-client'

export interface ConcurrencyStatus {
  activeCount: number
  queueLength: number
  maxConcurrent: number
  maxQueueSize: number
}

interface ConcurrencyState {
  /** 当前并发状态 */
  status: ConcurrencyStatus
  /** 是否正在轮询 */
  polling: boolean
  /** 轮询间隔 ID */
  _pollInterval: ReturnType<typeof setInterval> | null

  /** 刷新并发状态 */
  refreshStatus: () => Promise<void>
  /** 更新并发配置 */
  updateConfig: (config: { maxConcurrent?: number; maxQueueSize?: number }) => Promise<boolean>
  /** 开始轮询 */
  startPolling: (intervalMs?: number) => void
  /** 停止轮询 */
  stopPolling: () => void
}

export const useConcurrencyStore = create<ConcurrencyState>()((set, get) => ({
  status: {
    activeCount: 0,
    queueLength: 0,
    maxConcurrent: 3,
    maxQueueSize: 50,
  },
  polling: false,
  _pollInterval: null,

  refreshStatus: async () => {
    if (!ipc.isElectron) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = await (ipc.invoke as any)('llm:concurrency-status') as ConcurrencyStatus | null
      if (status) {
        set({ status })
      }
    } catch {
      // IPC 不可用时静默失败
    }
  },

  updateConfig: async (config) => {
    if (!ipc.isElectron) return false

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (ipc.invoke as any)('llm:concurrency-config', config) as { success: boolean }
      if (result.success) {
        set((s) => ({
          status: {
            ...s.status,
            ...config,
          },
        }))
      }
      return result.success
    } catch {
      return false
    }
  },

  startPolling: (intervalMs = 2000) => {
    const { _pollInterval } = get()
    if (_pollInterval) return // 已在轮询

    get().refreshStatus() // 立即获取一次

    const id = setInterval(() => {
      get().refreshStatus()
    }, intervalMs)

    set({ polling: true, _pollInterval: id })
  },

  stopPolling: () => {
    const { _pollInterval } = get()
    if (_pollInterval) {
      clearInterval(_pollInterval)
      set({ polling: false, _pollInterval: null })
    }
  },
}))
