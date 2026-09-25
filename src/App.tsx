import { useEffect } from 'react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useShallow } from 'zustand/shallow'
import { useThemeStore } from './stores/theme-store'
import { useLayoutStore } from './stores/layout-store'
import { useLLMStore } from './stores/llm-store'
import { useProjectStore } from './stores/project-store'
import { useMCPStore } from './stores/mcp-store'
import { useWorkflowStore } from './stores/workflow-store'
import { useUpdateStore } from './stores/update-store'
import { t } from './shared/locale'
import { ipc } from './services/ipc-client'
import StatusBar from './components/layout/StatusBar'
import LeftToolWindowBar from './components/layout/LeftToolWindowBar'
import RightToolWindowBar from './components/layout/RightToolWindowBar'
import Sidebar from './components/panels/Sidebar'
import EditorArea from './components/panels/EditorArea'
import AIPanel from './components/panels/AIPanel'
import AIOutputPanel from './components/panels/AIOutputPanel'
import BottomPanel from './components/panels/BottomPanel'
import NewProjectDialog from './components/dialogs/NewProjectDialog'
import ImportNovelDialog from './components/dialogs/ImportNovelDialog'
import ChapterCreationDialog from './components/dialogs/ChapterCreationDialog'
import ActivityDialog from './components/dialogs/ActivityDialog'
import SettingsModal from './components/settings/SettingsModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { toast } from './components/ui/Toast'
import { globalEventBus } from './shared/event-bus'
import UpdateNotification from './components/UpdateNotification'
import { loadCustomPrompts } from './services/prompt-templates'
import GlobalTitleTooltip from './components/ui/GlobalTitleTooltip'

// L2 任务6：恢复前加载所有 workflow 模块，触发顶层 registerWorkflow（须在 restoreCheckpoint 调用之前，
// 否则恢复时 registry 空 → 所有 run 走降级）。
import './services/workflows/workflow-registry-init'

/**
 * 各区域的**内容下限（像素）**——低于这个宽度就看不出这块是什么功能了，所以它就是拖拽下限。
 *
 * ⚠️ `react-resizable-panels` 的尺寸 prop **数字按像素解释**（只有带单位的字符串才是其它语义：
 * `"20%"` 是百分比、`"176px"` 是像素）。此前写的 `minSize={10}` 一直是 **10 像素**，
 * 等于没有下限——这正是「区域能一路收缩到底」的原因。
 */
const REGION_MIN_PX = { sidebar: 176, ai: 232, bottom: 88 } as const

/**
 * ⚠️ **单位必须显式写清**（2026-09-20 连环踩坑的根源）：
 * `react-resizable-panels` 的尺寸 prop —— **数字 = 像素**（`dist/…js:95-110` 用 `sizeStyleToPx` 换算），
 * 只有带单位的字符串才是别的语义（`"20%"` 百分比、`"176px"` 像素）。
 *
 * 原代码的 `defaultSize={20}/{60}/{20}` 其实是 **20px/60px/20px**，只因库把各面板尺寸做了**比例归一化**
 * 才看起来像 20%:60%:20%。所以一旦引入 176/232 像素下限，下限就会把默认布局顶开、比例失真
 * （真机现象：重启后各区域大小不对）。**默认尺寸一律写成百分比字符串，下限一律写成像素。**
 */
const SIDEBAR_DEFAULT = '20%'
const AI_PANEL_DEFAULT = '20%'
const EDITOR_DEFAULT = '60%'
/** 编辑区下限：两侧面板现在都有真实下限，编辑区不能被挤成一条缝 */
const EDITOR_MIN_PX = 320

/** 区域 → 我们自己的 DOM 标记属性值（`[data-region]`，见面板内的包装 div） */
const REGION_PANEL_ID = { sidebar: 'sidebar', ai: 'ai', bottom: 'bottom' } as const

