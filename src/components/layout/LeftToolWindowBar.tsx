import { Activity, BookOpen, FolderOpen, Home, Settings, Users } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useTranslation } from '../../hooks/useTranslation'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { Button } from '../ui/Button'
import ProjectSquareList from './ProjectSquareList'

export default function LeftToolWindowBar() {
  const { t } = useTranslation()
  const { activeView, sidebarOpen, settingsOpen, activityDialogOpen } = useLayoutStore(useShallow(state => ({
    activeView: state.sidebarView, sidebarOpen: state.sidebarOpen,
    settingsOpen: state.settingsOpen, activityDialogOpen: state.activityDialogOpen,
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
              active={active} aria-expanded={active} aria-label={label} title={label}
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
        <Button type="button" variant="ghost" size="icon" className="nf-activity-button" active={activityDialogOpen}
          title={t('panel.activityShort')} aria-label={t('panel.activityShort')} onClick={layout.openActivityDialog}>
          <Activity size={17} aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="nf-activity-button" active={settingsOpen}
          title={t('settings.title')} aria-label={t('settings.title')} onClick={() => layout.openSettings()}>
          <Settings size={17} aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
