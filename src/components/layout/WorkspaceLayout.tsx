import { useLayoutEffect, useMemo, useRef } from 'react'
import { Group, Panel, Separator, useDefaultLayout, type Layout } from 'react-resizable-panels'
import { useShallow } from 'zustand/shallow'
import { useTranslation } from '../../hooks/useTranslation'
import { focusActiveWorkbenchMode } from '../../lib/workbench-focus'
import { selectWorkbenchPanels, useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { ErrorBoundary } from '../ErrorBoundary'
import AIPanel from '../panels/AIPanel'
import AIOutputPanel from '../panels/AIOutputPanel'
import BottomPanel from '../panels/BottomPanel'
import EditorArea from '../panels/EditorArea'
import Sidebar from '../panels/Sidebar'
import { createNavigationSession, NavigationSessionContext } from '../panels/sidebar/navigation-session'
import LeftToolWindowBar from './LeftToolWindowBar'
import RightToolWindowBar from './RightToolWindowBar'

// 面板库将数字解释为 CSS 像素，默认比例使用带百分号的字符串。
const REGION_MIN_PX = { sidebar: 220, ai: 260, bottom: 120 } as const
const REGION_MAX_PX = { sidebar: 400, ai: 460 } as const
const SIDEBAR_DEFAULT = '22%'
const AI_PANEL_DEFAULT = '22%'
const EDITOR_DEFAULT = '56%'
const EDITOR_MIN_PX = 360

function closeIfAtFloor(region: keyof typeof REGION_MIN_PX): void {
  const element = document.querySelector(`[data-region="${region}"]`)
  if (!(element instanceof HTMLElement)) return

  // 等拖拽松手后再卸载面板，防止拖拽中的布局与已注册面板不一致。
  const rect = element.getBoundingClientRect()
  const size = region === 'bottom' ? rect.height : rect.width
  if (size > 0 && size <= REGION_MIN_PX[region] + 1) {
    useLayoutStore.getState().closeRegion(region)
  }
}

function saveVisibleLayout(layout: Layout, panelIds: string[], save: (layout: Layout) => void) {
  // 切换或专注时会短暂报告旧布局或单面板布局，避免它们覆盖当前模式的尺寸。
  if (panelIds.length > 1 && Object.keys(layout).length === panelIds.length && panelIds.every(id => id in layout)) {
    save(layout)
  }
}

export default function WorkspaceLayout() {
  const { t } = useTranslation()
  const navigationScope = useProjectStore(state => state.currentProject
    ? `${state.currentProject.id}:${state.currentProject.path}:${state.projectSession}` : '')
  const navigation = useMemo(() => createNavigationSession(navigationScope), [navigationScope])
  const { sidebarOpen, aiPanelOpen, rightView, bottomPanelOpen } = useLayoutStore(useShallow(state => {
    const panels = selectWorkbenchPanels(state)
    return {
      sidebarOpen: panels.sidebarOpen, aiPanelOpen: panels.aiPanelOpen, rightView: panels.rightView,
      bottomPanelOpen: panels.bottomPanelOpen,
    }
  }))
  const { focusMode, workbenchMode, openNewProject } = useLayoutStore(useShallow(state => ({
    focusMode: state.focusMode, workbenchMode: state.workbenchMode,
    openNewProject: state.openNewProject,
  })))
  const writing = workbenchMode === 'write'
  const showSidebar = !focusMode && sidebarOpen
  const showAI = !focusMode && aiPanelOpen
  const showBottom = !focusMode && bottomPanelOpen
  const sidebarId = writing ? 'writing-sidebar' : 'sidebar'
  const aiId = writing ? 'writing-ai-panel' : 'ai-panel'
  const bottomId = writing ? 'writing-bottom' : 'bottom'
  const horizontalIds = [...(showSidebar ? [sidebarId] : []), 'middle', ...(showAI ? [aiId] : [])]
  const verticalIds = showBottom ? ['editor', bottomId] : ['editor']

  // 构建态沿用旧存储键。写作态独立保存尺寸，编辑区与两层 Group 始终挂载。
  const horizontalLayout = useDefaultLayout({ id: writing ? 'novelforge-writing-horizontal' : 'novelforge-main-horizontal', storage: localStorage })
  const verticalLayout = useDefaultLayout({ id: writing ? 'novelforge-writing-vertical' : 'novelforge-middle-vertical', storage: localStorage })
  const lastFocused = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    // 只接管因区域卸载而丢失的焦点，编辑器或弹窗仍有焦点时保持原位。
    if (lastFocused.current && !lastFocused.current.isConnected && document.activeElement === document.body) {
      focusActiveWorkbenchMode()
      lastFocused.current = null
    }
  }, [focusMode, workbenchMode, showSidebar, showAI, showBottom, rightView])

  return (
    <>
      <a
        href="#main-editor-area"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--color-accent)] focus:text-white focus:rounded"
      >
        {t('tip.skipToContent')}
      </a>
      <div data-workbench-mode={workbenchMode} className="flex flex-1 min-h-0 overflow-hidden" style={{ backgroundColor: 'var(--color-canvas)', padding: 3 }}
        onFocusCapture={event => { lastFocused.current = event.target }}>
        {!writing && !focusMode && <LeftToolWindowBar />}
        <div data-canvas="true" className="flex-1 min-w-0 flex overflow-hidden">
          <Group
            orientation="horizontal"
            className="flex-1"
            defaultLayout={horizontalLayout.defaultLayout}
            onLayoutChanged={layout => saveVisibleLayout(layout, horizontalIds, horizontalLayout.onLayoutChanged)}
          >
            {showSidebar && (
              <>
                <Panel
                  id={sidebarId}
                  defaultSize={SIDEBAR_DEFAULT}
                  minSize={REGION_MIN_PX.sidebar}
                  maxSize={REGION_MAX_PX.sidebar}
                  aria-label={t('panel.sidebar')}
                >
                  <div data-region="sidebar" className="h-full">
                    <ErrorBoundary fallbackLabel={t('error.sidebarFailed')}>
                      <NavigationSessionContext.Provider value={navigation}>
                        <Sidebar key={navigation.scope} />
                      </NavigationSessionContext.Provider>
                    </ErrorBoundary>
                  </div>
                </Panel>
                <Separator onPointerUp={() => closeIfAtFloor('sidebar')} />
              </>
            )}

            {/* 底栏只占编辑区下方。侧栏与 Agent 面板各自贯穿工作区高度。 */}
            <Panel id="middle" defaultSize={EDITOR_DEFAULT} minSize={EDITOR_MIN_PX}>
              <Group
                orientation="vertical"
                className="h-full"
                defaultLayout={verticalLayout.defaultLayout}
                onLayoutChanged={layout => saveVisibleLayout(layout, verticalIds, verticalLayout.onLayoutChanged)}
              >
                {/* 专注模式仅改变外层布局，正文编辑区始终在同一位置挂载。 */}
                <Panel id="editor" defaultSize="75%" minSize="25%" aria-label={t('panel.editor')}>
                  <div id="main-editor-area" />
                  <div data-region="editor" className={focusMode ? 'max-w-[720px] mx-auto h-full text-[18px]' : 'h-full'}>
                    <ErrorBoundary fallbackLabel={t('error.editorFailed')}>
                      <EditorArea onNewProject={openNewProject} />
                    </ErrorBoundary>
                  </div>
                </Panel>

                {showBottom && <Separator onPointerUp={() => closeIfAtFloor('bottom')} />}
                {showBottom && (
                  <Panel
                    id={bottomId}
                    defaultSize="25%"
                    minSize={REGION_MIN_PX.bottom}
                    maxSize="55%"
                    aria-label={t('panel.bottom')}
                  >
                    <div data-region="bottom" className="h-full">
                      <ErrorBoundary fallbackLabel={t('error.taskPanelFailed')}>
                        <BottomPanel />
                      </ErrorBoundary>
                    </div>
                  </Panel>
                )}
              </Group>
            </Panel>

            {showAI && (
              <>
                <Separator onPointerUp={() => closeIfAtFloor('ai')} />
                <Panel
                  id={aiId}
                  defaultSize={AI_PANEL_DEFAULT}
                  minSize={REGION_MIN_PX.ai}
                  maxSize={REGION_MAX_PX.ai}
                  aria-label={t('panel.ai')}
                >
                  <div data-region="ai" className="h-full">
                    <ErrorBoundary fallbackLabel={t('error.aiPanelFailed')}>
                      {rightView === 'ai-output' ? <AIOutputPanel /> : <AIPanel />}
                    </ErrorBoundary>
                  </div>
                </Panel>
              </>
            )}
          </Group>
        </div>
        {!writing && !focusMode && <RightToolWindowBar />}
      </div>
    </>
  )
}