/**
 * 分隔条**松手**时：若该区域已贴到内容下限 → 关闭它。
 *
 * 三个设计决定，都是踩坑换来的（2026-09-20，勿回退）：
 * - **直接量 DOM**（我们自己的 `[data-region]` 标记 div 的 `getBoundingClientRect`），不引入 ref / 模块级可变状态：
 *   `App.tsx` 每次热更新都会重新求值模块顶层，模块级变量与 `window.addEventListener` 会**累积**，
 *   旧闭包不失效 → 表现为「区域莫名自己关掉」。
 * - **不用 `collapsible`**：库按 panel id 记账折叠态，关闭时卸载、重开时同 id 注册，可能恢复
 *   「已折叠」记忆 → 区域看似回来了却仍是 0 宽；而且 `collapsible` 是「一过下限立刻折到 0」，
 *   没有「停在下限」这一步。
 * - **只在松手后关闭**：拖拽中库持有布局，此时卸载面板会让「注册 N 个 / DOM N−1 个」不一致，
 *   `ResizeObserver` 回调随即抛 `Invalid N panel layout: …` 并刷屏。
 */
function closeIfAtFloor(region: 'sidebar' | 'ai' | 'bottom'): void {
  const el = document.querySelector(`[data-region="${REGION_PANEL_ID[region]}"]`)
  if (!(el instanceof HTMLElement)) return
  const rect = el.getBoundingClientRect()
  const px = region === 'bottom' ? rect.height : rect.width
  // 容差 1px：`minSize` 也是像素，贴住下限时两者应当相等
  if (px > 0 && px <= REGION_MIN_PX[region] + 1) {
    useLayoutStore.getState().closeRegion(region)
  }
}

/**
 * NovelForge 主应用组件
 * 使用 react-resizable-panels 实现可拖拽调整大小的四区布局：
 * 每个区域有**内容下限**（到下限即停住）；在下限处松手 → 该区域**关闭（消失）**，
 * 从活动栏 / 右侧图标栏可重新打开。实现细节见 `closeIfAtFloor` 的注释。
 */
