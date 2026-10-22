import { create } from 'zustand'
import { ipc } from '../services/ipc-client'

/**
 * 开发者控制台可用性（渲染层门禁）。
 * 后端 `dev:console-status` 是唯一判定源；这里只缓存结果，供入口显隐使用。
 */
interface DevConsoleState {
  /** null = 尚未查询 */
  enabled: boolean | null
  refresh: () => Promise<void>
  setEnabled: (enabled: boolean) => void
}

export const useDevConsoleStore = create<DevConsoleState>()((set) => ({
  enabled: null,
  refresh: async () => {
    try {
      const status = await ipc.invoke('dev:console-status')
      set({ enabled: status.enabled })
    } catch {
      set({ enabled: false })
    }
  },
  setEnabled: (enabled) => set({ enabled }),
}))