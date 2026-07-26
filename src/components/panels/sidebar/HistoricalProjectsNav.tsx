/**
 * HistoricalProjectsNav — 历史项目快速导航（嵌入角色管理视图底部）
 *
 * 展示最近打开项目的章节/草稿/蓝图摘要，可展开预览。
 * 点击项目名或条目 → 打开项目 + 切换到对应视图。
 */
import { useState, useCallback } from 'react'
import {
  FolderOpen, ChevronRight, ChevronDown, FileText,
  PenTool, LayoutList, CheckCircle2, Circle, BookOpen,
} from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { ipc } from '../../../services/ipc-client'
import type { ProjectSummary } from '../../../shared/ipc-channels'
import { cn } from '../../../lib/utils'
import { useTranslation } from '../../../hooks/useTranslation'

// ===== 类型 =====

interface LoadedProject extends ProjectSummary {
  expanded: boolean
  loading: boolean
  loaded: boolean
  error: boolean
}

// ===== 组件 =====

export default function HistoricalProjectsNav() {
  const { t } = useTranslation()
  const recentProjects = useProjectStore(s => s.recentProjects)
  const currentProject = useProjectStore(s => s.currentProject)
  const openProject = useProjectStore(s => s.openProject)
  // 展开的项目 path → LoadedProject
  const [loadedMap, setLoadedMap] = useState<Record<string, LoadedProject>>({})

  // 过滤：排除当前项目 + 最多展示 5 个
  const targets = recentProjects
    .filter(p => p.path !== currentProject?.path)
    .slice(0, 5)

  // 加载项目摘要
  const loadSummary = useCallback(async (projectPath: string) => {
    if (loadedMap[projectPath]?.loaded || loadedMap[projectPath]?.loading) return

    setLoadedMap(prev => ({
      ...prev,
      [projectPath]: { ...prev[projectPath], loading: true, loaded: false, error: false }
    }))

    const summary = await ipc.invoke('project:get-summary', projectPath)

    setLoadedMap(prev => ({
      ...prev,
      [projectPath]: {
        ...(summary || { name: '', path: projectPath, totalChapters: 0, chapters: [], draftChapters: [], blueprintCount: 0 }),
        expanded: true,
        loading: false,
        loaded: true,
        error: !summary,
      } as LoadedProject,
    }))
  }, [loadedMap])

  // 点击项目名：toggle 展开/折叠
  const toggleExpand = (projectPath: string) => {
    const current = loadedMap[projectPath]
    if (current?.loaded) {
      setLoadedMap(prev => ({
        ...prev,
        [projectPath]: { ...current, expanded: !current.expanded },
      }))
    } else {
      loadSummary(projectPath)
    }
  }

  // 点击打开项目
  const handleOpenProject = async (projectPath: string) => {
    await openProject(projectPath)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 项目列表 */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {targets.length === 0 ? (
          <div className="text-center py-8 text-xs opacity-40" style={{ color: 'var(--color-text-muted)' }}>
            {t('charList.noHistory')}
          </div>
        ) : null}
        {targets.map(p => {
          const loaded = loadedMap[p.path]
          const isExpanded = loaded?.expanded ?? false
          const bpc = loaded?.loaded ? loaded.blueprintCount : null
          const chCount = loaded?.loaded ? loaded.chapters.length : null
          const drCount = loaded?.loaded
            ? loaded.draftChapters.reduce((s, d) => s + d.draftCount, 0)
            : null

          return (
            <div key={p.path}>
              {/* 项目名行 */}
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors hover:bg-[var(--color-hover)] text-xs"
                onClick={() => toggleExpand(p.path)}
                title={t('charList.clickToToggle')}
              >
                {loaded?.loading ? (
                  <span className="w-3 h-3 flex-shrink-0 animate-spin opacity-40">⟳</span>
                ) : isExpanded ? (
                  <ChevronDown size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                ) : (
                  <ChevronRight size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                )}
                <FolderOpen size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                <span className="flex-1 truncate font-medium" style={{ color: 'var(--color-text)' }}>
                  {p.name}
                </span>
                {/* 摘要 badge */}
                {loaded?.loaded && !isExpanded && (
                  <span className="text-[0.6rem] flex-shrink-0 opacity-50" style={{ color: 'var(--color-text-muted)' }}>
                    {bpc !== null && chCount !== null
                      ? `${bpc}/${loaded.totalChapters}B · ${chCount}C · ${drCount}D`
                      : ''}
                  </span>
                )}
                {loaded?.error && (
                  <span className="text-[0.6rem] flex-shrink-0" style={{ color: 'var(--color-error)' }}>
                    {t('charList.loadFailed')}
                  </span>
                )}
                {/* 打开项目按钮 */}
                <button
                  className="flex-shrink-0 p-0.5 rounded opacity-30 hover:opacity-100 transition-opacity cursor-pointer"
                  style={{ color: 'var(--color-accent)' }}
                  onClick={(e) => { e.stopPropagation(); handleOpenProject(p.path) }}
                  title={t('charList.openProject')}
                  type="button"
                >
                  <FolderOpen size={12} />
                </button>
              </div>

              {/* 展开的详细内容 */}
              {isExpanded && loaded?.loaded && !loaded.error && (
                <div className="pl-5 pr-1 pb-1">
                  {/* 章节蓝图 — 独立 UI 块 */}
                  <ExpandSection
                    icon={<LayoutList size={10} />}
                    label={t('mention.blueprint')}
                    badge={loaded.blueprintCount > 0
                      ? `${loaded.blueprintCount}/${loaded.totalChapters}`
                      : t('status.pendingGen')}
                    badgeDone={loaded.blueprintCount >= loaded.totalChapters}
                  />

                  {/* 已定稿正文章节 */}
                  {loaded.chapters.length > 0 && (
                    <ExpandSection
                      icon={<PenTool size={10} />}
                      label={t('charList.completedChapters')}
                      badge={String(loaded.chapters.length)}
                    >
                      {loaded.chapters.map(ch => (
                        <div
                          key={ch.chapterNumber}
                          className="flex items-center gap-1 py-0.5 text-[0.7rem] cursor-pointer hover:bg-[var(--color-hover)] rounded px-1"
                          style={{ color: 'var(--color-text-secondary)' }}
                          onClick={() => handleOpenProject(p.path)}
                          title={t('charList.clickToOpen')}
                        >
                          <CheckCircle2 size={8} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                          <span className="truncate">
                            {t('chapter.label').replace('{n}', String(ch.chapterNumber))}
                            {ch.title ? ` ${ch.title}` : ''}
                          </span>
                        </div>
                      ))}
                    </ExpandSection>
                  )}

                  {/* 草稿 */}
                  {loaded.draftChapters.length > 0 && (
                    <ExpandSection
                      icon={<FileText size={10} />}
                      label={t('draftbox.title')}
                      badge={String(drCount)}
                    >
                      {loaded.draftChapters.map(dc => (
                        <div
                          key={dc.chapterNumber}
                          className="flex items-center gap-1 py-0.5 text-[0.7rem] cursor-pointer hover:bg-[var(--color-hover)] rounded px-1"
                          style={{ color: 'var(--color-text-secondary)' }}
                          onClick={() => handleOpenProject(p.path)}
                          title={t('charList.clickToOpen')}
                        >
                          {dc.hasFinalized
                            ? <CheckCircle2 size={8} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                            : <Circle size={6} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />}
                          <span className="truncate">
                            {dc.chapterTitle || t('chapter.label').replace('{n}', String(dc.chapterNumber))}
                          </span>
                          <span className="ml-auto text-[0.6rem] opacity-50 flex-shrink-0">
                            {dc.draftCount} {t('draftbox.label').replace('{version}', '')}
                          </span>
                        </div>
                      ))}
                    </ExpandSection>
                  )}

                  {/* 更多 — 故事架构等，默认折叠 */}
                  <ExpandSection
                    icon={<BookOpen size={10} />}
                    label={t('charList.storyArch')}
                    badge={`${loaded.archGenerated}/4`}
                    badgeDone={loaded.archGenerated >= 4}
                    defaultOpen={false}
                  />

                  {/* 空项目提示 */}
                  {loaded.chapters.length === 0 && loaded.draftChapters.length === 0 && (
                    <div className="text-[0.65rem] py-1 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
                      {t('charList.emptyProject')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ===== 可折叠分组 =====

function ExpandSection({
  icon, label, badge, badgeDone, children, defaultOpen = true,
}: {
  icon: React.ReactNode
  label: string
  badge: string
  badgeDone?: boolean
  children?: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <div
        className={cn('flex items-center gap-1 py-0.5 text-[0.65rem]', children && 'cursor-pointer')}
        style={{ color: 'var(--color-text-muted)' }}
        onClick={() => children && setOpen(v => !v)}
      >
        {children && (
          open
            ? <ChevronDown size={8} style={{ flexShrink: 0 }} />
            : <ChevronRight size={8} style={{ flexShrink: 0 }} />
        )}
        {icon}
        <span className="flex-1 font-medium">{label}</span>
        <span
          className="flex-shrink-0"
          style={{ color: badgeDone ? 'var(--color-success)' : 'var(--color-text-muted)' }}
        >
          {badge}
        </span>
      </div>
      {children && open && (
        <div className="pl-3">
          {children}
        </div>
      )}
    </div>
  )
}
