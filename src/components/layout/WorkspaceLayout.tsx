import { useLayoutEffect, useMemo, useRef } from 'react'
import { Group, Panel, Separator, useDefaultLayout, type Layout } from 'react-resizable-panels'
import { useShallow } from 'zustand/shallow'
import { useTranslation } from '../../hooks/useTranslation'
import { focusWorkbenchEditor } from '../../lib/workbench-focus'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { ErrorBoundary } from '../ErrorBoundary'
import WritingCompanion from '../panels/WritingCompanion'
import BottomPanel from '../panels/BottomPanel'
import EditorArea from '../panels/EditorArea'
import Sidebar from '../panels/Sidebar'
import { createNavigationSession, NavigationSessionContext } from '../panels/sidebar/navigation-session'
import LeftToolWindowBar from './LeftToolWindowBar'
import './workbench.css'

// 面板库将数字解释为 CSS 像素，默认比例使用带百分号的字符串。
const REGION_MIN_PX = { sidebar: 220, ai: 260, bottom: 120 } as const
const REGION_MAX_PX = { sidebar: 400, ai: 460 } as const
const SIDEBAR_DEFAULT = '19%'
const AI_PANEL_DEFAULT = '23%'
const EDITOR_DEFAULT = '58%'
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
  // 面板开合时可能短暂上报旧尺寸，只保存与当前可见面板完全匹配的布局。
  if (panelIds.length > 1 && Object.keys(layout).length === panelIds.length && panelIds.every(id => id in layout)) {
    save(layout)
  }
}

export default function WorkspaceLayout() {
  const { t } = useTranslation()
  const navigationScope = useProjectStore(state => state.currentProject
    ? `${state.currentProject.id}:${state.currentProject.path}:${state.projectSession}` : '')
  const navigation = useMemo(() => createNavigationSession(navigationScope), [navigationScope])
  const { sidebarOpen, aiPanelOpen, rightView, bottomPanelOpen, focusMode, openNewProject } = useLayoutStore(useShallow(state => ({
    sidebarOpen: state.sidebarOpen, aiPanelOpen: state.aiPanelOpen, rightView: state.rightView,
    bottomPanelOpen: state.bottomPanelOpen, focusMode: state.focusMode,
    openNewProject: state.openNewProject,
  })))
  const showSidebar = !focusMode && sidebarOpen
  const showAI = !focusMode && aiPanelOpen
  const showBottom = !focusMode && bottomPanelOpen
  const sidebarId = 'sidebar'
  const aiId = 'ai-panel'
  const bottomId = 'bottom'
  const horizontalIds = [...(showSidebar ? [sidebarId] : []), 'middle', ...(showAI ? [aiId] : [])]
  const verticalIds = showBottom ? ['editor', bottomId] : ['editor']

  const horizontalLayout = useDefaultLayout({ id: 'novelforge-main-horizontal', storage: localStorage })
  const verticalLayout = useDefaultLayout({ id: 'novelforge-middle-vertical', storage: localStorage })
  const lastFocused = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    // 只接管因区域卸载而丢失的焦点，编辑器或弹窗仍有焦点时保持原位。
    if (lastFocused.current && !lastFocused.current.isConnected && document.activeElement === document.body) {
      focusWorkbenchEditor()
      lastFocused.current = null
    }
  }, [focusMode, showSidebar, showAI, showBottom, rightView])

  return (
    <>
      <a
        href="#main-editor-area"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-(--z-sticky) focus:px-4 focus:py-2 focus:bg-[var(--color-accent)] focus:text-white focus:rounded"
      >
        {t('tip.skipToContent')}
      </a>
      <div data-workbench data-focus-mode={focusMode || undefined} className="nf-workbench flex flex-1 min-h-0 overflow-hidden"
        onFocusCapture={event => { lastFocused.current = event.target }}>
        {!focusMode && <LeftToolWindowBar />}
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
                  <main id="main-editor-area" tabIndex={-1} data-region="editor" className="h-full">
                    <ErrorBoundary fallbackLabel={t('error.editorFailed')}>
                      <EditorArea onNewProject={openNewProject} />
                    </ErrorBoundary>
                  </main>
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
                      <WritingCompanion />
                    </ErrorBoundary>
                  </div>
                </Panel>
              </>
            )}
          </Group>
        </div>
      </div>
    </>
  )
}
