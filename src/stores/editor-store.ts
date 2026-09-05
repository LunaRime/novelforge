import { create } from 'zustand'
import { aggregateDecision } from '../services/diff/hunk-model'
import type { DiffSession } from '../services/diff/hunk-model'

/** 编辑器 Tab 数据 */
export interface EditorTab {
  id: string
  name: string
  type: 'chapter' | 'outline' | 'character' | 'config' | 'diff' | 'chapter-card' | 'world-building' | 'arch-file' | 'version-history' | 'review-report'
  filePath?: string
  content?: string
  /** diff 视图的原始内容 */
  originalContent?: string
  dirty?: boolean
  /** 固定 Tab，不可关闭 */
  pinned?: boolean
  /** 修稿文件路径（三栏合并用） */
  revisionPath?: string
  /** 审稿报告内容（供「根据意见修稿」使用） */
  reviewReport?: string
  /** 草稿所属章节号 */
  chapterNumber?: number
  /** 草稿所在章节目录 */
  chapterDir?: string
  /** 审稿报告存放路径 */
  reportPath?: string
  /** L1 inline 接受会话（决策态随 tab 持久；正文文本仍走 content） */
  inlineSession?: DiffSession
}

interface EditorState {
  /** 打开的 Tab 列表 */
  tabs: EditorTab[]
  /** 当前活跃的 Tab ID */
  activeTabId: string | null

  // ===== Actions =====
  /** 打开文件（如果已打开则激活） */
  openFile: (tab: EditorTab) => void
  /** 关闭 Tab */
  closeTab: (tabId: string) => void
  /** 激活 Tab */
  setActiveTab: (tabId: string) => void
  /**
   * 更新 Tab 内容（标记 dirty）
   * 仅在「用户修改」时调用，会亮起未保存指示灯。
   */
  updateTabContent: (tabId: string, content: string) => void
  /**
   * 静默同步 Tab 内容（不标记 dirty，也不清除 dirty）
   * 用于「AI 生成完成后刷新」、「打开文件刷新」等非用户编辑场景。
   */
  syncTabContent: (tabId: string, content: string) => void
  /**
   * 标记 Tab 已保存（清除 dirty 标记）
   * 在保存成功后调用，使警示灯、Tab 圆点消失。
   */
  markTabSaved: (tabId: string) => void
  /** 开始 inline 会话（A 入口 AI 输出进入会话；同 tab 已有会话则覆盖） */
  beginInlineSession: (tabId: string, session: DiffSession) => void
  /** 更新单子 hunk 决策（决策表 + 组聚合单写路径；未知 subHunkId no-op） */
  updateHunkDecision: (tabId: string, subHunkId: string, decision: 'accepted' | 'rejected') => void
  /** 重置单子 hunk 决策为 pending（误拒/误选恢复；accepted 后须先 doc 层 undo） */
  resetHunkDecision: (tabId: string, subHunkId: string) => void
  /** 结束会话（discard 语义：清 inlineSession；不清 dirty/content——已接受文本保留） */
  endInlineSession: (tabId: string) => void
  /** 清空所有 Tab */
  clearTabs: () => void
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  tabs: [],
  activeTabId: null,

  openFile: (tab) => {
    // diff 类型每次内容不同，只按 id 精确匹配（不走 filePath 去重）
    // 其他类型（含 review-report）按 filePath + type 去重
    const idOnly = tab.type === 'diff'
    const existing = get().tabs.find((t) =>
      t.id === tab.id ||
      (!idOnly && tab.filePath !== undefined && t.filePath === tab.filePath && t.type === tab.type)
    )
    if (existing) {
      // diff / review-report 每次内容不同，强制更新内容后激活
      if (tab.type === 'diff' || tab.type === 'review-report') {
        set((s) => ({
          tabs: s.tabs.map((t) => t.id === existing.id ? { ...t, ...tab, id: tab.id } : t),
          activeTabId: tab.id,
        }))
      } else {
        // 其他类型 Tab：已打开，更新名称并直接激活。
        // 非 dirty 时刷新内容——打开入口读到的通常是最新 DB/磁盘内容，
        // 不刷新会显示陈旧版本（如定稿后再次打开正式稿 Tab）。
        // dirty 时保留用户未保存编辑，仅激活。
        const contentUpdate = tab.content !== undefined && !existing.dirty
          ? { content: tab.content }
          : {}
        set((s) => ({
          tabs: s.tabs.map((t) => t.id === existing.id ? { ...t, name: tab.name, ...contentUpdate } : t),
          activeTabId: existing.id,
        }))
      }
    } else {
      // 新开 Tab
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
      }))
    }
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get()
    // pinned Tab 不可关闭
    const target = tabs.find((t) => t.id === tabId)
    if (target?.pinned) return
    const newTabs = tabs.filter((t) => t.id !== tabId)
    set({
      tabs: newTabs,
      activeTabId: activeTabId === tabId
        ? (newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null)
        : activeTabId,
    })
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId })
  },

  updateTabContent: (tabId, content) => {
    set((s) => ({
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, content, dirty: true } : t),
    }))
  },

  // 静默刷新内容（不改变 dirty 标记，用于 AI 生成后刷新、打开文件同步等场景）
  syncTabContent: (tabId, content) => {
    set((s) => ({
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, content } : t),
    }))
  },

  // 标记 Tab 已保存 —— 清除 dirty 标记，使标题栏警示灯和 Tab 圆点消失
  markTabSaved: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, dirty: false } : t),
    }))
  },

  // ===== L1 inline 会话（决策态随 tab 持久；doc 文本不进决策表，正文走 content）=====

  beginInlineSession: (tabId, session) => {
    set((s) => ({
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, inlineSession: session } : t),
    }))
  },

  // 决策表 + 组级 decision 聚合的单写路径（hunk-model aggregateDecision 唯一调用方）
  updateHunkDecision: (tabId, subHunkId, decision) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || !t.inlineSession) return t
        const session = t.inlineSession
        if (!session.hunks.some(h => h.sub.some(x => x.id === subHunkId))) return t // 未知 subHunkId → no-op
        const decisions = { ...session.decisions, [subHunkId]: decision }
        return {
          ...t,
          inlineSession: {
            ...session,
            decisions,
            hunks: session.hunks.map(h => h.sub.some(x => x.id === subHunkId)
              ? { ...h, decision: aggregateDecision(h.sub, decisions) }
              : h),
          },
        }
      }),
    }))
  },

  resetHunkDecision: (tabId, subHunkId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || !t.inlineSession) return t
        const session = t.inlineSession
        // 决策表摘除该 subHunkId（strict noUnusedLocals 下避免 rest-omit 解构未用变量，用显式拷贝）
        const rest: typeof session.decisions = {}
        for (const k of Object.keys(session.decisions)) {
          if (k !== subHunkId) rest[k] = session.decisions[k]
        }
        return {
          ...t,
          inlineSession: {
            ...session,
            decisions: rest,
            hunks: session.hunks.map(h => h.sub.some(x => x.id === subHunkId)
              ? { ...h, decision: aggregateDecision(h.sub, rest) }
              : h),
          },
        }
      }),
    }))
  },

  // discard 语义：清 inlineSession（未决建议丢弃）；不清 dirty/content——已接受文本保留走既有保存链路
  endInlineSession: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => t.id === tabId ? { ...t, inlineSession: undefined } : t),
    }))
  },

  clearTabs: () => {
    set({ tabs: [], activeTabId: null })
  },
}))
