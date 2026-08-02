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
import { useEditorStore } from '../../../stores/editor-store'
import { ipc } from '../../../services/ipc-client'
import { getChapterLatestDraft } from '../../../services/version-service'
import { openChapterFile, openBuiltinEditor } from './SidebarShared'
import type { ProjectSummary } from '../../../shared/ipc-channels'
import { useTranslation } from '../../../hooks/useTranslation'

export default function ProjectWorkspace() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const [summary, setSummary] = useState<ProjectSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const requestIdRef = useRef(0)

  // 加载当前项目摘要（切换项目时保持 loading，新结果到达后替换）
  useEffect(() => {
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

  // 打开蓝图编辑器（全局章节蓝图，与 ProjectTree 入口统一 id 避免重复 Tab）
  const openBlueprint = useCallback(() => {
    openBuiltinEditor('chapter-card-editor', t('mention.blueprint'), 'chapter-card')
  }, [t])

  // 打开该章最新草稿（用真实草稿 id 构造 vela://draft/{id}，
  // 保证 parseDraftMeta 能解析 → 保存/定稿/修稿全部可用）
  const openDraft = useCallback(async (chapterNumber: number, chapterTitle?: string) => {
    let draft: { id: number; content: string } | null = null
    try {
      draft = await getChapterLatestDraft(chapterNumber)
    } catch (e) {
      console.warn('[ProjectWorkspace] 读取草稿失败:', e)
    }
    if (!draft) return // 该章无草稿（工作台草稿项只在 draftCount>0 时显示，防御性跳过）
    const filePath = `vela://draft/${draft.id}`
    useEditorStore.getState().openFile({
      id: filePath,
      name: `${chapterTitle || t('chapter.label').replace('{n}', String(chapterNumber))} · 草稿`,
      type: 'chapter',
      filePath,
      content: draft.content,
    })
  }, [t])

  // 打开正式稿（vela://manuscript/{draftId} → DB 定稿内容，不依赖物理路径命名）
  const openFinal = useCallback(async (chapterNumber: number, title?: string, draftId?: number) => {
    if (!draftId) return
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

          {/* 草稿箱 — 按章分组，点击打开该章最新草稿 */}
          <section
            className="rounded-xl border p-2.5"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <FileText size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                {t('draftbox.title')}
              </span>
              <span className="ml-auto text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
                {draftTotal}
              </span>
            </div>
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
                      {dc.chapterTitle || t('chapter.label').replace('{n}', String(dc.chapterNumber))}
                    </span>
                    <span className="ml-auto text-[0.6rem] opacity-50 flex-shrink-0">
                      {dc.draftCount} {t('draftbox.label').replace('{version}', '')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* 正式稿 — 已定稿章节，点击打开正文 */}
          <section
            className="rounded-xl border p-2.5"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <PenTool size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                {t('workspace.finalized')}
              </span>
              <span className="ml-auto text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
                {summary.chapters.length}
              </span>
            </div>
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
          </section>

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
