/**
 * volume-store — 分卷管理（长篇小说按卷组织章节）
 *
 * 数据源：volumes 表（卷号唯一、起止章节含边界）。
 * 工作台分卷块消费：卷列表 + 章节→卷归属查询。
 */
import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import { renderLog } from '../services/render-logger'
import { collectAffectedFiles, invalidateMemoryFiles } from '../services/memory/memory-invalidation'
import type { VolumeData } from '../../electron/repositories/volume-repository'

interface VolumeState {
  volumes: VolumeData[]
  loaded: boolean

  /** 加载分卷；返回是否生效（loadSeq 竞态守卫：被更新请求取代/读取失败 → false，调用方应跳过失效） */
  load: () => Promise<boolean>
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

/**
 * 卷成员变更后：diff 式标记受影响区间记忆文件 stale（CCR P1 Task 3，reviewer F1 修正）。
 * 受影响章节区间 = 变更卷旧范围 ∪ 新范围（进行中卷 chapterEnd=0 取 start..start+30 保守上限，
 * 覆盖其滚动窗口）；区间内每章在变更前后卷列表下的记忆文件收集去重——
 * 防单侧边界编辑（如卷 1 结束 15→12 时 13-15 章落在滚动窗口 chapters-001-015.md 漏标）/
 * 删除进行中卷（31+ 章）漏标。
 * 非关键路径：失败仅日志，不阻断卷编辑。
 */
async function invalidateVolumeMemory(
  oldVolumes: VolumeData[],
  newVolumes: VolumeData[],
  changedOld: VolumeData | null | undefined,
  changedNew: VolumeData | null | undefined,
): Promise<void> {
  try {
    const oldStart = changedOld?.chapterStart ?? changedNew?.chapterStart ?? 1
    const newStart = changedNew?.chapterStart ?? oldStart
    const oldEnd = changedOld
      ? (changedOld.chapterEnd === 0 ? changedOld.chapterStart + 30 : changedOld.chapterEnd)
      : newStart
    const newEnd = changedNew
      ? (changedNew.chapterEnd === 0 ? changedNew.chapterStart + 30 : changedNew.chapterEnd)
      : oldStart
    const start = Math.min(oldStart, newStart)
    const end = Math.max(oldEnd, newEnd)
    await invalidateMemoryFiles(collectAffectedFiles(oldVolumes, newVolumes, start, end))
  } catch (e) {
    renderLog('warn', 'Memory', `[volume-store] 记忆文件失效标记失败: ${String(e)}`)
  }
}

export const useVolumeStore = create<VolumeState>()((set, get) => ({
  volumes: [],
  loaded: false,

  load: async () => {
    const seq = ++loadSeq
    try {
      const volumes = (await ipc.invoke('db:volume-get-all')) ?? []
      if (seq !== loadSeq) return false // 已被更新的加载请求取代（项目已切换）——volumes 未更新
      set({ volumes, loaded: true })
      return true
    } catch {
      if (seq !== loadSeq) return false
      set({ volumes: [], loaded: true })
      return false // 读取失败：无最新卷列表可用，调用方应跳过失效（避免用错数据打 stale）
    }
  },

  reset: () => {
    set({ volumes: [], loaded: false })
  },

  upsert: async (data) => {
    const res = await ipc.invoke('db:volume-upsert', data)
    if (res.success) {
      const oldVolumes = get().volumes // 变更前快照
      const changedOld = oldVolumes.find(v => v.volumeNumber === data.volumeNumber) // 编辑时存在；新建时 undefined
      const applied = await get().load() // 刷新为变更后（loadSeq 竞态守卫：被项目切换取代则跳过失效）
      if (applied) {
        await invalidateVolumeMemory(oldVolumes, get().volumes, changedOld, data)
      }
    }
    return res.success === true
  },

  remove: async (volumeNumber) => {
    const oldVolumes = get().volumes // 变更前快照（含被删卷）
    const changedOld = oldVolumes.find(v => v.volumeNumber === volumeNumber)
    const res = await ipc.invoke('db:volume-delete', volumeNumber)
    if (res.success) {
      const applied = await get().load()
      if (applied) {
        await invalidateVolumeMemory(oldVolumes, get().volumes, changedOld, null)
      }
    }
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
