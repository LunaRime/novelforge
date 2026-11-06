/**
 * 草稿状态管理 — 管理各章节草稿列表、定稿操作等
 *
 * 当前项目仍以 DB 为事实源，虚拟 URI 仅携带真实 draftId。
 */
import { create } from 'zustand'
import { readVelaContent } from '../services/vela-protocol'
import { ipc } from '../services/ipc-client'
import {
  updateDraftStatus as updateDraftStatusInIndex,
  type DraftMeta,
  captureDraftProject, draftIdFromPath,
} from '../services/draft-index'
import type { DraftStatus } from '../shared/draft-status'
import { useProjectStore } from './project-store'

// ===== 类型定义 =====

/** 单章下的草稿列表（key = chapterNumber） */
export type DraftsByChapter = Record<number, DraftMeta[]>

interface DraftState {
  /** 各章草稿列表（内存缓存），key = chapterNumber */
  draftsByChapter: DraftsByChapter
  /** 是否正在加载 */
  loading: boolean

  // ===== Actions =====
  /** 重置为初始状态（项目关闭时由 ProjectService 调用） */
  reset: () => void
  /** 加载某章的所有草稿 */
  loadChapterDrafts: (chapterNumber: number) => Promise<void>
  /** 加载全部章节草稿（扫描 drafts/ 目录下所有 ch{NNN} 子目录） */
  loadAllDrafts: () => Promise<void>

  /** 手动标记草稿状态（修稿/审稿后更新用） */
  markDraftStatus: (draftPath: string, chapterNumber: number, status: DraftStatus) => Promise<void>
  /** 清除指定章节的缓存（下次访问时重新加载） */
  invalidateChapter: (chapterNumber: number) => void
}

// 草稿加载请求序号（loadAllDrafts 防跨项目切换竞态）
let draftLoadSeq = 0

export const useDraftStore = create<DraftState>()((set, get) => ({
  draftsByChapter: {},
  loading: false,

  reset: () => {
    ++draftLoadSeq
    set({ draftsByChapter: {}, loading: false })
  },

  loadChapterDrafts: async (chapterNumber) => {
    const project = useProjectStore.getState().currentProject
    if (!project) return

    const assertProject = captureDraftProject()
    try {
      // 直接调用后端 DB 获取列表，正文与展示 URI 不进入列表元数据
      const list = await ipc.invoke('db:draft-list', chapterNumber)
      assertProject()
      const metas: DraftMeta[] = list.map((m) => ({
        ...m,
        status: m.status as DraftStatus,
        source: m.source as DraftMeta['source'],
      }))

      // 按版本号排序（新 → 旧）
      metas.sort((a, b) => b.version - a.version)

      set(s => ({
        draftsByChapter: { ...s.draftsByChapter, [chapterNumber]: metas },
      }))
    } catch {
      // 出错或不存在时跳过
    }
  },

  loadAllDrafts: async () => {
    const project = useProjectStore.getState().currentProject
    if (!project) return

    // 请求序号：项目快速切换时旧项目的慢响应不得覆盖当前项目数据
    const assertProject = captureDraftProject()
    const seq = ++draftLoadSeq
    set({ loading: true })
    try {
      // 获取所有有草稿的章节号（不仅限有蓝图的章节，导入流程先建草稿后推演蓝图）
      const chapterNums: number[] = await ipc.invoke('db:draft-get-all-chapter-numbers')
      assertProject()
      const newDraftsByChapter: DraftsByChapter = {}

      for (const chNum of chapterNums) {
        assertProject()
        const list = await ipc.invoke('db:draft-list', chNum)
        assertProject()
        if (!list || list.length === 0) continue

        const metas: DraftMeta[] = list.map((m) => ({
          ...m,
          status: m.status as DraftStatus,
          source: m.source as DraftMeta['source'],
        }))

        metas.sort((a, b) => b.version - a.version)
        newDraftsByChapter[chNum] = metas
      }

      if (seq !== draftLoadSeq) return // 已被更新的加载请求取代（项目已切换）
      set({ draftsByChapter: newDraftsByChapter })
    } finally {
      if (seq === draftLoadSeq) set({ loading: false })
    }
  },


  markDraftStatus: async (draftPath, chapterNumber, status) => {
    const assertProject = captureDraftProject()
    await updateDraftStatusInIndex(draftIdFromPath(draftPath), status)
    assertProject()
    await get().loadChapterDrafts(chapterNumber)
  },

  invalidateChapter: (chapterNumber) => {
    set(s => {
      const next = { ...s.draftsByChapter }
      delete next[chapterNumber]
      return { draftsByChapter: next }
    })
  },

}))

// ===== 辅助工具导出 =====

/**
 * 读取草稿文件正文（委托给 vela-protocol 统一路由）
 * @deprecated 建议直接使用 readVelaContent()
 */
export async function readDraftBody(filePath: string): Promise<string> {
  const assertProject = captureDraftProject()
  const content = await readVelaContent(filePath)
  assertProject()
  return content
}

export type { DraftMeta, DraftStatus }
