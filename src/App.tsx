import { lazy, Suspense, useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import { useThemeStore } from './stores/theme-store'
import { useLayoutStore } from './stores/layout-store'
import { useDevConsoleStore } from './stores/dev-console-store'
import { useLLMStore } from './stores/llm-store'
import { useProjectStore } from './stores/project-store'
import { useMCPStore } from './stores/mcp-store'
import { useWorkflowStore } from './stores/workflow-store'
import { useAgentStore } from './stores/agent-store'
import { useUpdateStore } from './stores/update-store'
import { matchesBinding, shortcutBinding } from './stores/shortcut-store'
import { useAutomationStore } from './stores/automation-store'
import { useThinkingStore } from './stores/thinking-store'
import { t } from './shared/locale'
import { useTranslation } from './hooks/useTranslation'
import { setWindowTitle } from './lib/window-title'
import { ipc } from './services/ipc-client'
import StatusBar from './components/layout/StatusBar'
import WorkspaceLayout from './components/layout/WorkspaceLayout'
import WorkbenchHeader from './components/layout/WorkbenchHeader'
import NewProjectDialog from './components/dialogs/NewProjectDialog'
import ImportNovelDialog from './components/dialogs/ImportNovelDialog'
import ChapterCreationDialog from './components/dialogs/ChapterCreationDialog'
const DevConsoleDialog = __DEV_CONSOLE__ ? lazy(() => import('./components/dev/DevConsoleDialog')) : null
import ActivityDialog from './components/dialogs/ActivityDialog'
import SettingsModal from './components/settings/SettingsModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { toast } from './components/ui/Toast'
import { globalEventBus } from './shared/event-bus'
import { FileProjectEditorDialog } from './components/dialogs/FileProjectEditorDialog'
import { loadCustomPrompts } from './services/prompt-templates'
import GlobalTitleTooltip from './components/ui/GlobalTitleTooltip'
import CommandPalette from './components/command-palette/CommandPalette'
import { useCommandStore } from './stores/command-store'

// L2 任务6：恢复前加载所有 workflow 模块，触发顶层 registerWorkflow（须在 restoreCheckpoint 调用之前，
// 否则恢复时 registry 空 → 所有 run 走降级）。
import './services/workflows/workflow-registry-init'

export default function App() {
  const initTheme = useThemeStore((s) => s.initTheme)
  // 合并 layout selector 为单次 subscribe（useShallow 浅比较），避免过度订阅导致全树重渲染
  const {
    settingsOpen, closeSettings,
    newProjectOpen, closeNewProject,
    importNovelOpen, closeImportNovel, chapterCreationOpen,
    chapterCreationPrefill, closeChapterCreation,
    activityDialogOpen, closeActivityDialog,
    devConsoleOpen, closeDevConsole,
  } = useLayoutStore(useShallow(s => ({
    settingsOpen: s.settingsOpen,
    closeSettings: s.closeSettings,
    newProjectOpen: s.newProjectOpen,
    closeNewProject: s.closeNewProject,
    importNovelOpen: s.importNovelOpen,
    closeImportNovel: s.closeImportNovel,
    chapterCreationOpen: s.chapterCreationOpen,
    chapterCreationPrefill: s.chapterCreationPrefill,
    closeChapterCreation: s.closeChapterCreation,
    activityDialogOpen: s.activityDialogOpen,
    closeActivityDialog: s.closeActivityDialog,
    devConsoleOpen: s.devConsoleOpen,
    closeDevConsole: s.closeDevConsole,
  })))
  // 开发者控制台可由 CLI/自动化远程打开（只负责开弹窗；后端仍有门禁）
  useEffect(() => {
    if (!__DEV_CONSOLE__) return
    const target = window as Window & { __velaOpenDevConsole?: () => void }
    target.__velaOpenDevConsole = () => useLayoutStore.getState().openDevConsole()
    return () => { delete target.__velaOpenDevConsole }
  }, [])

  const initLLM = useLLMStore((s) => s.init)
  const loadRecentProjects = useProjectStore((s) => s.loadRecentProjects)
  const currentProject = useProjectStore((s) => s.currentProject)
  // 订阅 locale 只为让下面那个「窗口标题」effect 在**切语言时重跑**（回落标题是本地化的）
  const { locale } = useTranslation()

  // 窗口标题 = 「项目名 — NovelForge」（无项目回落应用标题）。见 lib/window-title 的说明：
  // 我们是自绘顶栏，系统（任务栏 / Alt-Tab / Mission Control）看不到它，只认 document.title。
  useEffect(() => {
    setWindowTitle(currentProject?.name)
  }, [currentProject?.name, locale])

  // 写作自动化调度器（D 档）：项目打开时启动、关闭/切换时停止。
  // 执行宿主 = 渲染进程（应用开着才跑）；关窗中断的 run 由 checkpoint 机制在下次启动续跑。
  useEffect(() => {
    if (!currentProject?.path) return
    const { startScheduler, stopScheduler } = useAutomationStore.getState()
    startScheduler()
    return () => stopScheduler()
  }, [currentProject?.path])


  // 初始化：主题 + LLM 模型 + 最近项目 + 缩放级别
  useEffect(() => {
    const t0 = performance.now()
    initTheme()
    console.log(`[Startup] initTheme 完成: ${(performance.now() - t0).toFixed(0)}ms`)
    const t1 = performance.now()
    initLLM()
    console.log(`[Startup] initLLM 触发: ${(performance.now() - t1).toFixed(0)}ms`)
    // 全局思考等级（温度 + Agent 提示词强度）：与 initLLM 同批启动，读盘失败回退默认档
    void useThinkingStore.getState().init()
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
    // 渲染层门禁：未启用时隐藏命令面板/设置页入口
    if (__DEV_CONSOLE__) void useDevConsoleStore.getState().refresh()

    // 初始化 ProjectService — 注册全局事件监听（生命周期与 App 一致）
    import('./services/project-service').then(({ initProjectService }) => {
      initProjectService()
      // 自动化/CLI 入口：主进程通过 --project=<路径> / --dev-console 注入 query；
      // 打开后清掉 query，避免刷新重复打开。
      const params = new URLSearchParams(window.location.search)
      const requestedProject = params.get('project')
      const openDevConsoleOnStart = __DEV_CONSOLE__ && params.get('devconsole') === '1'
      const isolatedInstanceId = params.get('instance')
      if (requestedProject || openDevConsoleOnStart || isolatedInstanceId) {
        window.history.replaceState({}, '', window.location.pathname)
      }
      if (requestedProject) {
        void useProjectStore.getState().openProject(requestedProject)
          .catch(e => console.warn('[Startup] 打开指定项目失败:', e))
      }
      if (openDevConsoleOnStart) {
        useLayoutStore.getState().openDevConsole()
      }
    }).catch(e => console.warn('[ProjectService] 初始化失败:', e))

    // 初始化 TransferHub — 中枢消息路由（中间件管道 + 请求响应）
    import('./services/hub-service').then(({ initializeHub }) => {
      initializeHub()
    }).catch(e => console.warn('[HubService] 初始化失败:', e))

    // C) 工作流完成时弹出 ActionToast 通知（不依赖任何面板状态）+ 线② 2b D5 注入对话内完成回执卡片
    const unsubActionToast = globalEventBus.on('WORKFLOW_COMPLETE', (payload) => {
      const { activeRuns, history } = useWorkflowStore.getState()
      // emit 早于「移入 history」：刚完成的 run 此刻仍在 activeRuns（status=completed/failed）
      const latest = payload.runId
        ? (activeRuns.find(r => r.id === payload.runId) ?? history.find(r => r.id === payload.runId))
        : history.find(r => r.status === 'completed')
      if (!latest) return
      const shortTitle = latest.title.replace(/^[^\s]+\s/, '')
      // D5：对话内卡片为主——往活跃会话追加 workflow_completed 产物（无活跃会话时静默 no-op）
      useAgentStore.getState().appendWorkflowCompletion(latest.id, latest.title, payload.status ?? 'success')
      // 线③ 第 3 条：错误面统一——失败弹失败提示（此前无论成败都弹「✅ 完成」，误导用户）
      if (payload.status === 'failed') {
        toast.error(`「${shortTitle}」${t('agent.taskFailed')}`)
      } else {
        toast.workflowComplete(
          `「${shortTitle}」${t('agent.taskComplete')}`,
          () => useLayoutStore.getState().openRightPanel('ai-output')
        )
      }
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

  // 全局快捷键：命令面板优先，其后是工作台导航与原有缩放/项目操作。
  // F11 专注模式本身不带修饰键，须在 mod 判断之前拦截。
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName.toLowerCase()
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
    }
    const handleKeyDown = async (e: KeyboardEvent) => {
      const binding = (id: string) => shortcutBinding(id)
      if (matchesBinding(e, binding('focus-mode'))) {
        e.preventDefault()
        useLayoutStore.getState().toggleFocusMode()
        return
      }
      // 命令面板（所有工作台操作的键盘入口）
      if (matchesBinding(e, binding('command-palette'))) {
        e.preventDefault()
        useCommandStore.getState().togglePalette('commands')
        return
      }
      // 快捷键速查（输入框/正文内不抢字符）
      if (matchesBinding(e, binding('shortcuts-help')) && !isTypingTarget(e.target)) {
        e.preventDefault()
        useCommandStore.getState().openPalette('shortcuts')
        return
      }
      if (matchesBinding(e, binding('zoom-in'))) {
        e.preventDefault()
        useThemeStore.getState().zoomIn()
      } else if (matchesBinding(e, binding('zoom-out'))) {
        e.preventDefault()
        useThemeStore.getState().zoomOut()
      } else if (matchesBinding(e, binding('zoom-reset'))) {
        e.preventDefault()
        useThemeStore.getState().zoomReset()
      } else if (matchesBinding(e, binding('new-project'))) {
        e.preventDefault()
        useLayoutStore.getState().openNewProject()
      } else if (matchesBinding(e, binding('open-project'))) {
        e.preventDefault()
        const folder = await ipc.invoke('dialog:select-folder')
        if (folder) {
          useProjectStore.getState().openProject(folder)
        }
      } else if (matchesBinding(e, binding('toggle-sidebar'))) {
        e.preventDefault()
        useLayoutStore.getState().toggleSidebar()
      } else if (matchesBinding(e, binding('toggle-bottom'))) {
        e.preventDefault()
        useLayoutStore.getState().toggleBottomPanel()
      } else if (matchesBinding(e, binding('toggle-agent'))) {
        e.preventDefault()
        useLayoutStore.getState().toggleAIPanel()
      } else if (matchesBinding(e, binding('settings'))) {
        e.preventDefault()
        useLayoutStore.getState().openSettings()
      } else if (matchesBinding(e, binding('check-updates'))) {
        // 检查更新（原原生菜单 accelerator CmdOrCtrl+U，菜单已迁移至设置界面）
        e.preventDefault()
        useUpdateStore.getState().checkForUpdates()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WorkbenchHeader />
      {ipc.isElectron && <FileProjectEditorDialog showTrigger={false} />}

      {/* 全局 title 悬停提示代理 — 原生 title 属性 → 现代化 Tooltip UI */}
      <GlobalTitleTooltip />

      <WorkspaceLayout />

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
      {/* 开发者控制台（仅开发态/显式开启；内部有门禁） */}
      <ErrorBoundary fallbackLabel={t('error.dialogFailed')}>
        {DevConsoleDialog && <Suspense fallback={null}><DevConsoleDialog
          open={devConsoleOpen}
          onClose={closeDevConsole}
        /></Suspense>}
      </ErrorBoundary>
      {/* 全屏设置弹窗 — key 随开关变化重新挂载，保证每次打开回到默认分区 */}
      <ErrorBoundary fallbackLabel={t('error.dialogFailed')}>
        <SettingsModal
          key={String(settingsOpen)}
          open={settingsOpen}
          onClose={closeSettings}
        />
      </ErrorBoundary>

      {/* Cmd+K 命令面板 — 全局键盘入口，层级高于面板、低于确认框 */}
      <ErrorBoundary fallbackLabel={t('error.dialogFailed')}>
        <CommandPalette />
      </ErrorBoundary>

    </div>
  )
}
