import { Activity, BookOpen, FolderOpen, Home, Settings, Users, Zap } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useTranslation } from '../../hooks/useTranslation'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { Button } from '../ui/Button'
import ProjectSquareList from './ProjectSquareList'

export default function LeftToolWindowBar() {
  const { t } = useTranslation()
  const { activeView, sidebarOpen, bottomPanelOpen, bottomTab, settingsOpen, activityDialogOpen } = useLayoutStore(useShallow(state => ({
    activeView: state.sidebarView, sidebarOpen: state.sidebarOpen,
    settingsOpen: state.settingsOpen, activityDialogOpen: state.activityDialogOpen,
    bottomPanelOpen: state.bottomPanelOpen, bottomTab: state.bottomTab,
  })))
  const hasOtherProjects = useProjectStore(state => state.recentProjects.some(project => project.path !== state.currentProject?.path))
  const layout = useLayoutStore.getState()
  const views = [
    ['home', Home, t('panel.welcome')],
    ['project', FolderOpen, t('nav.projectTree')],
    ['knowledge', BookOpen, t('nav.knowledgeBase')],
    ['characters', Users, t('nav.characters')],
  ] as const

  return (
    <div data-activity-bar="left" className="nf-activity-rail">
      <nav aria-label={t('panel.sidebar')} className="nf-activity-group">
        {views.map(([view, Icon, label]) => {
          const active = sidebarOpen && activeView === view
          return (
            <Button key={view} type="button" variant="ghost" size="icon" className="nf-activity-button"
              active={active} aria-expanded={active} aria-label={label} data-tooltip={label} data-tooltip-side="right"
              onClick={() => layout.setSidebarView(view)}>
              <Icon size={17} aria-hidden="true" />
            </Button>
          )
        })}
      </nav>
      {/* 主页侧栏显示完整最近项目列表，其他视图才用轨道里的快速切换入口。 */}
      {hasOtherProjects && !(activeView === 'home' && sidebarOpen) && (
        <div className="nf-activity-projects">
          <ProjectSquareList />
        </div>
      )}
      <div className="nf-activity-group nf-activity-tools">
        {/* 在日志或收件箱中点任务时先切回任务页，任务页已展开时再收起抽屉。 */}
        <Button type="button" variant="ghost" size="icon" className="nf-activity-button" data-workbench-toggle="runtime"
          aria-expanded={bottomPanelOpen} aria-label={t('panel.tasks')} data-tooltip={t('panel.tasks')} data-tooltip-side="right"
          onClick={() => bottomPanelOpen && bottomTab === 'tasks' ? layout.toggleBottomPanel() : layout.openBottomTab('tasks')}>
          <Zap size={17} aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="nf-activity-button" aria-pressed={activityDialogOpen}
          data-tooltip={t('panel.activityShort')} data-tooltip-side="right" aria-label={t('panel.activityShort')} onClick={layout.openActivityDialog}>
          <Activity size={17} aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="nf-activity-button" aria-pressed={settingsOpen}
          data-tooltip={t('settings.title')} data-tooltip-side="right" aria-label={t('settings.title')} onClick={() => layout.openSettings()}>
          <Settings size={17} aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
