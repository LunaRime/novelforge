import {
  FolderOpen, BookOpen, Users,
  Home, Zap, ScrollText, Activity, Settings,
} from 'lucide-react'
import { useLayoutStore, type SidebarView, type BottomTab } from '../../stores/layout-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useEditorStore } from '../../stores/editor-store'
import { useTranslation } from '../../hooks/useTranslation'
import ProjectSquareList from './ProjectSquareList'

/**
 * 左侧工具窗口栏（LeftToolWindowBar）
 * JetBrains 风格：44px 宽，全高，竖排
 * 顶部：Home + 视图图标（角色管理为最后一个）；
 * 中部：项目方块列表（紧挨角色管理，上下边界清晰）；底部：面板 Tab
 */
/** macOS 检测：标题栏移除后，交通灯按钮会浮在左上角，需给图标栏顶部留位（否则图标被遮） */
const isMac = navigator.userAgent.includes('Mac')

export default function LeftToolWindowBar() {
  const { t } = useTranslation()
  /** 左侧侧边栏视图按钮配置（不含 Home，它单独渲染）— 组件内求值，语言切换后悬停提示跟随更新 */
  const sidebarActivities: Array<{ id: SidebarView; icon: typeof FolderOpen; label: string }> = [
    { id: 'project', icon: FolderOpen, label: t('nav.projectTree') },
    { id: 'knowledge', icon: BookOpen, label: t('nav.knowledgeBase') },
    { id: 'characters', icon: Users, label: t('nav.characters') },
  ]

  /** 底部面板 Tab 按钮配置（写作统计已于 2026-09-22 搬去编辑区页面，不再是底栏 tab） */
  const bottomTabs: Array<{ id: BottomTab; icon: typeof Zap; label: string }> = [
    { id: 'tasks', icon: Zap, label: t('panel.tasks') },
    { id: 'log', icon: ScrollText, label: t('panel.log') },
  ]
  const sidebarView = useLayoutStore(s => s.sidebarView)
  const sidebarOpen = useLayoutStore(s => s.sidebarOpen)
  const setSidebarView = useLayoutStore(s => s.setSidebarView)
  const bottomTab = useLayoutStore(s => s.bottomTab)
  const bottomPanelOpen = useLayoutStore(s => s.bottomPanelOpen)
  const setBottomTab = useLayoutStore(s => s.setBottomTab)
  const currentRun = useWorkflowStore(s => s.currentRun)

  /** 写作统计页是否已在编辑区打开（按钮激活态） */
  const activityPageOpen = useEditorStore(s => s.tabs.some(tab => tab.type === 'activity'))

  const openSettings = useLayoutStore(s => s.openSettings)

  /** 打开「写作统计」编辑区页面（2026-09-22 从底栏 tab 搬出：
      它是结果型看板，与「任务/日志」那种运行态信息不同类，且需要编辑区的宽度才展得开） */
  const openActivityPage = () => {
    useEditorStore.getState().openFile({
      id: 'activity-page',
      name: t('panel.activityShort'),
      type: 'activity',
    })
  }

  /** Home 按钮是否激活 */
  const homeActive = sidebarOpen && sidebarView === 'home'

  return (
    <div
      className="no-select flex flex-col h-full"
      style={{
        width: 'var(--width-left-bar)',
        backgroundColor: 'var(--color-activity-bar)',
        // 与侧栏面板绑定成一张卡片：左两角圆角 + 朝窗口一侧的细边框；
        // 右边缘**不画线**——它与侧栏无缝相接，画了会变成卡片中间的一道隔断。
        borderTopLeftRadius: 6,
        borderBottomLeftRadius: 6,
        border: '1px solid var(--color-border)',
        borderRight: 'none',
        flexShrink: 0,
        // 拖拽区之一（标题栏已移除）：整条栏可拖动窗口，栏内按钮由 index.css 的
        // [data-activity-bar] 规则统一恢复 no-drag。macOS 顶部给交通灯留位。
        WebkitAppRegion: 'drag',
        paddingTop: isMac ? 28 : undefined,
      } as React.CSSProperties}
      data-activity-bar="left"
    >
      {/* ===== 顶部：Home + 侧边栏视图切换（竖排） ===== */}
      <div className="flex flex-col items-center w-full pt-0.5">
        {/* Home 按钮 — 点击切换到主页视图 */}
        <button
          onClick={() => setSidebarView('home')}
          title={t('panel.welcome')}
          className="tool-btn"
          style={{
            boxShadow: homeActive ? 'inset 2px 0 0 var(--color-activity-indicator)' : 'none',
            color: homeActive ? 'var(--color-activity-icon-active)' : undefined,
          }}
        >
          <Home size={16} strokeWidth={homeActive ? 2 : 1.5} />
        </button>

        {/* 分割线 */}
        <div className="w-4 my-0.5" style={{ height: 1, backgroundColor: 'var(--color-border)' }} />

        {/* 侧边栏视图按钮（角色管理为最后一个） */}
        {sidebarActivities.map(({ id, icon: Icon, label }) => {
          const isActive = sidebarOpen && sidebarView === id
          return (
            <button
              key={id}
              onClick={() => setSidebarView(id)}
              title={label}
              className="tool-btn"
              style={{
                boxShadow: isActive ? 'inset 2px 0 0 var(--color-activity-indicator)' : 'none',
                color: isActive ? 'var(--color-activity-icon-active)' : 'var(--color-activity-icon)',
              }}
            >
              <Icon size={17} strokeWidth={isActive ? 2 : 1.5} />
            </button>
          )
        })}
      </div>

      {/* ===== 中部：项目方块列表 — 紧挨角色管理（视图图标之后），完整边框界限 ===== */}
      <div
        className="flex flex-col items-center w-full px-1 py-1.5"
        style={{ backgroundColor: 'color-mix(in srgb, var(--color-hover) 30%, transparent)' }}
      >
        <div
          className="w-full border rounded-lg overflow-hidden"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <ProjectSquareList />
        </div>
      </div>

      {/* 弹性间隔 */}
      <div className="flex-1" />

      {/* ===== 底部：底部面板 Tab 控制（竖排） ===== */}
      <div className="flex flex-col items-center w-full pb-1">
        <div className="w-4 mb-0.5" style={{ height: 1, backgroundColor: 'var(--color-border)' }} />

        {bottomTabs.map(({ id, icon: Icon, label }) => {
          const isActive = bottomPanelOpen && bottomTab === id
          const showPulse = id === 'tasks' && currentRun &&
            (currentRun.status === 'running' || currentRun.status === 'waiting')

          return (
            <div key={id} className="relative w-full">
              <button
                onClick={() => setBottomTab(id)}
                title={label}
                className="tool-btn"
                style={{
                  boxShadow: isActive ? 'inset 2px 0 0 var(--color-activity-indicator)' : 'none',
                  color: isActive ? 'var(--color-activity-icon-active)' : 'var(--color-activity-icon)',
                }}
              >
                <Icon size={15} strokeWidth={isActive ? 2 : 1.5} />
              </button>
              {showPulse && (
                <span
                  className="absolute top-[4px] right-[4px] w-[5px] h-[5px] rounded-full animate-pulse pointer-events-none"
                  style={{
                    backgroundColor: currentRun.status === 'waiting'
                      ? 'var(--color-warning)'
                      : 'var(--color-accent)',
                  }}
                />
              )}
            </div>
          )
        })}

        {/* 写作统计 — 打开**编辑区页面**（不是底栏 tab）：点一次打开/激活，已打开时保持高亮 */}
        <div className="relative w-full">
          <button
            onClick={openActivityPage}
            title={t('panel.activityShort')}
            className="tool-btn"
            style={{
              boxShadow: activityPageOpen ? 'inset 2px 0 0 var(--color-activity-indicator)' : 'none',
              color: activityPageOpen ? 'var(--color-activity-icon-active)' : 'var(--color-activity-icon)',
            }}
          >
            <Activity size={15} strokeWidth={activityPageOpen ? 2 : 1.5} />
          </button>
        </div>

        {/* 设置 — 图标入口，放在整栏**最下面**（2026-09-22 从状态栏迁移：
            原先状态栏是中文文字「设置」，非中文使用者认不出；齿轮图标才是通用语言） */}
        <div className="relative w-full">
          <button
            onClick={() => openSettings()}
            title={t('settings.title')}
            className="tool-btn"
            style={{ color: 'var(--color-activity-icon)' }}
          >
            <Settings size={15} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  )
}
