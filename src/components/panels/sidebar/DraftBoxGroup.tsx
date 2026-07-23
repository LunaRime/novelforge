/**
 * DraftBoxGroup — 草稿箱折叠组（含章节分组和单条草稿条目）
 */

import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, CheckCircle2, Circle, FileText, FolderOpen, Copy, Trash2, FilePen } from 'lucide-react'
import type { DraftMeta } from '../../../stores/draft-store'
import { useDraftStore, readDraftBody } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { confirm } from '../../ui/Confirm'
import { DRAFT_STATUS_LABEL, DRAFT_STATUS_COLOR } from '../../../shared/draft-status'
import { showSidebarMenu } from './SidebarShared'
import { ipc } from '../../../services/ipc-client'
import { useTranslation } from '../../../hooks/useTranslation'

// ===== 草稿箱折叠组 =====

export default function DraftBoxGroup({
  draftsByChapter,
}: {
  draftsByChapter: Record<number, DraftMeta[]>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)

  // 所有章节号排序
  const chapterNums = Object.keys(draftsByChapter)
    .map(Number)
    .sort((a, b) => a - b)

  // 筛选出包含非保留（活跃）草稿的实际章节数
  const activeChapterCount = chapterNums.filter(n =>
    (draftsByChapter[n] || []).some(d => d.status !== 'archived')
  ).length

  return (
    <div>
      {/* 草稿箱标题行 */}
      <div
        className="tree-item gap-1.5 cursor-pointer select-none"
        style={{ paddingLeft: 10 }}
        onClick={() => setOpen(v => !v)}
        title={t('tip.draftBox')}
      >
        {open
          ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        }
        <FilePen size={14} style={{ color: 'var(--color-text-muted)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('draftbox.title')}</span>
        {activeChapterCount > 0 && (
          <span className="ml-auto text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
            {t('draftbox.count').replace('{n}', String(activeChapterCount))}
          </span>
        )}
      </div>

      {open && (
        <div>
          {chapterNums.length === 0 ? (
            <div
              className="text-xs py-1"
              style={{ paddingLeft: 34, color: 'var(--color-text-muted)' }}
            >
              {t('draftbox.empty')}
            </div>
          ) : (
            chapterNums.map(chNum => (
              <DraftChapterGroup
                key={chNum}
                chapterNumber={chNum}
                drafts={draftsByChapter[chNum] || []}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ===== 单章草稿分组 =====

function DraftChapterGroup({
  chapterNumber,
  drafts,
}: {
  chapterNumber: number
  drafts: DraftMeta[]
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)

  // 将 archived 草稿折叠，只显示活跃草稿（非 archived）
  const activeDrafts = drafts.filter(d => d.status !== 'archived')
  const archivedDrafts = drafts.filter(d => d.status === 'archived')
  const [showArchived, setShowArchived] = useState(false)
  const [bpTitle, setBpTitle] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ipc.invoke('db:blueprint-get', chapterNumber).then(bp => {
      if (!cancelled && bp?.title) {
        setBpTitle(bp.title)
      }
    }).catch(() => { })
    return () => { cancelled = true }
  }, [chapterNumber])

  // 已定稿的草稿存在时，章节显示绿色标记
  const hasFinalized = drafts.some(d => d.status === 'finalized')
  const baseTitle = bpTitle || drafts[0]?.chapterTitle || ''
  const chLabelCN = `第${chapterNumber}章`
  const chLabel = t('chapter.label').replace('{n}', String(chapterNumber))
  const displayTitle = baseTitle.startsWith(chLabelCN) ? baseTitle : (baseTitle ? `${chLabel} ${baseTitle}` : chLabel)

  return (
    <div>
      {/* 章节行 */}
      <div
        className="tree-item gap-1.5 cursor-pointer select-none"
        style={{ paddingLeft: 26 }}
        onClick={() => setOpen(v => !v)}
        title={displayTitle}
      >
        {open
          ? <ChevronDown size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          : <ChevronRight size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        }
        {hasFinalized
          ? <CheckCircle2 size={10} style={{ flexShrink: 0, color: 'var(--color-success)' }} />
          : <Circle size={6} style={{ flexShrink: 0, fill: 'transparent', stroke: 'var(--color-text-muted)' }} />
        }
        <span className="text-sm flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {displayTitle}
        </span>
        <span className="ml-auto text-[0.7rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {t('draftbox.revisionCount').replace('{n}', String(activeDrafts.length))}
        </span>
      </div>

      {/* 草稿列表 */}
      {open && (
        <div>
          {activeDrafts.map(draft => (
            <DraftItem
              key={draft.filePath}
              draft={draft}
              chapterTitleText={displayTitle}
            />
          ))}

          {/* 显示归档草稿的切换按钮 */}
          {archivedDrafts.length > 0 && (
            <div
              className="flex items-center gap-1 cursor-pointer select-none"
              style={{ paddingLeft: 54 }}
              onClick={() => setShowArchived(v => !v)}
            >
              <span className="text-[0.7rem]" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>
                {showArchived ? t('draftbox.hideArchived') : t('draftbox.showArchived').replace('{n}', String(archivedDrafts.length))}
              </span>
            </div>
          )}
          {showArchived && archivedDrafts.map(draft => (
            <DraftItem
              key={draft.filePath}
              draft={draft}
              chapterTitleText={displayTitle}
              archived
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ===== 单条草稿条目 =====

function DraftItem({
  draft,
  chapterTitleText,
  archived = false,
}: {
  draft: DraftMeta
  chapterTitleText: string
  archived?: boolean
}) {
  const { t } = useTranslation()

  /** 打开草稿到编辑器 */
  const openDraft = async () => {
    const content = await readDraftBody(draft.filePath)
    useEditorStore.getState().openFile({
      id: draft.filePath,
      name: `${chapterTitleText} v${draft.version}`,
      type: 'chapter',
      filePath: draft.filePath,
      content,
    })
  }

  /** 将草稿标记为归档（软删除） */
  const deleteDraft = async () => {
    if (isFinalized) return
    const ok = await confirm(
      t('draftbox.archiveConfirm').replace('{name}', `${chapterTitleText} v${draft.version}`),
      { title: t('dialog.confirmArchive'), confirmText: t('draftbox.archiveAction'), danger: true }
    )
    if (!ok) return
    await useDraftStore.getState().markDraftStatus(draft.filePath, draft.chapterNumber, 'archived')
  }

  const isFinalized = draft.status === 'finalized'

  return (
    <div
      className="relative flex items-center gap-1.5 cursor-pointer hover:bg-[var(--color-hover)]"
      style={{
        paddingLeft: 50,
        paddingRight: 8,
        paddingTop: 3,
        paddingBottom: 3,
        opacity: archived ? 0.45 : 1,
      }}
      onClick={openDraft}
      onContextMenu={e => showSidebarMenu([
        {
          key: 'open',
          label: t('action.openDraft'),
          icon: <FolderOpen size={13} />,
          onClick: openDraft,
        },
        { key: 'div1', type: 'divider' as const },
        {
          key: 'copy-path',
          label: t('action.copyPath'),
          icon: <Copy size={13} />,
          onClick: () => navigator.clipboard.writeText(draft.filePath).catch(() => { }),
        },
        { key: 'div2', type: 'divider' as const },
        {
          key: 'delete',
          label: t('action.deleteDraft'),
          icon: <Trash2 size={13} />,
          danger: true,
          disabled: isFinalized,
          onClick: deleteDraft,
        },
      ], e)}
      title={t('draftbox.tooltip')
        .replace('{title}', chapterTitleText)
        .replace('{version}', String(draft.version))
        .replace('{status}', DRAFT_STATUS_LABEL[draft.status] || draft.status)}
    >
      <FileText size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      <span className="text-xs flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>
        {t('draftbox.label').replace('{version}', String(draft.version))}
      </span>
      {/* 状态标签（始终显示） */}
      <span
        className="text-[0.7rem] flex-shrink-0"
        style={{ color: DRAFT_STATUS_COLOR[draft.status] || 'var(--color-text-muted)' }}
      >
        {DRAFT_STATUS_LABEL[draft.status] || draft.status}
      </span>
      {/* 已定稿图标 */}
      {isFinalized && (
        <CheckCircle2 size={10} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
      )}
    </div>
  )
}