export default function App() {
  const initTheme = useThemeStore((s) => s.initTheme)
  // 合并 layout selector 为单次 subscribe（useShallow 浅比较），避免过度订阅导致全树重渲染
  const {
    sidebarOpen, aiPanelOpen, rightView, settingsOpen, closeSettings,
    newProjectOpen, closeNewProject,
    importNovelOpen, closeImportNovel, chapterCreationOpen,
    chapterCreationPrefill, closeChapterCreation,
    focusMode, bottomPanelOpen,
    activityDialogOpen, closeActivityDialog,
  } = useLayoutStore(useShallow(s => ({
    sidebarOpen: s.sidebarOpen,
    aiPanelOpen: s.aiPanelOpen,
    rightView: s.rightView,
    settingsOpen: s.settingsOpen,
    closeSettings: s.closeSettings,
    newProjectOpen: s.newProjectOpen,
    closeNewProject: s.closeNewProject,
    importNovelOpen: s.importNovelOpen,
    closeImportNovel: s.closeImportNovel,
    chapterCreationOpen: s.chapterCreationOpen,
    chapterCreationPrefill: s.chapterCreationPrefill,
    closeChapterCreation: s.closeChapterCreation,
    focusMode: s.focusMode,
    bottomPanelOpen: s.bottomPanelOpen,
    activityDialogOpen: s.activityDialogOpen,
    closeActivityDialog: s.closeActivityDialog,
  })))
  const initLLM = useLLMStore((s) => s.init)
  const loadRecentProjects = useProjectStore((s) => s.loadRecentProjects)


  // 初始化：主题 + LLM 模型 + 最近项目 + 缩放级别
  useEffect(() => {
    const t0 = performance.now()
    initTheme()
    console.log(`[Startup] initTheme 完成: ${(performance.now() - t0).toFixed(0)}ms`)
    const t1 = performance.now()
    initLLM()
    console.log(`[Startup] initLLM 触发: ${(performance.now() - t1).toFixed(0)}ms`)
    const t2 = performance.now()
    loadRecentProjects()
    console.log(`[Startup] loadRecentProjects 触发: ${(performance.now() - t2).toFixed(0)}ms`)
    // 加载全局自定义 Prompt 覆盖（Issue #19：此前从未调用导致自定义保存后回退内置模板）
    loadCustomPrompts()
    // 初始化 MCP Store
    useMCPStore.getState().init().catch(e => console.warn('[MCP] 初始化失败:', e))
    // 恢复未完成的工作流 checkpoint（L2 v2：async——DB 读 + rehydrate 重建 + 断点重放决断）
    void (async () => {
      const cp = await useWorkflowStore.getState().restoreCheckpoint()
      if (cp && cp.activeRuns.length > 0) {
        console.log(`[Workflow] 检测到 ${cp.activeRuns.length} 个未完成工作流，已恢复（保存时间: ${cp.savedAt}）`)
      }
      // M2 崩溃恢复续读：把中断步骤落盘输出（workflow-output 文件）补回空的 step.result（异步，失败无害）
      useWorkflowStore.getState().hydrateInterruptedOutputs().catch(e => console.warn('[Workflow] 输出文件续读失败:', e))
    })().catch(e => console.warn('[Workflow] checkpoint 恢复失败:', e))
    if (ipc.isElectron) {
      const savedZoom = localStorage.getItem('vela-zoom-level')
      if (savedZoom) ipc.setZoomLevel(parseFloat(savedZoom))
    }
    // 初始化 ProjectService — 注册全局事件监听（生命周期与 App 一致）
    import('./services/project-service').then(({ initProjectService }) => {
      initProjectService()
    }).catch(e => console.warn('[ProjectService] 初始化失败:', e))

    // 初始化 TransferHub — 中枢消息路由（中间件管道 + 请求响应）
    import('./services/hub-service').then(({ initializeHub }) => {
      initializeHub()
    }).catch(e => console.warn('[HubService] 初始化失败:', e))

    // C) 工作流完成时弹出 ActionToast 通知（不依赖任何面板状态）
    const unsubActionToast = globalEventBus.on('WORKFLOW_COMPLETE', () => {
      const { history } = useWorkflowStore.getState()
      const latest = history.find(r => r.status === 'completed')
      if (!latest) return
      const shortTitle = latest.title.replace(/^[^\s]+\s/, '')
      toast.workflowComplete(
        `✅ 「${shortTitle}」${t('agent.taskComplete')}`,
        () => useLayoutStore.getState().openRightPanel('ai-output')
      )
    })

    return () => {
      // App 卸载时销毁 ProjectService（开发环境 HMR 时会触发）
      import('./services/project-service').then(({ disposeProjectService }) => {
        disposeProjectService()
      }).catch(() => {})
      // 销毁 TransferHub
      import('./services/hub-service').then(({ destroyHub }) => {
        destroyHub()
      }).catch(() => {})
      unsubActionToast()
    }
  }, [initTheme, initLLM, loadRecentProjects])

  // 全局快捷键: Cmd+N 新建项目，Cmd+O 打开项目，Cmd+=/-/0 缩放，F11 专注模式
  // （缩放与 F11 原由 TitleBar.tsx 注册；2026-09-22 标题栏移除后统一并入此处）
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // F11 — 专注模式（本身不带修饰键，须在 mod 判断之前拦截，并阻止浏览器默认全屏）
      if (e.key === 'F11') {
        e.preventDefault()
        useLayoutStore.getState().toggleFocusMode()
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        useThemeStore.getState().zoomIn()
      } else if (e.key === '-') {
        e.preventDefault()
        useThemeStore.getState().zoomOut()
      } else if (e.key === '0') {
        e.preventDefault()
        useThemeStore.getState().zoomReset()
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        useLayoutStore.getState().openNewProject()
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault()
        const folder = await ipc.invoke('dialog:select-folder')
        if (folder) {
          useProjectStore.getState().openProject(folder)
        }
      } else if (e.key === 'u' || e.key === 'U') {
        // 检查更新（原原生菜单 accelerator CmdOrCtrl+U，菜单已迁移至设置界面）
        e.preventDefault()
        useUpdateStore.getState().checkForUpdates()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div
      className="flex flex-col w-full h-full overflow-hidden"
      style={{
        /**
         * 顶部让位给**系统窗口控件覆盖层（WCO）** —— 且让位必须做在**最外层**。
         *
         * ⚠️ 教训（2026-09-25 真机）：先只给两个图标栏加了顶部 padding，结果覆盖层
         * 直接压在右侧 AGENT 面板头部上 —— 覆盖层的底色是 `--color-canvas`（最外围缝隙色），
         * 而它盖住的是面板头部（另一种底色），于是右上角出现一块**看得出来接缝的方块**。
         *
         * 做在最外层后：顶部那一条 = 纯画布色，与覆盖层（渲染层同样按 `--color-canvas` 推送）同色 → 无缝。
         * 高度由系统通过 `env(titlebar-area-height)` 告知；未启用覆盖层（macOS / 浏览器）时为 0。
         * 这条也是**应用唯一真正的顶栏空间**（系统只占右侧放窗口按钮，左侧全空）。
         */
        paddingTop: 'env(titlebar-area-height, 0px)',
        backgroundColor: 'var(--color-canvas)',
      }}
    >
      {/* 更新通知栏 */}
      <UpdateNotification />

      {/* 全局 title 悬停提示代理 — 原生 title 属性 → 现代化 Tooltip UI */}
      <GlobalTitleTooltip />

      {/*
        主体：flex 行 = LeftBar | 纵向PanelGroup | RightBar
        ┌───┬──────────────────────────────┬───┐
        │   │  Sidebar | Editor | AIPanel  │   │
        │ L │──────────────────────────────│ R │
        │   │     BottomPanel (全宽)        │   │
        └───┴──────────────────────────────┴───┘
      */}
      {/* 键盘导航跳过链接（仅 focus 时可见），直达编辑区主内容 */}
      <a
        href="#main-editor-area"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--color-accent)] focus:text-white focus:rounded"
      >
        {t('tip.skipToContent')}
      </a>

      {/* 整块内容区就是「画布」：padding 3px = 外围缝隙，恰为卡片之间内部缝隙（6px）的一半，
          且与内部缝隙同为画布色、连成一体。图标栏与相邻面板之间不留缝——它们绑定成一张卡片。
          （标题栏已于 2026-09-22 移除，四边缝因此等宽对称。） */}
      <div
        className="flex flex-1 overflow-hidden"
        style={{ backgroundColor: 'var(--color-canvas)', padding: 3 }}
      >

        {/* 左侧工具窗口栏（全高，包括底部面板区域）— 专注模式下隐藏（与其余面板一致） */}
        {!focusMode && <LeftToolWindowBar />}

        {/* 卡片层：卡片之间的缝隙露出的就是画布底色 */}
        <div data-canvas="true" className="flex-1 min-w-0 flex overflow-hidden">

          {/* 横向 PanelGroup：侧边栏 | 中列（编辑区 + 底栏） | AI 面板。
              ⚠️ 底栏只占**中列**（编辑区正下方），两侧面板向下延伸到底——2026-09-22 用户定的布局；
              此前底栏是全宽（挂在纵向 group 的下层），侧栏/AI 够不到底部。 */}
          <PanelGroup orientation="horizontal" className="flex-1">

            {/* 左侧边栏 — 专注模式下隐藏 */}
            {(sidebarOpen && !focusMode) && (
              <>
                <Panel id="sidebar" defaultSize={SIDEBAR_DEFAULT} minSize={REGION_MIN_PX.sidebar} aria-label={t('panel.sidebar')}>
                  {/* data-region 是**我们自己**的标记：`closeIfAtFloor` 靠它量尺寸。
                      ⚠️ 不要改用库的 `data-panel` —— 那是无值属性（渲染成 data-panel="true"），
                      拿 id 去选永远匹配不到（2026-09-20 实测踩过）。 */}
                  <div data-region="sidebar" className="h-full">
                    <ErrorBoundary fallbackLabel={t('error.sidebarFailed')}>
                      <Sidebar />
                    </ErrorBoundary>
                  </div>
                </Panel>
                {/* 松手时若侧栏已贴到内容下限 → 关闭它（见组件内 closeIfAtFloor 注释） */}
                <PanelResizeHandle onPointerUp={() => closeIfAtFloor('sidebar')} />
              </>
            )}

            {/* 中列：编辑区（上）+ 底栏（下）。这一列的宽度下限就是编辑区下限（EDITOR_MIN_PX） */}
            <Panel id="middle" defaultSize={EDITOR_DEFAULT} minSize={EDITOR_MIN_PX}>
              <PanelGroup orientation="vertical" className="h-full">

                {/* 编辑区 — 专注模式下居中 + 大字号 */}
                <Panel id="editor" defaultSize="75%" minSize="25%" aria-label={t('panel.editor')}>
                  <div id="main-editor-area" />
                  <div data-region="editor" className={focusMode ? 'max-w-[720px] mx-auto h-full text-[18px]' : 'h-full'}>
                    <ErrorBoundary fallbackLabel={t('error.editorFailed')}>
                      <EditorArea onNewProject={() => useLayoutStore.getState().openNewProject()} />
                    </ErrorBoundary>
                  </div>
                </Panel>

                {/* 底栏 — bottomPanelOpen 控制显隐（镜像右侧 aiPanelOpen 模式） */}
                {(bottomPanelOpen && !focusMode) && <PanelResizeHandle onPointerUp={() => closeIfAtFloor('bottom')} />}
                {(bottomPanelOpen && !focusMode) && (
                  <Panel id="bottom" defaultSize="25%" minSize={REGION_MIN_PX.bottom} aria-label={t('panel.bottom')}>
                    <div data-region="bottom" className="h-full">
                      <ErrorBoundary fallbackLabel={t('error.taskPanelFailed')}>
                        <BottomPanel />
                      </ErrorBoundary>
                    </div>
                  </Panel>
                )}
              </PanelGroup>
            </Panel>

            {/* 右侧面板（Agent 对话 / AI 输出）— 专注模式下隐藏 */}
            {(aiPanelOpen && !focusMode) && (
              <>
                {/* 松手时若 AI 面板已贴到内容下限 → 关闭它 */}
                <PanelResizeHandle onPointerUp={() => closeIfAtFloor('ai')} />
                <Panel id="ai-panel" defaultSize={AI_PANEL_DEFAULT} minSize={REGION_MIN_PX.ai} aria-label={t('panel.ai')}>
                  <div data-region="ai" className="h-full">
                    <ErrorBoundary fallbackLabel={t('error.aiPanelFailed')}>
                      {rightView === 'ai-output' ? <AIOutputPanel /> : <AIPanel />}
                    </ErrorBoundary>
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>

        {/* 右侧工具窗口栏 — 专注模式下隐藏 */}
        {!focusMode && <RightToolWindowBar />}
      </div>


      {/* 状态栏（全宽） */}
      <StatusBar />

      {/* 全局对话框 — 由 layout-store 控制开关，每个包裹独立 ErrorBoundary 防止单点崩溃 */}
      <ErrorBoundary fallbackLabel={t('error.dialogFailed')}>
        <NewProjectDialog
          open={newProjectOpen}
          onClose={closeNewProject}
        />
      </ErrorBoundary>
      <ErrorBoundary fallbackLabel={t('error.dialogFailed')}>
        <ImportNovelDialog
          open={importNovelOpen}
          onClose={closeImportNovel}
        />
      </ErrorBoundary>
      <ErrorBoundary fallbackLabel={t('error.dialogFailed')}>
        <ChapterCreationDialog
          isOpen={chapterCreationOpen}
          prefill={chapterCreationPrefill}
          onClose={closeChapterCreation}
        />
      </ErrorBoundary>
      {/* 写作统计弹窗（2026-09-22 由"编辑区页面"改为弹窗） */}
      <ErrorBoundary fallbackLabel={t('error.dialogFailed')}>
        <ActivityDialog
          open={activityDialogOpen}
          onClose={closeActivityDialog}
        />
      </ErrorBoundary>
      {/* 全屏设置弹窗 — key 随开关变化重新挂载，保证每次打开回到默认分区 */}
      <ErrorBoundary fallbackLabel={t('error.dialogFailed')}>
        <SettingsModal
          key={String(settingsOpen)}
          open={settingsOpen}
          onClose={closeSettings}
        />
      </ErrorBoundary>

    </div>
  )
}
