import { create } from 'zustand'

/** 左侧活动栏的视图类型（工作台已并入项目结构视图：ProjectTree 为完整超集） */
export type SidebarView = 'home' | 'project' | 'knowledge' | 'characters' | 'settings'

/** 下方工具窗口 Tab */
export type BottomTab = 'tasks' | 'log' | 'activity'

/** 右侧面板视图类型 */
export type RightView = 'agent' | 'ai-output'

/** 章节创建对话框的预填参数 */
export type ChapterCreationPrefill = Record<string, unknown> | null

interface LayoutState {
  // ===== 侧边栏 =====
  sidebarOpen: boolean
  sidebarView: SidebarView

  // ===== AI 对话面板 =====
  aiPanelOpen: boolean
  /** 右侧面板当前视图：Agent 对话 / AI 输出 */
  rightView: RightView

  // ===== 底部面板 =====
  bottomPanelOpen: boolean
  bottomTab: BottomTab

  // ⚠️ 这里曾有 sidebarWidth / aiPanelWidth / bottomPanelHeight 三个字段与 setter，
  //    但全仓从未被读写——四个区域的拖拽缩放实际由 App.tsx 的 react-resizable-panels
  //    (defaultSize / minSize / collapsible) 承担。留着它们会让人误以为布局尺寸归 store 管
  //    （2026-09-19 已因此给出过错误结论），故删除。

  // ===== 全局弹窗状态（替代 window.dispatchEvent 事件总线）=====
  /** 设置弹窗是否打开 */
  settingsOpen: boolean
  /** 打开设置时指定的初始分区（无则回默认 llm） */
  settingsSection?: string
  /** 新建项目对话框是否打开 */
  newProjectOpen: boolean
  /** 导入小说对话框是否打开 */
  importNovelOpen: boolean
  /** 章节创建对话框是否打开 */
  chapterCreationOpen: boolean
  /** 章节创建对话框的预填参数 */
  chapterCreationPrefill: ChapterCreationPrefill

  // ===== Actions =====
  toggleSidebar: () => void
  setSidebarView: (view: SidebarView) => void
  toggleAIPanel: () => void
  setAIPanelOpen: (open: boolean) => void
  setRightView: (view: RightView) => void
  /** 打开右侧面板并切换到指定视图 */
  openRightPanel: (view: RightView) => void
  toggleBottomPanel: () => void
  setBottomTab: (tab: BottomTab) => void
  openBottomTab: (tab: BottomTab) => void
  /**
   * 关闭（隐藏）某个区域 —— 由「分隔条拖过阈值后的**松手**」触发（见 `App.tsx` 的 `closeOnDragBelow`）。
   *
   * ⚠️ **只能在松手后调用，不要在拖拽过程中调用**：`react-resizable-panels` 在拖拽中持有布局，
   * 此时卸载面板会让「注册 N 个面板 / DOM N−1 个」不一致，`ResizeObserver` 回调随即抛
   * `Invalid N panel layout: …` 并刷屏（2026-09-20 实测事故）。
   * 恢复走各区域的显式开关：侧栏 / 底栏 ← 左侧活动栏，AI 面板 ← 右侧图标栏。
   */
  closeRegion: (region: 'sidebar' | 'ai' | 'bottom') => void

  // ===== 专注写作模式 =====
  focusMode: boolean
  toggleFocusMode: () => void

  // ===== 全局弹窗 Actions =====
  /** 打开设置弹窗，可指定初始分区（如 'llm'） */
  openSettings: (section?: string) => void
  closeSettings: () => void
  openNewProject: () => void
  closeNewProject: () => void
  openImportNovel: () => void
  closeImportNovel: () => void
  openChapterCreation: (prefill?: ChapterCreationPrefill) => void
  closeChapterCreation: () => void
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  // 默认值（home：历史项目方块列表入口，替换原 Archive 图标）
  sidebarOpen: true,
  sidebarView: 'home',

  aiPanelOpen: true,
  rightView: 'agent',

  bottomPanelOpen: true,
  bottomTab: 'tasks',

  focusMode: false,
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  // 全局弹窗默认关闭
  settingsOpen: false,
  settingsSection: undefined,
  newProjectOpen: false,
  importNovelOpen: false,
  chapterCreationOpen: false,
  chapterCreationPrefill: null,

  // Actions
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarView: (view) =>
    set((s) => ({
      sidebarView: view,
      sidebarOpen: s.sidebarView === view ? !s.sidebarOpen : true,
    })),

  toggleAIPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
  setAIPanelOpen: (open) => set({ aiPanelOpen: open }),
  setRightView: (view) => set({ rightView: view }),
  openRightPanel: (view) => set({ aiPanelOpen: true, rightView: view }),

  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setBottomTab: (tab) =>
    set((s) => ({
      bottomTab: tab,
      bottomPanelOpen: s.bottomTab === tab ? !s.bottomPanelOpen : true,
    })),
  openBottomTab: (tab) => set({ bottomPanelOpen: true, bottomTab: tab }),

  // 拖过阈值后的**松手**才调用（时序见接口注释：拖拽中卸载面板会触发库的 Invalid N panel layout）
  closeRegion: (region) =>
    set(region === 'sidebar' ? { sidebarOpen: false } : region === 'ai' ? { aiPanelOpen: false } : { bottomPanelOpen: false }),

  // 全局弹窗 Actions
  openSettings: (section) => set({ settingsOpen: true, settingsSection: section }),
  closeSettings: () => set({ settingsOpen: false }),
  openNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
  openImportNovel: () => set({ importNovelOpen: true }),
  closeImportNovel: () => set({ importNovelOpen: false }),
  openChapterCreation: (prefill = null) => set({ chapterCreationOpen: true, chapterCreationPrefill: prefill }),
  closeChapterCreation: () => set({ chapterCreationOpen: false, chapterCreationPrefill: null }),
}))
