import { useEffect } from 'react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useThemeStore } from './stores/theme-store'
import { useLayoutStore } from './stores/layout-store'
import { useLLMStore } from './stores/llm-store'
import { useProjectStore } from './stores/project-store'
import { useMCPStore } from './stores/mcp-store'
import { useWorkflowStore } from './stores/workflow-store'
import { ipc } from './services/ipc-client'
import TitleBar from './components/layout/TitleBar'
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
import ExportDialog from './components/dialogs/ExportDialog'
import SettingsModal from './components/settings/SettingsModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { actionToast } from './components/ui/ActionToast'
import { globalEventBus } from './shared/event-bus'
import UpdateNotification from './components/UpdateNotification'

/**
 * Vela 主应用组件
 * 使用 react-resizable-panels 实现可拖拽调整大小的四区布局
 */
export default function App() {
  const initTheme = useThemeStore((s) => s.initTheme)
  const sidebarOpen = useLayoutStore(s => s.sidebarOpen)
  const aiPanelOpen = useLayoutStore(s => s.aiPanelOpen)
  const rightView = useLayoutStore(s => s.rightView)
  const settingsOpen = useLayoutStore(s => s.settingsOpen)
  const closeSettings = useLayoutStore(s => s.closeSettings)
  const newProjectOpen = useLayoutStore(s => s.newProjectOpen)
  const closeNewProject = useLayoutStore(s => s.closeNewProject)
  const exportOpen = useLayoutStore(s => s.exportOpen)
  const closeExport = useLayoutStore(s => s.closeExport)
  const importNovelOpen = useLayoutStore(s => s.importNovelOpen)
  const closeImportNovel = useLayoutStore(s => s.closeImportNovel)
  const chapterCreationOpen = useLayoutStore(s => s.chapterCreationOpen)
  const chapterCreationPrefill = useLayoutStore(s => s.chapterCreationPrefill)
  const closeChapterCreation = useLayoutStore(s => s.closeChapterCreation)
  const initLLM = useLLMStore((s) => s.init)
  const loadRecentProjects = useProjectStore((s) => s.loadRecentProjects)

  // 初始化：主题 + LLM 模型 + 最近项目 + 缩放级别
  useEffect(() => {
    initTheme()
    initLLM()
    loadRecentProjects()
    // 初始化 MCP Store
    useMCPStore.getState().init().catch(e => console.warn('[MCP] 初始化失败:', e))
    // 恢复未完成的工作流 checkpoint
    const cp = useWorkflowStore.getState().restoreCheckpoint()
    if (cp && cp.activeRuns.length > 0) {
      console.log(`[Workflow] 检测到 ${cp.activeRuns.length} 个未完成工作流，已恢复为暂停状态（保存时间: ${cp.savedAt}）`)
    }
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
      actionToast.workflowComplete(
        `✅ 「${shortTitle}」已完成`,
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

  // 全局快捷键: Cmd+N 新建项目，Cmd+O 打开项目
  // 注意：Cmd+=/- 缩放已由 TitleBar.tsx 统一处理，此处不重复注册
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        useLayoutStore.getState().openNewProject()
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault()
        const folder = await ipc.invoke('dialog:select-folder')
        if (folder) {
          useProjectStore.getState().openProject(folder)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      {/* 标题栏 */}
      <TitleBar />

      {/* 更新通知栏 */}
      <UpdateNotification />

      {/*
        主体：flex 行 = LeftBar | 纵向PanelGroup | RightBar
        ┌───┬──────────────────────────────┬───┐
        │   │  Sidebar | Editor | AIPanel  │   │
        │ L │──────────────────────────────│ R │
        │   │     BottomPanel (全宽)        │   │
        └───┴──────────────────────────────┴───┘
      */}
      <div className="flex flex-1 overflow-hidden">

        {/* 左侧工具窗口栏（全高，包括底部面板区域） */}
        <LeftToolWindowBar />

        {/* 纵向 PanelGroup：上层主区域 + 下层底部面板 */}
        <PanelGroup orientation="vertical" className="flex-1">

          {/* 上层：侧边栏 | 编辑区 | AI 面板（水平分割） */}
          <Panel id="top" defaultSize={75} minSize={30}>
            <PanelGroup orientation="horizontal" className="flex-1 h-full">

              {/* 左侧边栏 */}
              {sidebarOpen && (
                <>
                  <Panel id="sidebar" defaultSize={20} minSize={10}>
                    <ErrorBoundary fallbackLabel="侧边栏渲染失败">
                      <Sidebar />
                    </ErrorBoundary>
                  </Panel>
                  <PanelResizeHandle />
                </>
              )}

              {/* 编辑区 */}
              <Panel id="editor" defaultSize={60} minSize={10}>
                <ErrorBoundary fallbackLabel="编辑区渲染失败">
                  <EditorArea onNewProject={() => useLayoutStore.getState().openNewProject()} />
                </ErrorBoundary>
              </Panel>

              {/* 右侧面板（Agent 对话 / AI 输出） */}
              {aiPanelOpen && (
                <>
                  <PanelResizeHandle />
                  <Panel id="ai-panel" defaultSize={20} minSize={10}>
                    <ErrorBoundary fallbackLabel="AI 面板渲染失败">
                      {rightView === 'ai-output' ? <AIOutputPanel /> : <AIPanel />}
                    </ErrorBoundary>
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>

          {/* 下层：底部面板（铺满整个 PanelGroup 宽度）— 始终挂载，面板控制显隐 */}
          <PanelResizeHandle />
          <Panel id="bottom" defaultSize={25} minSize={8}>
            <BottomPanel />
          </Panel>
        </PanelGroup>

        {/* 右侧工具窗口栏（全高，包括底部面板区域） */}
        <RightToolWindowBar />
      </div>


      {/* 状态栏（全宽） */}
      <StatusBar />

      {/* 全局对话框 — 由 layout-store 控制开关，不再依赖 window.dispatchEvent */}
      <NewProjectDialog
        open={newProjectOpen}
        onClose={closeNewProject}
      />
      <ImportNovelDialog
        open={importNovelOpen}
        onClose={closeImportNovel}
      />
      <ChapterCreationDialog
        isOpen={chapterCreationOpen}
        prefill={chapterCreationPrefill}
        onClose={closeChapterCreation}
      />
      <ExportDialog
        isOpen={exportOpen}
        onClose={closeExport}
      />
      {/* 全屏设置弹窗 */}
      <SettingsModal
        open={settingsOpen}
        onClose={closeSettings}
      />

    </div>
  )
}
