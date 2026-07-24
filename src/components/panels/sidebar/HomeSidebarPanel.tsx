/**
 * HomeSidebarPanel — 主页侧边栏：项目管理入口 + 最近项目列表
 */

import { FolderOpen, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { ipc } from '../../../services/ipc-client'
import { Button } from '../../ui/Button'
import { useTranslation } from '../../../hooks/useTranslation'
import { confirmDeleteProject } from '../../ui/Confirm'

export default function HomeSidebarPanel() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const recentProjects = useProjectStore(s => s.recentProjects)
  const openProject = useProjectStore(s => s.openProject)
  const deleteProjectFolder = useProjectStore(s => s.deleteProjectFolder)
  const removeRecentProject = useProjectStore(s => s.removeRecentProject)

  const handleDelete = async (e: React.MouseEvent, projectPath: string) => {
    e.stopPropagation()
    const action = await confirmDeleteProject()
    if (action === 'delete') await deleteProjectFolder(projectPath)
    else if (action === 'remove') await removeRecentProject(projectPath)
  }

  return (
    <div className="px-3 py-2 text-sm">
      {/* 当前项目信息 */}
      {currentProject && (
        <div
          className="mb-3 px-3 py-2.5 rounded-lg"
          style={{ backgroundColor: 'var(--color-hover)' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="flex-shrink-0 w-2 h-2 rounded-full"
              style={{ backgroundColor: 'var(--color-accent)' }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                {currentProject.name}
              </p>
              <p className="text-[0.7rem] truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {t('project.current')}</p>
            </div>
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex flex-col gap-1.5 mb-3">
        <Button
          variant="default"
          className="w-full"
          onClick={() => useLayoutStore.getState().openNewProject()}
        >
          {t('dialog.newProject')}</Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={async () => {
            const folder = await ipc.invoke('dialog:select-folder')
            if (folder) {
              openProject(folder)
            }
          }}
        >
          {t('action.openProject')}</Button>
      </div>

      {/* 最近项目列表 */}
      {recentProjects.length > 0 && (
        <div>
          <div
            className="flex items-center gap-1.5 mb-2 pt-2"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {t('project.recent')}</span>
          </div>
          <div className="space-y-0.5">
            {recentProjects
              .filter(p => p.path !== currentProject?.path)
              .slice(0, 10)
              .map((p, i) => (
                <div
                  key={i}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors"
                  style={{ backgroundColor: 'transparent' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-hover)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  onClick={() => openProject(p.path)}
                >
                  <FolderOpen size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate" style={{ color: 'var(--color-text)' }}>
                      {p.name}
                    </p>
                    <p className="text-[0.65rem] truncate" style={{ color: 'var(--color-text-muted)' }}>
                      {p.path}
                    </p>
                  </div>
                  <button
                    className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
                    style={{ color: 'var(--color-text-muted)' }}
                    onClick={(e) => handleDelete(e, p.path)}
                    title={t('project.deleteTooltip')}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-muted)'}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            {recentProjects.filter(p => p.path !== currentProject?.path).length === 0 && (
              <p className="text-xs px-2 py-1 opacity-50" style={{ color: 'var(--color-text-muted)' }}>
                {t('project.noRecent')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
