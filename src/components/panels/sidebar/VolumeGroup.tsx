/**
 * VolumeGroup — 分卷管理组（工作台 / 项目结构共用）
 *
 * 标题行：分卷 + 数量 + 新建（+） + 自动划分（Layers）
 * 卷列表：第N卷「标题」+ 章节范围 + 定稿进度徽标 + 编辑/删除 → 展开卷内章节
 * 数据：useVolumeStore；卷内章节由调用方注入（工作台用 summary、项目结构用 draftsByChapter）
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import {
  ChevronRight, ChevronDown, BookMarked, Plus, Pencil, Trash2, Layers,
  CheckCircle2, Circle,
} from 'lucide-react'
import MenuRow from '../../ui/MenuRow'
import { Input } from '../../ui/Input'
import CountBadge from '../../ui/CountBadge'
import { useVolumeStore } from '../../../stores/volume-store'
import { globalEventBus } from '../../../shared/event-bus'
import type { VolumeData } from '../../../../electron/repositories/volume-repository'
import type { VolumeSplitResult } from '../../../services/volume-utils'
import VolumeDialog from '../../dialogs/VolumeDialog'
import AutoSplitDialog from '../../dialogs/AutoSplitDialog'
import SceneList from './SceneList'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import { useTranslation } from '../../../hooks/useTranslation'
import { useEditorStore } from '../../../stores/editor-store'
import { useNavigationExpansion } from './navigation-session'

/** 卷内章节统一格式（工作台 summary / 项目结构 drafts 转换后传入） */
export interface VolumeChapter {
  chapterNumber: number
  chapterTitle?: string
  hasFinalized: boolean
  draftId?: number
  canReorder?: boolean
}

interface VolumeGroupProps {
  /** 项目路径（分卷数据随项目切换重载） */
  projectPath?: string
  /** 注入卷内章节（调用方各自数据源） */
  chaptersForVolume: (volume: VolumeData) => VolumeChapter[]
  /** 点击卷内章节（打开草稿） */
  onOpenDraft: (chapterNumber: number, chapterTitle?: string, draftId?: number) => void
  /** 每卷的已定稿章节数（进度徽标） */
  finalizedCountForVolume: (volume: VolumeData) => number
  /** 自动划分的章节总数（0 = 隐藏自动划分按钮） */
  totalChapters?: number
  /** 拖拽/键盘重排章节（章节号不变，只改卷成员与顺序） */
  onReorderChapter?: (chapterNumber: number, toVolumeNumber: number, targetIndex?: number) => void
}

