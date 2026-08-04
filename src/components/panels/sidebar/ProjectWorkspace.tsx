/**
 * ProjectWorkspace — 项目工作台（LT 方块点击后进入的侧边栏视图）
 *
 * 聚焦三大块（可操作，非只读摘要，非专注模式）：
 * - 章节蓝图：徽标 x/y，点击打开蓝图编辑器（可编辑全部章节蓝图）
 * - 草稿箱：按章分组，点击打开该章最新草稿（DraftEditor）
 * - 正式稿：已定稿章节，点击打开正文（manuscript 文件）
 * - 更多（折叠）：故事架构状态
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ChevronRight, ChevronDown, FileText, PenTool,
  LayoutList, CheckCircle2, Circle, BookOpen, FolderOpen,
} from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { ipc } from '../../../services/ipc-client'
import { openChapterFile, openBuiltinEditor, openDraftByChapter } from './SidebarShared'
import type { ProjectSummary } from '../../../shared/ipc-channels'
import VolumeGroup from './VolumeGroup'
import SidebarGroup from './SidebarGroup'
import { toast } from '../../ui/Toast'
import { globalEventBus } from '../../../shared/event-bus'
import { useTranslation } from '../../../hooks/useTranslation'

export default function ProjectWorkspace() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const [summary, setSummary] = useState<ProjectSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const requestIdRef = useRef(0)

  // 加载当前项目摘要（切换项目时保持 loading，新结果到达后替换）
  const loadSummary = useCallback(() => {
    const projectPath = currentProject?.path
    if (!projectPath) return
    const id = ++requestIdRef.current
    ipc.invoke('project:get-summary', projectPath).then(result => {
      if (id !== requestIdRef.current) return
      setLoading(false)
      if (result) setSummary(result)
      else setError(true)
    }).catch(() => {
      if (id !== requestIdRef.current) return
      setLoading(false)
      setError(true)
    })
  }, [currentProject?.path])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  // 运行链闭环：定稿/资源变化后刷新工作台——组件已挂载时 effect 不重跑，
  // 不监听事件则停留期间草稿箱/正式稿/分卷进度永远陈旧
  // （分卷数据由 VolumeGroup 自行监听刷新）
  useEffect(() => {
    const unsub1 = globalEventBus.on('FINALIZE_COMPLETE', () => { loadSummary() })
    const unsub2 = globalEventBus.on('REFRESH_RESOURCE', (payload: { resources: string[] }) => {
      if (payload.resources.includes('all') || payload.resources.includes('drafts') || payload.resources.includes('characterCards')) {
        loadSummary()
      }
    })
    return () => { unsub1(); unsub2() }
  }, [loadSummary])

  // 打开蓝图编辑器（全局章节蓝图，与 ProjectTree 入口统一 id 避免重复 Tab）
  const openBlueprint = useCallback(() => {
    openBuiltinEditor('chapter-card-editor', t('mention.blueprint'), 'chapter-card')
  }, [t])

  // 打开该章最新草稿（SidebarShared 公共实现：真实草稿 id → vela://draft/{id}，
  // parseDraftMeta 可解析 → 保存/定稿/修稿全部可用；无草稿 toast 反馈）
  const openDraft = useCallback((chapterNumber: number, chapterTitle?: string) => {
    void openDraftByChapter(chapterNumber, chapterTitle)
  }, [])

  // 打开正式稿（vela://manuscript/{draftId} → DB 定稿内容，不依赖物理路径命名）
  const openFinal = useCallback(async (chapterNumber: number, title?: string, draftId?: number) => {
    if (!draftId) {
      toast.warning(t('workspace.noFinal').replace('{n}', String(chapterNumber)))
      return // 防御：summary 聚合异常时给出反馈而非静默无反应
    }
    const display = `${t('chapter.label').replace('{n}', String(chapterNumber))}${title ? ` ${title}` : ''}`
    await openChapterFile(`vela://manuscript/${draftId}`, display)
  }, [t])

  // 未打开项目时提示
  if (!currentProject) {
    return (
      <div className="px-3 py-8 text-center text-xs opacity-40" style={{ color: 'var(--color-text-muted)' }}>
        {t('blueprint.openProjectFirst')}
      </div>
    )
  }

  const draftTotal = summary?.draftChapters.reduce((s, d) => s + d.draftCount, 0) ?? 0

  return (
    <div className="px-2 py-2 space-y-2">
      {/* 头部：项目名 */}
      <div className="flex items-center gap-1.5 px-1 pb-1">
        <FolderOpen size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
        <span className="flex-1 truncate text-xs font-medium" style={{ color: 'var(--color-text)' }}>
          {currentProject.name}
        </span>
      </div>

      {/* 内容：蓝图 + 草稿箱 + 正式稿 + 更多 */}
      {loading ? (
        <div className="text-[0.65rem] opacity-40 py-4 text-center" style={{ color: 'var(--color-text-muted)' }}>
          {t('status.loading')}
        </div>
      ) : error ? (
        <div className="text-[0.65rem] py-4 text-center" style={{ color: 'var(--color-error)' }}>
          {t('charList.loadFailed')}
        </div>
      ) : summary ? (
        <div className="space-y-2">
          {/* 章节蓝图 — 整块点击打开蓝图编辑器 */}
          <button
            type="button"
            onClick={openBlueprint}
            className="w-full rounded-xl border p-2.5 text-left transition-colors cursor-pointer"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}
            title={t('action.openBlueprint')}
          >
            <div className="flex items-center gap-1.5">
              <LayoutList size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                {t('mention.blueprint')}
              </span>
              <span
                className="ml-auto text-[0.7rem]"
                style={{ color: summary.blueprintCount >= summary.totalChapters ? 'var(--color-success)' : 'var(--color-text-muted)' }}
              >
                {summary.blueprintCount > 0
                  ? `${summary.blueprintCount}/${summary.totalChapters}`
                  : t('status.pendingGen')}
              </span>
              <ChevronRight size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            </div>
          </button>

          {/* 分卷 — 长篇小说按卷组织章节（新建/编辑/删除/自动划分/卷内章节） */}
          <VolumeGroup
            projectPath={currentProject.path}
            totalChapters={summary.totalChapters}
            chaptersForVolume={(v) => summary.draftChapters
              .filter(dc => dc.chapterNumber >= v.chapterStart && (v.chapterEnd === 0 || dc.chapterNumber <= v.chapterEnd))
              .map(dc => ({ chapterNumber: dc.chapterNumber, chapterTitle: dc.chapterTitle, hasFinalized: dc.hasFinalized }))}
            finalizedCountForVolume={(v) => summary.chapters
              .filter(ch => ch.chapterNumber >= v.chapterStart && (v.chapterEnd === 0 || ch.chapterNumber <= v.chapterEnd)).length}
            onOpenDraft={openDraft}
          />

          {/* 草稿箱 — 按章分组，点击打开该章最新草稿（可折叠） */}
          <SidebarGroup
            icon={<FileText size={12} />}
            title={t('draftbox.title')}
            count={draftTotal}
          >
            {summary.draftChapters.length === 0 ? (
              <div className="text-[0.65rem] py-1 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
                {t('charList.emptyProject')}
              </div>
            ) : (
              <div className="space-y-0.5">
                {summary.draftChapters.map(dc => (
                  <button
                    key={dc.chapterNumber}
                    type="button"
                    onClick={() => openDraft(dc.chapterNumber, dc.chapterTitle)}
                    className="w-full flex items-center gap-1.5 py-1 px-1.5 rounded-lg text-[0.7rem] text-left transition-colors cursor-pointer hover:bg-[var(--color-hover)]"
                    style={{ color: 'var(--color-text-secondary)' }}
                    title={t('action.openDraft')}
                  >
                    {dc.hasFinalized
                      ? <CheckCircle2 size={10} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                      : <Circle size={7} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />}
                    <span className="truncate">
                      {/* 章节号 + 标题（用户需知是第几章） */}
                      {t('chapter.label').replace('{n}', String(dc.chapterNumber))}
                      {dc.chapterTitle ? ` ${dc.chapterTitle}` : ''}
                    </span>
                    <span className="ml-auto text-[0.6rem] opacity-50 flex-shrink-0">
                      {dc.draftCount} {t('draftbox.label').replace('{version}', '')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </SidebarGroup>

          {/* 正式稿 — 已定稿章节，点击打开正文（可折叠） */}
          <SidebarGroup
            icon={<PenTool size={12} />}
            title={t('workspace.finalized')}
            count={summary.chapters.length}
          >
            {summary.chapters.length === 0 ? (
              <div className="text-[0.65rem] py-1 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
                {t('charList.emptyProject')}
              </div>
            ) : (
              <div className="space-y-0.5">
                {summary.chapters.map(ch => (
                  <button
                    key={ch.chapterNumber}
                    type="button"
                    onClick={() => openFinal(ch.chapterNumber, ch.title, ch.draftId)}
                    className="w-full flex items-center gap-1.5 py-1 px-1.5 rounded-lg text-[0.7rem] text-left transition-colors cursor-pointer hover:bg-[var(--color-hover)]"
                    style={{ color: 'var(--color-text-secondary)' }}
                    title={t('action.openChapter')}
                  >
                    <CheckCircle2 size={10} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                    <span className="truncate">
                      {t('chapter.label').replace('{n}', String(ch.chapterNumber))}
                      {ch.title ? ` ${ch.title}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </SidebarGroup>

          {/* 更多 — 故事架构（折叠） */}
          <MoreSection badge={`${summary.archGenerated}/4`} badgeDone={summary.archGenerated >= 4}>
            <div className="flex items-center gap-1.5 py-1 text-[0.7rem]" style={{ color: 'var(--color-text-secondary)' }}>
              <BookOpen size={11} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
              <span className="truncate">{t('charList.storyArch')}</span>
              <span className="ml-auto text-[0.6rem] opacity-50 flex-shrink-0">{summary.archGenerated}/4</span>
            </div>
          </MoreSection>
        </div>
      ) : null}
    </div>
  )
}

// ===== 更多折叠 =====

function MoreSection({
  badge, badgeDone, children,
}: {
  badge: string
  badgeDone?: boolean
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <section
      className="rounded-xl border p-2.5 cursor-pointer transition-colors"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}
      onClick={() => setOpen(v => !v)}
    >
      <div className="flex items-center gap-1.5">
        {open
          ? <ChevronDown size={11} style={{ color: 'var(--color-text-muted)' }} />
          : <ChevronRight size={11} style={{ color: 'var(--color-text-muted)' }} />}
        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
          {t('charList.more')}
        </span>
        <span
          className="ml-auto text-[0.7rem]"
          style={{ color: badgeDone ? 'var(--color-success)' : 'var(--color-text-muted)' }}
        >
          {badge}
        </span>
      </div>
      {open && <div className="mt-1.5">{children}</div>}
    </section>
  )
}
