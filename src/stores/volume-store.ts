/**
 * volume-store — 分卷管理（长篇小说按卷组织章节）
 *
 * 数据源：volumes 表（卷号唯一、起止章节含边界）。
 * 工作台分卷块消费：卷列表 + 章节→卷归属查询。
 */
import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import type { VolumeData } from '../../electron/repositories/volume-repository'

interface VolumeState {
  volumes: VolumeData[]
  loaded: boolean

  load: () => Promise<void>
  reset: () => void
  /** 插入/更新分卷（卷号冲突时按卷号覆盖） */
  upsert: (data: VolumeData) => Promise<boolean>
  /** 删除分卷 */
  remove: (volumeNumber: number) => Promise<boolean>
  /** 章节 → 所属分卷（含边界；无匹配返回 null） */
  getVolumeForChapter: (chapterNumber: number) => VolumeData | null
}

// 加载请求序号：快速切换项目时，旧项目的慢响应不得覆盖当前项目数据
let loadSeq = 0

export const useVolumeStore = create<VolumeState>()((set, get) => ({
  volumes: [],
  loaded: false,

  load: async () => {
    const seq = ++loadSeq
    try {
      const volumes = (await ipc.invoke('db:volume-get-all')) ?? []
      if (seq !== loadSeq) return // 已被更新的加载请求取代（项目已切换）
      set({ volumes, loaded: true })
    } catch {
      if (seq !== loadSeq) return
      set({ volumes: [], loaded: true })
    }
  },

  reset: () => {
    set({ volumes: [], loaded: false })
  },

  upsert: async (data) => {
    const res = await ipc.invoke('db:volume-upsert', data)
    if (res.success) await get().load()
    return res.success === true
  },

  remove: async (volumeNumber) => {
    const res = await ipc.invoke('db:volume-delete', volumeNumber)
    if (res.success) await get().load()
    return res.success === true
  },

  getVolumeForChapter: (chapterNumber) => {
    const { volumes } = get()
    return volumes.find(v =>
      v.chapterStart <= chapterNumber &&
      (v.chapterEnd === 0 || chapterNumber <= v.chapterEnd),
    ) ?? null
  },
}))
