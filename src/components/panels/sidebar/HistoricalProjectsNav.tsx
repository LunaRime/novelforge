/**
 * HistoricalProjectsNav — 历史项目方块列表（Sidebar 常驻底部）
 *
 * 竖排小方块列表 [[项目一],[项目二],…]：
 * - 每个小方块显示项目名 + 路径（一眼识别是哪个项目）
 * - 最多展示 5 个，更多时列表滚动下滑
 * - 每个方块带悬停提示（项目名/完整路径/最近打开时间）
 * - 点击方块 → 下方展开该项目的详情面板（单选：一次只显示一个项目，
 *   切换方块才切换内容，再点同一方块收起）
 * - 详情：章节蓝图（独立块，始终展开）+ 已定稿章节（可折叠）
 *   + 草稿按章分组（可折叠）+ 故事架构状态（默认折叠"更多"）
 * - 详情内"进入工作台"按钮 → 打开项目并自动进入专注模式
 */
import { useState, useCallback, useRef } from 'react'
import {
  ChevronRight, ChevronDown, FileText,
  PenTool, LayoutList, CheckCircle2, Circle, BookOpen,
  FolderOpen, Maximize2, Trash2,
} from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useEditorStore } from '../../../stores/editor-store'
import { ipc } from '../../../services/ipc-client'
import type { ProjectSummary } from '../../../shared/ipc-channels'
import { formatLocaleDateTime } from '../../../shared/locale'
import { cn } from '../../../lib/utils'
import { useTranslation } from '../../../hooks/useTranslation'
import { confirmDeleteProject } from '../../ui/Confirm'

// ===== 常量 =====

/** 方块列表可见高度（5 个方块 + 间距），超出滚动 */
const LIST_MAX_HEIGHT = 252
/** 详情面板最大高度（Sidebar 底部常驻，防止挤压上方视图） */
const DETAIL_MAX_HEIGHT = 320

// ===== 组件 =====

