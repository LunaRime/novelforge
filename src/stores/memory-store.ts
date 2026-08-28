/**
 * memory-store — 作品记忆列表状态（侧栏 AI 记忆组）
 *
 * 数据源：memory:list（.novelforge/memory/*.md 三级摘要文件：章节/分卷/全书）。
 * MemoryGroup 消费：文件列表 + 加载态；手动重建后 refresh() 刷新 stale 徽标。
 */
import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import type { MemoryFileMeta } from '../services/memory/memory-codec'

interface MemoryState {
  files: MemoryFileMeta[]
  loading: boolean
  load: () => Promise<void>
  refresh: () => Promise<void>
}

let memoryLoadSeq = 0 // loadSeq 防竞态（项目惯例）

export const useMemoryStore = create<MemoryState>()((set) => ({
  files: [],
  loading: false,
  load: async () => {
    const mySeq = ++memoryLoadSeq
    set({ loading: true })
    try {
      const files = (await ipc.invoke('memory:list')) as MemoryFileMeta[]
      if (mySeq !== memoryLoadSeq) return
      set({ files, loading: false })
    } catch {
      if (mySeq === memoryLoadSeq) set({ loading: false })
    }
  },
  refresh: async () => {
    await useMemoryStore.getState().load()
  },
}))