export default function VolumeGroup({
  projectPath,
  chaptersForVolume,
  onOpenDraft,
  finalizedCountForVolume,
  totalChapters = 0,
  onReorderChapter,
}: VolumeGroupProps) {
  const { t } = useTranslation()
  const volumes = useVolumeStore(s => s.volumes)
  const loadVolumes = useVolumeStore(s => s.load)
  const removeVolume = useVolumeStore(s => s.remove)
  const upsertVolume = useVolumeStore(s => s.upsert)
  const [open, toggle] = useNavigationExpansion('binder')
  const [query, setQuery] = useState('')
  const filter = query.trim().toLocaleLowerCase()
  const groupId = useId()
  const [volumeDialog, setVolumeDialog] = useState<{ open: boolean; editing: VolumeData | null }>({ open: false, editing: null })
  const [autoSplitOpen, setAutoSplitOpen] = useState(false)

  // 卷号列表引用稳定（VolumeDialog effect 依赖，防父组件重渲染重置表单）
  const volumeNumbers = useMemo(() => volumes.map(v => v.volumeNumber), [volumes])

  // 项目切换 + 定稿/资源变化时加载分卷
  useEffect(() => {
    loadVolumes()
  }, [projectPath, loadVolumes])
  useEffect(() => {
    const unsub = globalEventBus.on('REFRESH_RESOURCE', (payload: { resources: string[] }) => {
      if (payload.resources.includes('all') || payload.resources.includes('drafts') || payload.resources.includes('characterCards')) {
        loadVolumes()
      }
    })
    return () => { unsub() }
  }, [loadVolumes])

  // 删除分卷（章节数据不受影响）
  const handleDeleteVolume = useCallback(async (v: VolumeData) => {
    const ok = await confirm(
      t('volume.deleteConfirm').replace('{title}', v.title || t('volume.ordinal').replace('{n}', String(v.volumeNumber))),
      { title: t('volume.title'), confirmText: t('action.delete'), danger: true },
    )
    if (ok) await removeVolume(v.volumeNumber)
  }, [t, removeVolume])

  // 应用自动划分：批量创建缺失卷号（已存在的跳过——upsert 是覆盖语义，不得覆盖手建卷）
  const handleApplySplit = useCallback(async (splits: VolumeSplitResult[]) => {
    const existing = new Set(useVolumeStore.getState().volumes.map(v => v.volumeNumber))
    let created = 0
    let skipped = 0
    let failed = 0
    for (const s of splits) {
      if (existing.has(s.volumeNumber)) { skipped++; continue }
      const ok = await upsertVolume({
        volumeNumber: s.volumeNumber,
        title: '',
        description: '',
        chapterStart: s.chapterStart,
        chapterEnd: s.chapterEnd,
      })
      if (ok) created++
      else failed++
    }
    toast.success(t('volume.splitDone').replace('{n}', String(created)).replace('{skip}', String(skipped)).replace('{fail}', String(failed)))
  }, [upsertVolume, t])

  return (
    <section>
      {/* 头部行片（2026-09-28 批 0）：折叠卡 = MenuRow 主按钮（功能图标悬停置换 ›/⌄、计数在内），
          操作按钮（自动划分/新建卷）作兄弟；命中区固定 32×32（标准 §5.2） */}
      <MenuRow
        icon={<BookMarked size={12} />}
        title={t('volume.title')}
        count={<CountBadge value={volumes.length} unit={t('unit.volumes')} />}
        swap="expand"
        expanded={open}
        onPrimary={toggle}
        controlsId={groupId}
        actions={
          <>
            {totalChapters > 0 && (
              <button
                type="button"
                onClick={() => setAutoSplitOpen(true)}
                className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
                style={{ width: 32, height: 32, color: 'var(--color-text-muted)' }}
                title={t('volume.autoSplit')}
              >
                <Layers size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setVolumeDialog({ open: true, editing: null })}
              className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
              style={{ width: 32, height: 32, color: 'var(--color-text-muted)' }}
              title={t('volume.newVolume')}
            >
              <Plus size={12} />
            </button>
          </>
        }
      />

      <div id={groupId} hidden={!open}>
        {open && (volumes.length === 0 ? (
          <p className="py-1 pl-3 text-micro text-[var(--color-text-muted)]">{t('volume.empty')}</p>
        ) : (
          <>
            <div className="px-2 py-1">
              <Input type="search" value={query} aria-label={t('action.search')} placeholder={t('action.search')}
                onChange={event => setQuery(event.target.value)} />
            </div>
            {volumes.map(volume => {
              const chapters = chaptersForVolume(volume)
              const visible = filter ? chapters.filter(row =>
                `${t('chapter.label').replace('{n}', String(row.chapterNumber))} ${row.chapterTitle ?? ''}`
                  .toLocaleLowerCase().includes(filter)) : chapters
              return <VolumeRow key={volume.volumeNumber} volume={volume} chapters={visible}
                doneCount={finalizedCountForVolume(volume)} onOpenDraft={onOpenDraft}
                onEdit={() => setVolumeDialog({ open: true, editing: volume })}
                onDelete={() => handleDeleteVolume(volume)} onReorderChapter={filter ? undefined : onReorderChapter} />
            })}
          </>
        ))}
      </div>

      {/* 分卷新建/编辑弹框 */}
      <VolumeDialog
        isOpen={volumeDialog.open}
        onClose={() => setVolumeDialog({ open: false, editing: null })}
        editing={volumeDialog.editing}
        existingNumbers={volumeNumbers}
      />

      {/* 分卷自动划分弹框 */}
      {totalChapters > 0 && (
        <AutoSplitDialog
          isOpen={autoSplitOpen}
          onClose={() => setAutoSplitOpen(false)}
          totalChapters={totalChapters}
          existingNumbers={volumeNumbers}
          onApply={handleApplySplit}
        />
      )}
    </section>
  )
}

// ===== 分卷行 =====

function VolumeRow({
  volume,
  chapters,
  doneCount,
  onEdit,
  onDelete,
  onOpenDraft,
  onReorderChapter,
}: {
  volume: VolumeData
  chapters: VolumeChapter[]
  doneCount: number
  onEdit: () => void
  onDelete: () => void
  onOpenDraft: (chapterNumber: number, chapterTitle?: string, draftId?: number) => void
  onReorderChapter?: (chapterNumber: number, toVolumeNumber: number, targetIndex?: number) => void
}) {
  const { t } = useTranslation()
  const [open, toggle] = useNavigationExpansion(`volume:${volume.volumeNumber}`)
  const groupId = useId()

  // 进度徽标：卷有明确终点 → done/total；进行中（end=0）→ 仅显示已定稿数
  const totalCount = volume.chapterEnd > 0
    ? Math.max(0, volume.chapterEnd - volume.chapterStart + 1)
    : 0
  const progressText = totalCount > 0
    ? t('volume.progress').replace('{done}', String(Math.min(doneCount, totalCount))).replace('{total}', String(totalCount))
    : t('volume.progress').replace('{done}', String(doneCount)).replace('{total}', '…')
  const rangeText = volume.chapterEnd === 0
    ? t('volume.ongoing')
    : t('volume.chapters').replace('{start}', String(volume.chapterStart)).replace('{end}', String(volume.chapterEnd))
  const doneAll = totalCount > 0 && doneCount >= totalCount

  return (
    <div>
      <div
        onDragOver={event => { if (onReorderChapter) event.preventDefault() }}
        onDrop={event => {
          if (!onReorderChapter) return
          const from = Number(event.dataTransfer.getData('application/x-novelforge-chapter'))
          if (!Number.isSafeInteger(from) || from <= 0) return
          event.preventDefault()
          onReorderChapter(from, volume.volumeNumber)
        }}
      >
        <MenuRow
          title={volume.title
            ? t('volume.ordinalTitle').replace('{n}', String(volume.volumeNumber)).replace('{title}', volume.title)
            : t('volume.ordinal').replace('{n}', String(volume.volumeNumber))}
          titleHint={volume.description || volume.title || undefined}
          icon={<BookMarked size={12} className="shrink-0 text-[var(--color-text-muted)]" />}
          count={<span className="inline-flex items-center gap-1">
            {rangeText}
            <CountBadge value={doneCount} total={totalCount > 0 ? totalCount : undefined}
              progress={totalCount > 0} tone={doneAll ? 'success' : 'muted'} title={progressText} />
          </span>}
          onPrimary={toggle}
          swap="expand"
          expanded={open}
          controlsId={groupId}
          actions={<>
            <button type="button" className="icon-btn size-[32px] shrink-0" title={t('volume.editVolume')}
              aria-label={t('volume.editVolume')} onClick={onEdit}><Pencil size={10} /></button>
            <button type="button" className="icon-btn size-[32px] shrink-0" title={t('action.delete')}
              aria-label={t('action.delete')} onClick={onDelete}><Trash2 size={10} /></button>
          </>}
        />
      </div>

      <div id={groupId} hidden={!open} className="pl-3">
        {open && (
          <>
          {chapters.length === 0 ? (
            <div className="text-micro py-1 pl-1.5 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
              {t('charList.emptyProject')}
            </div>
          ) : chapters.map((chapter, index) => (
            <VolumeChapterRow key={chapter.chapterNumber} chapter={chapter} index={index}
              chapters={chapters} volumeNumber={volume.volumeNumber} onOpenDraft={onOpenDraft}
              onReorderChapter={onReorderChapter} />
          ))}
          </>
        )}
      </div>
    </div>
  )
}

function VolumeChapterRow({ chapter, index, chapters, volumeNumber, onOpenDraft, onReorderChapter }: {
  chapter: VolumeChapter
  index: number
  chapters: VolumeChapter[]
  volumeNumber: number
  onOpenDraft: VolumeGroupProps['onOpenDraft']
  onReorderChapter?: VolumeGroupProps['onReorderChapter']
}) {
  const { t } = useTranslation()
  const current = useEditorStore(state => chapter.draftId !== undefined && state.activeTabId === `doc:${chapter.draftId}`)
  const [scenesOpen, toggleScenes] = useNavigationExpansion(`scenes:${volumeNumber}:${chapter.chapterNumber}`)
  const scenesId = useId()
  const title = t('chapter.label').replace('{n}', String(chapter.chapterNumber)) + (chapter.chapterTitle ? ` ${chapter.chapterTitle}` : '')
  const draggable = Boolean(onReorderChapter && chapter.canReorder !== false)
  return (
    <div>
      <div draggable={draggable} onDragStart={event => {
        if (!draggable) return
        event.dataTransfer.setData('application/x-novelforge-chapter', String(chapter.chapterNumber))
        event.dataTransfer.effectAllowed = 'move'
      }} onDragOver={event => { if (onReorderChapter) event.preventDefault() }} onDrop={event => {
        if (!onReorderChapter) return
        const from = Number(event.dataTransfer.getData('application/x-novelforge-chapter'))
        if (!Number.isSafeInteger(from) || from <= 0) return
        event.preventDefault()
        event.stopPropagation()
        if (from === chapter.chapterNumber) return
        const target = chapters.filter(row => row.chapterNumber !== from)
          .findIndex(row => row.chapterNumber === chapter.chapterNumber)
        onReorderChapter(from, volumeNumber, target + 1)
      }}>
        <MenuRow
          title={title} titleHint={title}
          icon={chapter.hasFinalized ? <CheckCircle2 size={10} className="shrink-0 text-[var(--color-success)]" />
            : <Circle size={8} className="shrink-0 text-[var(--color-text-muted)]" />}
          current={current ? 'page' : undefined} active={current}
          onPrimary={() => onOpenDraft(chapter.chapterNumber, chapter.chapterTitle, chapter.draftId)}
          onPrimaryKeyDown={event => {
            if (!onReorderChapter || !draggable || !event.altKey) return
            const target = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : index
            if (target < 0 || target >= chapters.length || target === index) return
            event.preventDefault()
            onReorderChapter(chapter.chapterNumber, volumeNumber, target)
          }}
          leadingButton={<button type="button" onClick={toggleScenes} className="icon-btn size-[32px] shrink-0"
            aria-expanded={scenesOpen} aria-controls={scenesId}
            aria-label={t(scenesOpen ? 'scene.collapse' : 'scene.expand')} title={t(scenesOpen ? 'scene.collapse' : 'scene.expand')}>
            {scenesOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>}
        />
      </div>
      <div id={scenesId} hidden={!scenesOpen}>{scenesOpen && <SceneList chapterNumber={chapter.chapterNumber} />}</div>
    </div>
  )
}