export default function HistoricalProjectsNav() {
  const { t } = useTranslation()
  const recentProjects = useProjectStore(s => s.recentProjects)
  const currentProject = useProjectStore(s => s.currentProject)
  const openProject = useProjectStore(s => s.openProject)
  const deleteProjectFolder = useProjectStore(s => s.deleteProjectFolder)
  const removeRecentProject = useProjectStore(s => s.removeRecentProject)
  // 单选：当前选中展示详情的项目（一次只显示一个项目的内容）
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [summary, setSummary] = useState<ProjectSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  // 请求序号：快速切换项目时丢弃过期响应，防止旧项目内容晚到覆盖新项目
  const requestIdRef = useRef(0)

  // 过滤：排除当前项目 + 最多展示 5 个
  const targets = recentProjects
    .filter(p => p.path !== currentProject?.path)
    .slice(0, 5)

  // 加载选中项目的摘要
  const loadSummary = useCallback(async (projectPath: string) => {
    const id = ++requestIdRef.current
    setLoading(true)
    setError(false)
    setSummary(null)
    const result = await ipc.invoke('project:get-summary', projectPath)
    if (id !== requestIdRef.current) return // 已有更新的请求，丢弃过期结果
    setLoading(false)
    if (result) setSummary(result)
    else setError(true)
  }, [])

  // 点击方块：选中并加载详情；再点同一方块收起
  const handleSquareClick = (projectPath: string) => {
    if (selectedPath === projectPath) {
      setSelectedPath(null)
      setSummary(null)
      return
    }
    setSelectedPath(projectPath)
    loadSummary(projectPath)
  }

  // 删除/移出最近项目（删除文件夹或仅移出列表）
  const handleDelete = async (e: React.MouseEvent, projectPath: string) => {
    e.stopPropagation()
    const action = await confirmDeleteProject()
    if (action === 'delete') await deleteProjectFolder(projectPath)
    else if (action === 'remove') await removeRecentProject(projectPath)
  }

  // 进入工作台：打开项目 + 切换到项目工作台视图（聚焦蓝图/草稿/正式稿，非专注模式）
  const handleEnterWorkspace = async (projectPath: string) => {
    const prevView = useLayoutStore.getState().sidebarView
    const ok = await openProject(projectPath, { keepView: true })
    if (!ok) return
    // 竞态保护：openProject 异步期间用户可能已切换视图，不覆盖用户选择
    if (useLayoutStore.getState().sidebarView !== prevView) return
    // 切换项目：清空旧项目残留的编辑器 Tab（避免内容错乱）
    useEditorStore.getState().clearTabs()
    useLayoutStore.setState({ sidebarOpen: true, sidebarView: 'workspace' })
  }

  return (
    <div className="flex flex-col overflow-hidden">
      {/* 区块标题 */}
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 flex-shrink-0">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {t('project.recent')}</span>
      </div>

      {/* ===== 方块列表 — 最多 5 个可见，超出滚动 ===== */}
      <div
        className="flex-shrink-0 space-y-1.5 overflow-y-auto px-2"
        style={{ maxHeight: LIST_MAX_HEIGHT }}
      >
        {targets.length === 0 && (
          <div className="text-center py-4 text-xs opacity-40" style={{ color: 'var(--color-text-muted)' }}>
            {t('charList.noHistory')}
          </div>
        )}
        {targets.map(p => {
          const isSelected = selectedPath === p.path
          // 悬停提示：名称/完整路径/最近打开时间（无效时间戳不追加行）
          const timeText = formatLocaleDateTime(p.updatedAt)
          const tipText = `${p.name}\n${p.path}${timeText ? `\n${timeText}` : ''}`
          return (
            <button
              key={p.path}
              type="button"
              onClick={() => handleSquareClick(p.path)}
              title={tipText}
              className={cn(
                'group w-full flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left',
                'transition-all duration-150 cursor-pointer select-none',
              )}
              style={{
                borderColor: isSelected ? 'var(--color-accent)' : 'var(--color-border)',
                backgroundColor: isSelected
                  ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-panel))'
                  : 'var(--color-panel)',
                boxShadow: isSelected ? 'inset 2px 0 0 var(--color-accent)' : 'none',
              }}
            >
              <FolderOpen
                size={14}
                style={{
                  color: isSelected ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  flexShrink: 0,
                }}
              />
              {/* 项目识别信息：名称 + 路径 */}
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                  {p.name}
                </span>
                <span className="block text-[0.65rem] truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {p.path}
                </span>
              </span>
              {/* 删除/移出 */}
              <span
                role="button"
                className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
                style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-hover)' }}
                onClick={(e) => handleDelete(e, p.path)}
                title={t('project.deleteTooltip')}
              >
                <Trash2 size={11} />
              </span>
            </button>
          )
        })}
      </div>

      {/* ===== 详情面板 — 单选，一次只显示选中项目的内容 ===== */}
      {selectedPath && (
        <div className="overflow-y-auto px-2 pt-1.5 pb-2" style={{ maxHeight: DETAIL_MAX_HEIGHT }}>
          <div
            className="rounded-xl border overflow-hidden transition-colors"
            style={{
              borderColor: 'var(--color-accent)',
              backgroundColor: 'color-mix(in srgb, var(--color-accent) 4%, var(--color-panel))',
            }}
          >
            {/* 详情头：收起 + 项目名 + 删除 + 进入完整工作台 */}
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <button
                type="button"
                onClick={() => handleSquareClick(selectedPath)}
                className="flex-shrink-0 p-0.5 rounded hover:bg-[var(--color-hover)] transition-colors cursor-pointer"
                style={{ color: 'var(--color-text-muted)' }}
                title={t('charList.clickToToggle')}
              >
                <ChevronDown size={12} />
              </button>
              <FolderOpen size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
              <span className="flex-1 truncate text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                {summary?.name || targets.find(p => p.path === selectedPath)?.name || ''}
              </span>
              <button
                type="button"
                className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer"
                style={{ color: 'var(--color-text-muted)' }}
                onClick={(e) => { e.stopPropagation(); handleDelete(e, selectedPath) }}
                title={t('project.deleteTooltip')}
              >
                <Trash2 size={11} />
              </button>
              <button
                type="button"
                onClick={() => handleEnterWorkspace(selectedPath)}
                className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.65rem] transition-colors cursor-pointer"
                style={{ color: 'var(--color-accent)', backgroundColor: 'rgba(var(--color-accent-rgb), 0.1)' }}
                title={t('charList.openProject')}
              >
                <Maximize2 size={10} />
                {t('charList.workspace')}
              </button>
            </div>

            {/* 详情内容：四块（条目仅展示） */}
            {summary ? (
              <div className="px-2 pb-2 space-y-0.5">
                {/* 章节蓝图 — 独立块（始终展开） */}
                <ExpandSection
                  icon={<LayoutList size={10} />}
                  label={t('mention.blueprint')}
                  badge={summary.blueprintCount > 0
                    ? `${summary.blueprintCount}/${summary.totalChapters}`
                    : t('status.pendingGen')}
                  badgeDone={summary.blueprintCount >= summary.totalChapters}
                  alwaysOpen
                />

                {/* 已定稿章节列表（可折叠） */}
                {summary.chapters.length > 0 && (
                  <ExpandSection
                    icon={<PenTool size={10} />}
                    label={t('charList.completedChapters')}
                    badge={String(summary.chapters.length)}
                  >
                    {summary.chapters.map(ch => (
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
                {summary.draftChapters.length > 0 && (
                  <ExpandSection
                    icon={<FileText size={10} />}
                    label={t('draftbox.title')}
                    badge={String(summary.draftChapters.reduce((s, d) => s + d.draftCount, 0))}
                  >
                    {summary.draftChapters.map(dc => (
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
                  badge={`${summary.archGenerated}/4`}
                  badgeDone={summary.archGenerated >= 4}
                  defaultOpen={false}
                />

                {/* 空项目提示 */}
                {summary.chapters.length === 0 && summary.draftChapters.length === 0 && (
                  <div className="text-[0.65rem] py-1 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
                    {t('charList.emptyProject')}
                  </div>
                )}
              </div>
            ) : loading ? (
              <div className="px-2 pb-2 text-[0.65rem] opacity-40" style={{ color: 'var(--color-text-muted)' }}>
                {t('status.loading')}
              </div>
            ) : error ? (
              <div className="px-2 pb-2 text-[0.65rem]" style={{ color: 'var(--color-error)' }}>
                {t('charList.loadFailed')}
              </div>
            ) : null}
          </div>
        </div>
      )}
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
