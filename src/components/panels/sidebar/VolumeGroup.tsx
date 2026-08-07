/**
 * VolumeGroup — 分卷管理组（工作台 / 项目结构共用）
 *
 * 标题行：分卷 + 数量 + 新建（+） + 自动划分（Layers）
 * 卷列表：第N卷「标题」+ 章节范围 + 定稿进度徽标 + 编辑/删除 → 展开卷内章节
 * 数据：useVolumeStore；卷内章节由调用方注入（工作台用 summary、项目结构用 draftsByChapter）
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight, ChevronDown, BookMarked, Plus, Pencil, Trash2, Layers,
  CheckCircle2, Circle,
} from 'lucide-react'
import { useVolumeStore } from '../../../stores/volume-store'
import { globalEventBus } from '../../../shared/event-bus'
import type { VolumeData } from '../../../../electron/repositories/volume-repository'
import type { VolumeSplitResult } from '../../../services/volume-utils'
import VolumeDialog from '../../dialogs/VolumeDialog'
import AutoSplitDialog from '../../dialogs/AutoSplitDialog'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import { useTranslation } from '../../../hooks/useTranslation'

/** 卷内章节统一格式（工作台 summary / 项目结构 drafts 转换后传入） */
export interface VolumeChapter {
  chapterNumber: number
  chapterTitle?: string
  hasFinalized: boolean
}

interface VolumeGroupProps {
  /** 项目路径（分卷数据随项目切换重载） */
  projectPath?: string
  /** 注入卷内章节（调用方各自数据源） */
  chaptersForVolume: (volume: VolumeData) => VolumeChapter[]
  /** 点击卷内章节（打开草稿） */
  onOpenDraft: (chapterNumber: number, chapterTitle?: string) => void
  /** 每卷的已定稿章节数（进度徽标） */
  finalizedCountForVolume: (volume: VolumeData) => number
  /** 自动划分的章节总数（0 = 隐藏自动划分按钮） */
  totalChapters?: number
}

export default function VolumeGroup({
  projectPath,
  chaptersForVolume,
  onOpenDraft,
  finalizedCountForVolume,
  totalChapters = 0,
}: VolumeGroupProps) {
  const { t } = useTranslation()
  const volumes = useVolumeStore(s => s.volumes)
  const loadVolumes = useVolumeStore(s => s.load)
  const removeVolume = useVolumeStore(s => s.remove)
  const upsertVolume = useVolumeStore(s => s.upsert)
  const [open, setOpen] = useState(false)
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
    <section
      className="rounded-xl border p-2.5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <BookMarked size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
          {t('volume.title')}
        </span>
        <span className="ml-auto text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
          {volumes.length}
        </span>
        {totalChapters > 0 && (
          <button
            type="button"
            onClick={() => setAutoSplitOpen(true)}
            className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
            style={{ color: 'var(--color-text-muted)' }}
            title={t('volume.autoSplit')}
          >
            <Layers size={12} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setVolumeDialog({ open: true, editing: null })}
          className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          title={t('volume.newVolume')}
        >
          <Plus size={12} />
        </button>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          title={open ? t('action.close') : t('action.open')}
        >
          {open
            ? <ChevronDown size={12} />
            : <ChevronRight size={12} />}
        </button>
      </div>

      {!open ? null : volumes.length === 0 ? (
        <div className="text-[0.65rem] py-1 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
          {t('volume.empty')}
        </div>
      ) : (
        <div className="space-y-1">
          {volumes.map(v => (
            <VolumeRow
              key={v.volumeNumber}
              volume={v}
              chapters={chaptersForVolume(v)}
              doneCount={finalizedCountForVolume(v)}
              onEdit={() => setVolumeDialog({ open: true, editing: v })}
              onDelete={() => handleDeleteVolume(v)}
              onOpenDraft={onOpenDraft}
            />
          ))}
        </div>
      )}

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
}: {
  volume: VolumeData
  chapters: VolumeChapter[]
  doneCount: number
  onEdit: () => void
  onDelete: () => void
  onOpenDraft: (chapterNumber: number, chapterTitle?: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

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
    <div className="rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
      <div
        className="flex items-center gap-1.5 px-1.5 py-1.5 cursor-pointer select-none"
        onClick={() => setOpen(v => !v)}
        title={volume.description || undefined}
      >
        {open
          ? <ChevronDown size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          : <ChevronRight size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />}
        <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
          {volume.title
            ? t('volume.ordinalTitle').replace('{n}', String(volume.volumeNumber)).replace('{title}', volume.title)
            : t('volume.ordinal').replace('{n}', String(volume.volumeNumber))}
        </span>
        <span className="ml-auto text-[0.6rem] opacity-50 flex-shrink-0">{rangeText}</span>
        <span
          className="text-[0.6rem] flex-shrink-0"
          style={{ color: doneAll ? 'var(--color-success)' : 'var(--color-text-muted)' }}
        >
          {progressText}
        </span>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          title={t('volume.editVolume')}
          onClick={(e) => { e.stopPropagation(); onEdit() }}
        >
          <Pencil size={10} />
        </button>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          title={t('action.delete')}
          onClick={(e) => { e.stopPropagation(); onDelete() }}
        >
          <Trash2 size={10} />
        </button>
      </div>

      {/* 卷内章节（有草稿的章） */}
      {open && (
        <div className="pl-2 pr-1.5 pb-1.5 space-y-0.5">
          {chapters.length === 0 ? (
            <div className="text-[0.65rem] py-1 pl-1.5 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
              {t('charList.emptyProject')}
            </div>
          ) : chapters.map(dc => (
            <button
              key={dc.chapterNumber}
              type="button"
              onClick={() => onOpenDraft(dc.chapterNumber, dc.chapterTitle)}
              className="w-full flex items-center gap-1.5 py-1 px-1.5 rounded-lg text-[0.7rem] text-left transition-colors cursor-pointer hover:bg-[var(--color-hover)]"
              style={{ color: 'var(--color-text-secondary)' }}
              title={t('action.openDraft')}
            >
              {dc.hasFinalized
                ? <CheckCircle2 size={10} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                : <Circle size={7} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />}
              <span className="truncate">
                {t('chapter.label').replace('{n}', String(dc.chapterNumber))}
                {dc.chapterTitle ? ` ${dc.chapterTitle}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
