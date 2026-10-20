/**
 * 实验分支 store（v21）。
 * 分支数据在项目 DB；store 只做章节级缓存与动作。
 */
import { create } from 'zustand'
import { ipc } from '../services/ipc-client'

export interface DraftBranchView {
  id: number
  chapterNumber: number
  name: string
  status: 'active' | 'merged' | 'archived'
  baseSnapshotId: number | null
  headDraftId: number | null
  createdAt: number
  updatedAt: number
  mergedAt: number | null
}

interface BranchState {
  chapterNumber: number | null
  branches: DraftBranchView[]
  loading: boolean
  load: (chapterNumber: number) => Promise<void>
  create: (chapterNumber: number, name: string, baseDraftId?: number) => Promise<{ branch: DraftBranchView; draftId: number } | null>
  merge: (branchId: number) => Promise<{ branch: DraftBranchView; draftId: number } | null>
  archive: (branchId: number) => Promise<boolean>
}

export const useBranchStore = create<BranchState>()((set, get) => ({
  chapterNumber: null,
  branches: [],
  loading: false,

  load: async (chapterNumber) => {
    set({ chapterNumber, loading: true })
    try {
      const branches = await ipc.invoke('db:draft-branch-list', chapterNumber) as DraftBranchView[]
      if (get().chapterNumber === chapterNumber) set({ branches, loading: false })
    } catch {
      if (get().chapterNumber === chapterNumber) set({ branches: [], loading: false })
    }
  },

  create: async (chapterNumber, name, baseDraftId) => {
    const res = await ipc.invoke('db:draft-branch-create', chapterNumber, name, baseDraftId)
    if (!res.success || !res.branch || !res.draftId) return null
    await get().load(chapterNumber)
    return { branch: res.branch as DraftBranchView, draftId: res.draftId }
  },

  merge: async (branchId) => {
    const res = await ipc.invoke('db:draft-branch-merge', branchId)
    if (!res.success || !res.branch || !res.draftId) return null
    const chapterNumber = res.branch.chapterNumber
    await get().load(chapterNumber)
    return { branch: res.branch as DraftBranchView, draftId: res.draftId }
  },

  archive: async (branchId) => {
    const res = await ipc.invoke('db:draft-branch-archive', branchId)
    const chapterNumber = get().chapterNumber
    if (chapterNumber !== null) await get().load(chapterNumber)
    return res.success
  },
}))
