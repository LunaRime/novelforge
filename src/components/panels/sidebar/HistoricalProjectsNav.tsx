/**
 * HistoricalProjectsNav — 历史项目视图（📦 Archive）
 *
 * 竖排正方形卡片网格（[[项目一],[项目二]]…）：
 * - 每张卡片为正方形，居中显示项目标题文字
 * - 最多展示 5 个，展开内容多时容器滚动下滑
 * - 点击卡片 → 当前视图内展开「精简工作台」（重建 UI，不跳转）：
 *   章节蓝图（独立块，始终展开）+ 已定稿章节（可折叠）
 *   + 草稿按章分组（可折叠）+ 故事架构状态（默认折叠"更多"）
 * - 工作台内"进入工作台"按钮 → 打开项目并自动进入专注模式
 *   （收起不必要的一部分 UI，与普通项目工作台不同）
 */
import { useState, useCallback } from 'react'
import {
  ChevronRight, ChevronDown, FileText,
  PenTool, LayoutList, CheckCircle2, Circle, BookOpen,
  FolderOpen, Maximize2, Trash2,
} from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { useLayoutStore } from '../../../stores/layout-store'
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

export default function HistoricalProjectsNav({
  onDelete,
}: {
  /** 删除回调（首页侧栏提供：删除文件夹/移出列表） */
  onDelete?: (e: React.MouseEvent, projectPath: string) => void
}) {
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

  // 点击卡片：展开/折叠精简工作台（当前视图内重建，不跳转）
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

  // 进入工作台：打开项目 + 自动专注模式（收起不必要 UI）
  const handleEnterWorkspace = async (projectPath: string) => {
    const ok = await openProject(projectPath)
    if (ok) {
      // 精简工作台：收起侧栏/面板，聚焦编辑区
      useLayoutStore.setState({ focusMode: true, sidebarOpen: false, bottomPanelOpen: false, aiPanelOpen: false })
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 卡片网格 — 最多 5 个，内容多时滚动下滑 */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
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
            <div key={p.path} className="group">
              {/* 正方形卡片（未展开时）：显示项目标题文字 */}
              {!isExpanded ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => toggleExpand(p.path)}
                    title={t('charList.clickToToggle')}
                    className={cn(
                      'group w-full aspect-square rounded-xl border flex flex-col items-center justify-center gap-2',
                      'transition-all duration-150 cursor-pointer select-none overflow-hidden',
                      'border-[var(--color-border)] bg-[var(--color-panel)]',
                      'hover:border-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_4%,var(--color-panel))]',
                    )}
                  >
                    {loaded?.loading ? (
                      <span className="animate-spin opacity-40">⟳</span>
                    ) : (
                      <>
                        <FolderOpen size={20} style={{ color: 'var(--color-accent)', opacity: 0.7 }} />
                        {/* 项目标题文字 */}
                        <span
                          className="px-2 text-sm font-medium leading-snug text-center line-clamp-3"
                          style={{ color: 'var(--color-text)' }}
                        >
                          {p.name}
                        </span>
                        {/* 摘要徽标 */}
                        {loaded?.loaded && bpc !== null && chCount !== null && (
                          <span className="text-[0.6rem] opacity-50" style={{ color: 'var(--color-text-muted)' }}>
                            {`${bpc}/${loaded.totalChapters}B · ${chCount}C · ${drCount}D`}
                          </span>
                        )}
                        {loaded?.error && (
                          <span className="text-[0.6rem]" style={{ color: 'var(--color-error)' }}>
                            {t('charList.loadFailed')}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                  {/* 删除/移出（首页侧栏提供回调时显示） */}
                  {onDelete && (
                    <button
                      type="button"
                      className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
                      style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-hover)' }}
                      onClick={(e) => { e.stopPropagation(); onDelete(e, p.path) }}
                      title={t('project.deleteTooltip')}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              ) : (
                /* 展开：精简工作台（当前视图内重建，不跳转） */
                <div
                  className="rounded-xl border overflow-hidden transition-colors"
                  style={{
                    borderColor: 'var(--color-accent)',
                    backgroundColor: 'color-mix(in srgb, var(--color-accent) 4%, var(--color-panel))',
                  }}
                >
                  {/* 工作台头：返回折叠 + 项目名 + 进入完整工作台 */}
                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleExpand(p.path)}
                      className="flex-shrink-0 p-0.5 rounded hover:bg-[var(--color-hover)] transition-colors cursor-pointer"
                      style={{ color: 'var(--color-text-muted)' }}
                      title={t('charList.clickToToggle')}
                    >
                      <ChevronDown size={12} />
                    </button>
                    <FolderOpen size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                    <span className="flex-1 truncate text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                      {p.name}
                    </span>
                    {/* 删除/移出（首页侧栏提供回调时显示） */}
                    {onDelete && (
                      <button
                        type="button"
                        className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer"
                        style={{ color: 'var(--color-text-muted)' }}
                        onClick={(e) => { e.stopPropagation(); onDelete(e, p.path) }}
                        title={t('project.deleteTooltip')}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                    {/* 进入完整工作台（打开项目 + 专注模式） */}
                    <button
                      type="button"
                      onClick={() => handleEnterWorkspace(p.path)}
                      className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.65rem] transition-colors cursor-pointer"
                      style={{ color: 'var(--color-accent)', backgroundColor: 'rgba(var(--color-accent-rgb), 0.1)' }}
                      title={t('charList.openProject')}
                    >
                      <Maximize2 size={10} />
                      {t('charList.workspace')}
                    </button>
                  </div>

                  {/* 工作台内容：四块（展开不跳转，条目仅展示） */}
                  {loaded?.loaded && !loaded.error ? (
                    <div className="px-2 pb-2 space-y-0.5">
                      {/* 章节蓝图 — 独立块（始终展开） */}
                      <ExpandSection
                        icon={<LayoutList size={10} />}
                        label={t('mention.blueprint')}
                        badge={loaded.blueprintCount > 0
                          ? `${loaded.blueprintCount}/${loaded.totalChapters}`
                          : t('status.pendingGen')}
                        badgeDone={loaded.blueprintCount >= loaded.totalChapters}
                        alwaysOpen
                      />

                      {/* 已定稿章节列表（可折叠） */}
                      {loaded.chapters.length > 0 && (
                        <ExpandSection
                          icon={<PenTool size={10} />}
                          label={t('charList.completedChapters')}
                          badge={String(loaded.chapters.length)}
                        >
                          {loaded.chapters.map(ch => (
                            <div
                              key={ch.chapterNumber}
                              className="flex items-center gap-1 py-0.5 text-[0.7rem] rounded px-1"
                              style={{ color: 'var(--color-text-secondary)' }}
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

                      {/* 草稿按章分组（可折叠） */}
                      {loaded.draftChapters.length > 0 && (
                        <ExpandSection
                          icon={<FileText size={10} />}
                          label={t('draftbox.title')}
                          badge={String(drCount)}
                        >
                          {loaded.draftChapters.map(dc => (
                            <div
                              key={dc.chapterNumber}
                              className="flex items-center gap-1 py-0.5 text-[0.7rem] rounded px-1"
                              style={{ color: 'var(--color-text-secondary)' }}
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

                      {/* 更多 — 故事架构状态（默认折叠） */}
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
                  ) : loaded?.loading ? (
                    <div className="px-2 pb-2 text-[0.65rem] opacity-40" style={{ color: 'var(--color-text-muted)' }}>
                      {t('status.loading')}
                    </div>
                  ) : (
                    <div className="px-2 pb-2 text-[0.65rem]" style={{ color: 'var(--color-error)' }}>
                      {t('charList.loadFailed')}
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
  icon, label, badge, badgeDone, children, defaultOpen = true, alwaysOpen = false,
}: {
  icon: React.ReactNode
  label: string
  badge: string
  badgeDone?: boolean
  children?: React.ReactNode
  defaultOpen?: boolean
  /** 始终展开（如章节蓝图独立块） */
  alwaysOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const isOpen = alwaysOpen || open

  return (
    <div>
      <div
        className={cn('flex items-center gap-1 py-0.5 text-[0.65rem]', !alwaysOpen && children && 'cursor-pointer')}
        style={{ color: 'var(--color-text-muted)' }}
        onClick={() => !alwaysOpen && children && setOpen(v => !v)}
      >
        {!alwaysOpen && children && (
          isOpen
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
      {children && isOpen && (
        <div className="pl-3">
          {children}
        </div>
      )}
    </div>
  )
}
