import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { useShallow } from 'zustand/shallow'
import { useTranslation } from '../../hooks/useTranslation'
import { useLayoutStore } from '../../stores/layout-store'
import { ErrorBoundary } from '../ErrorBoundary'
import AIPanel from '../panels/AIPanel'
import AIOutputPanel from '../panels/AIOutputPanel'
import BottomPanel from '../panels/BottomPanel'
import EditorArea from '../panels/EditorArea'
import Sidebar from '../panels/Sidebar'
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

export default function WorkspaceLayout() {
  const { t } = useTranslation()
  const { sidebarOpen, aiPanelOpen, rightView, bottomPanelOpen, focusMode, openNewProject } = useLayoutStore(useShallow(state => ({
    sidebarOpen: state.sidebarOpen,
    aiPanelOpen: state.aiPanelOpen,
    rightView: state.rightView,
    bottomPanelOpen: state.bottomPanelOpen,
    focusMode: state.focusMode,
    openNewProject: state.openNewProject,
  })))

  // 保留两组尺寸存储键与面板 ID，重启时可继续读取已有布局偏好。
  const horizontalLayout = useDefaultLayout({ id: 'novelforge-main-horizontal', storage: localStorage })
  const verticalLayout = useDefaultLayout({ id: 'novelforge-middle-vertical', storage: localStorage })

  return (
    <>
      <a
        href="#main-editor-area"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--color-accent)] focus:text-white focus:rounded"
      >
        {t('tip.skipToContent')}
      </a>
      <div className="flex flex-1 overflow-hidden" style={{ backgroundColor: 'var(--color-canvas)', padding: 3 }}>
        {!focusMode && <LeftToolWindowBar />}
        <div data-canvas="true" className="flex-1 min-w-0 flex overflow-hidden">
          <Group
            orientation="horizontal"
            className="flex-1"
            defaultLayout={horizontalLayout.defaultLayout}
            onLayoutChanged={horizontalLayout.onLayoutChanged}
          >
            {sidebarOpen && !focusMode && (
              <>
                <Panel
                  id="sidebar"
                  defaultSize={SIDEBAR_DEFAULT}
                  minSize={REGION_MIN_PX.sidebar}
                  maxSize={REGION_MAX_PX.sidebar}
                  aria-label={t('panel.sidebar')}
                >
                  <div data-region="sidebar" className="h-full">
                    <ErrorBoundary fallbackLabel={t('error.sidebarFailed')}>
                      <Sidebar />
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
                onLayoutChanged={verticalLayout.onLayoutChanged}
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

                {bottomPanelOpen && !focusMode && <Separator onPointerUp={() => closeIfAtFloor('bottom')} />}
                {bottomPanelOpen && !focusMode && (
                  <Panel
                    id="bottom"
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

            {aiPanelOpen && !focusMode && (
              <>
                <Separator onPointerUp={() => closeIfAtFloor('ai')} />
                <Panel
                  id="ai-panel"
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
        {!focusMode && <RightToolWindowBar />}
      </div>
    </>
  )
}
