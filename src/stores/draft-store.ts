/**
 * 草稿状态管理 — 管理各章节草稿列表、定稿操作等
 *
 * 当前项目仍以 DB 为事实源，虚拟 URI 仅携带真实 draftId。
 */
import { create } from 'zustand'
import { readVelaContent } from '../services/vela-protocol'
import { ipc } from '../services/ipc-client'
import {
  type DraftMeta,
  captureDraftProject,
} from '../services/draft-index'
import type { DraftStatus } from '../shared/draft-status'
import { t } from '../shared/locale'
import { useProjectStore } from './project-store'

// ===== 类型定义 =====

/** 单章下的草稿列表（key = chapterNumber） */
export type DraftsByChapter = Record<number, DraftMeta[]>

interface DraftState {
  /** 各章草稿列表（内存缓存），key = chapterNumber */
  draftsByChapter: DraftsByChapter
  draftsScope: string | null
  /** 是否正在加载 */
  loading: boolean

  // ===== Actions =====
  /** 重置为初始状态（项目关闭时由 ProjectService 调用） */
  reset: () => void
  /** 加载某章的所有草稿 */
  loadChapterDrafts: (chapterNumber: number) => Promise<void>
  /** 加载全部章节草稿（扫描 drafts/ 目录下所有 ch{NNN} 子目录） */
  loadAllDrafts: () => Promise<void>

  archiveDraft: (draftId: number, chapterNumber: number, source: string) => Promise<void>
  /** 清除指定章节的缓存（下次访问时重新加载） */
  invalidateChapter: (chapterNumber: number) => void
}

// 草稿加载请求序号（loadAllDrafts 防跨项目切换竞态）
let draftLoadSeq = 0
let archiveVersion = 0
let archiveScope: string | null = null
const archiveReceipts = new Map<number, { version: number; updatedAt: number }>()

function applyLaterArchives(drafts: DraftMeta[], source: string, readVersion: number): DraftMeta[] {
  if (archiveScope !== source || readVersion === archiveVersion) return drafts
  return drafts.map(draft => {
    const receipt = archiveReceipts.get(draft.id)
    if (!receipt || receipt.version <= readVersion || draft.status === 'finalized'
      || (draft.updatedAt ?? 0) > receipt.updatedAt) return draft
    return { ...draft, status: 'archived', updatedAt: receipt.updatedAt }
  })
}

export function draftListScope({ currentProject, projectSession }: ReturnType<typeof useProjectStore.getState>): string | null {
  return currentProject ? JSON.stringify([currentProject.id, currentProject.path, projectSession]) : null
}

export function isDraftListCurrent(source: string): boolean {
  const state = useProjectStore.getState()
  return !state.loading && draftListScope(state) === source && useDraftStore.getState().draftsScope === source
}

export const useDraftStore = create<DraftState>()((set, get) => ({
  draftsByChapter: {},
  draftsScope: null,
  loading: false,

  reset: () => {
    ++draftLoadSeq
    ++archiveVersion
    archiveScope = null
    archiveReceipts.clear()
    set({ draftsByChapter: {}, draftsScope: null, loading: false })
  },

  loadChapterDrafts: async (chapterNumber) => {
    const source = draftListScope(useProjectStore.getState())
    if (!source) return

    const assertProject = captureDraftProject()
    const version = archiveVersion
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
        draftsScope: source,
        draftsByChapter: { ...(s.draftsScope === source ? s.draftsByChapter : {}), [chapterNumber]: applyLaterArchives(metas, source, version) },
      }))
    } catch {
      // 出错或不存在时跳过
    }
  },

  loadAllDrafts: async () => {
    const source = draftListScope(useProjectStore.getState())
    if (!source) return

    // 请求序号：项目快速切换时旧项目的慢响应不得覆盖当前项目数据
    const assertProject = captureDraftProject()
    const seq = ++draftLoadSeq
    const version = archiveVersion
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

      if (seq !== draftLoadSeq) return
      for (const chapter of chapterNums) {
        const drafts = newDraftsByChapter[chapter]
        if (drafts) newDraftsByChapter[chapter] = applyLaterArchives(drafts, source, version)
      }
      set({ draftsByChapter: newDraftsByChapter, draftsScope: source })
    } catch (error) {
      if (seq === draftLoadSeq && draftListScope(useProjectStore.getState()) === source) throw error
    } finally {
      if (seq === draftLoadSeq) set({ loading: false })
    }
  },


  archiveDraft: async (draftId, chapterNumber, source) => {
    const project = useProjectStore.getState().currentProject
    if (!project || !isDraftListCurrent(source)) throw new Error(t('error.noProject'))
    const result = await ipc.invoke('db:draft-archive', { projectPath: project.path, draftId, chapterNumber })
    if (!result?.success) throw new Error(result?.error || t('draftbox.archiveRejected'))
    if (!isDraftListCurrent(source)) return
    if (archiveScope !== source) {
      archiveScope = source
      archiveReceipts.clear()
    }
    const beforeArchive = archiveVersion
    archiveReceipts.set(draftId, { version: ++archiveVersion, updatedAt: result.updatedAt })
    const drafts = get().draftsByChapter[chapterNumber]
    if (!drafts) return
    set(s => ({
      draftsByChapter: {
        ...s.draftsByChapter,
        [chapterNumber]: applyLaterArchives(drafts, source, beforeArchive),
      },
    }))
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
