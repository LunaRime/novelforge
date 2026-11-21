/* eslint-disable react-refresh/only-export-components */
/**
 * Sidebar — 左侧导航面板容器
 *
 * 纯路由容器，根据 sidebarView 切换子视图。
 * 所有子视图已拆分到 sidebar/ 子目录。
 */

import { useState, useEffect, useContext, useLayoutEffect, useRef } from 'react'
import { BookOpen, FolderOpen, Home, Settings, Users, X } from 'lucide-react'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { Button } from '../ui/Button'
import { ContextMenu } from '../ui/ContextMenu'
import { useTranslation } from '../../hooks/useTranslation'
import KnowledgePanel from './KnowledgePanel'
import HomeSidebarPanel from './sidebar/HomeSidebarPanel'
import ProjectTree from './sidebar/ProjectTree'
import CharactersView from './sidebar/CharactersView'
import { NavigationSessionContext } from './sidebar/navigation-session'
import {
  registerMenuSetter, unregisterMenuSetter,
  type SidebarMenuState,
} from './sidebar/SidebarShared'

/** 左侧面板 */
export default function Sidebar() {
  const { t } = useTranslation()
  const sidebarView = useLayoutStore(s => s.sidebarView)
  const hasProject = useProjectStore(s => Boolean(s.currentProject))
  const navigation = useContext(NavigationSessionContext)
  const scrollRef = useRef<HTMLDivElement>(null)
  const toggleSidebar = useLayoutStore(s => s.toggleSidebar)
  // 全局右键菜单状态
  const [sidebarMenu, setSidebarMenu] = useState<SidebarMenuState | null>(null)

  // 注册 / 注销右键菜单 setter
  useEffect(() => {
    registerMenuSetter(setSidebarMenu)
    return () => { unregisterMenuSetter() }
  }, [])

  useLayoutEffect(() => {
    const pane = scrollRef.current
    if (!pane || sidebarView !== 'project' || !navigation) return
    const target = navigation.readScrollTop()
    pane.scrollTop = target
    // 卷目录和草稿列表可能异步到达，等内容够长后恢复滚动位置。
    const tree = pane.firstElementChild
    if (!tree || pane.scrollTop >= target) return
    const observer = new ResizeObserver(() => {
      pane.scrollTop = target
      if (pane.scrollTop >= target) observer.disconnect()
    })
    observer.observe(tree)
    return () => observer.disconnect()
  }, [navigation, sidebarView])

  const views = {
    home:       [Home, t('nav.home')],
    project:    [FolderOpen, t('nav.projectTree')],
    knowledge:  [BookOpen, t('nav.knowledgeBase')],
    characters: [Users, t('nav.characters')],
    settings:   [Settings, t('settings.title')],
    } as const
  const [ViewIcon, viewTitle] = views[sidebarView] ?? views.home
  function closeSidebar() {
    toggleSidebar()
    document.querySelector<HTMLButtonElement>('[data-workbench-toggle="sidebar"]')?.focus()
  }
  const hasContentHeader = hasProject && (sidebarView === 'characters' || sidebarView === 'knowledge')
  const closeAction = (
    <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0"
      onClick={closeSidebar} title={t('tip.closePanel')} aria-label={t('tip.closePanel')}>
      <X size={15} aria-hidden="true" />
    </Button>
  )

  return (
    <div className="nf-sidebar">
      {!hasContentHeader && (
        <header className="nf-sidebar-heading">
          <ViewIcon size={16} aria-hidden="true" />
          <h2 className="min-w-0 flex-1 truncate" title={viewTitle}>{viewTitle}</h2>
          {closeAction}
        </header>
      )}
      <div ref={scrollRef} data-v3-density-list className={hasContentHeader ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 min-h-0 overflow-y-auto'} onScroll={event => {
        if (sidebarView === 'project') navigation?.saveScrollTop(event.currentTarget.scrollTop)
      }}>
        {sidebarView === 'home'       && <HomeSidebarPanel />}
        {sidebarView === 'project'    && <ProjectTree />}
        {sidebarView === 'knowledge'  && <KnowledgePanel headerAction={closeAction} />}
        {sidebarView === 'characters' && <CharactersView headerAction={closeAction} />}
      </div>

      {/* 动态右键菜单 */}
      {sidebarMenu && (
        <ContextMenu
          autoFocus={Boolean(sidebarMenu.anchor)}
          items={sidebarMenu.items}
          position={sidebarMenu.position}
          onClose={() => {
            setSidebarMenu(null)
            sidebarMenu.anchor?.focus()
          }}
        />
      )}
    </div>
  )
}

// 保持向后兼容的 re-export（外部引用了 chapterTitleCache）
export { chapterTitleCache, clearChapterTitleCache } from './sidebar/ManuscriptGroup'
