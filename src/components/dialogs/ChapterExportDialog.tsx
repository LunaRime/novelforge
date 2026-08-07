/**
 * ChapterExportDialog — 已定稿章节导出对话框
 *
 * 层级结构：
 *   顶层：ZIP 压缩包 / 文件夹
 *   子级：.md (Markdown) / .txt (纯文本)
 */
import { useState, useMemo, useEffect } from 'react'
import { Download, FolderArchive, FolderOpen, FileText, Check, Loader2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import { useProjectStore } from '../../stores/project-store'
import { toast } from '../ui/Toast'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'

export interface ChapterExportDialogProps {
  chapterNumbers: number[]
  chapterTitles: Record<number, string>
  open: boolean
  onClose: () => void
}

export type ExportFormat = 'zip' | 'folder'
export type FileFormat = 'md' | 'txt'

export default function ChapterExportDialog({ chapterNumbers, chapterTitles, open, onClose }: ChapterExportDialogProps) {
  const { t } = useTranslation()
  const project = useProjectStore.getState().currentProject
  const [format, setFormat] = useState<ExportFormat>('zip')
  const [fileFormat, setFileFormat] = useState<FileFormat>('md')
  const [exporting, setExporting] = useState(false)
  /** 排序：按章节号 / 标题 × 升/降序 */
  const [sortKey, setSortKey] = useState<'number' | 'title'>('number')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  /** 选中章节集合（默认全选；打开时重置） */
  const [selected, setSelected] = useState<Set<number>>(() => new Set(chapterNumbers))

  // 打开时重置选中为全选（批量场景；微任务绕行 effect 同步 setState 惯例）
  useEffect(() => {
    let mounted = true
    if (open) {
      Promise.resolve().then(() => { if (mounted) setSelected(new Set(chapterNumbers)) })
    }
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打开时按传入章节初始化
  }, [open])

  const isBatch = chapterNumbers.length !== 1
  const displayChapters = useMemo(() => {
    return chapterNumbers.map(cn => ({
      number: cn,
      title: chapterTitles[cn] || t('chapter.label').replace('{n}', String(cn)),
    }))
  }, [chapterNumbers, chapterTitles, t])

  /** 排序后的章节列表 */
  const sortedChapters = useMemo(() => {
    const arr = [...displayChapters]
    arr.sort((a, b) => {
      const diff = sortKey === 'number' ? a.number - b.number : a.title.localeCompare(b.title)
      return sortDir === 'asc' ? diff : -diff
    })
    return arr
  }, [displayChapters, sortKey, sortDir])

  const toggleSelect = (number: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(number)) next.delete(number)
      else next.add(number)
      return next
    })
  }

  const toggleSort = (key: 'number' | 'title') => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const doExport = async () => {
    if (!project) return
    setExporting(true)
    try {
      const outputDir = await ipc.invoke('export:select-output-dir')
      if (!outputDir) { setExporting(false); return }

      const result = await ipc.invoke('export:export-chapters', {
        chapterNumbers: selected.size > 0 ? [...selected].sort((a, b) => a - b) : undefined,
        format,
        fileFormat,
        outputPath: outputDir,
        projectName: project.name,
      })

      if (result.success) {
        toast.show({
          type: 'success',
          message: t('export.chapterSuccess').replace('{count}', String(result.chapterCount || 0)),
        })
        onClose()
      } else {
        toast.show({
          type: 'warning',
          message: result.error || t('status.unknown'),
        })
      }
    } catch (e) {
      toast.show({
        type: 'warning',
        message: String(e),
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download size={16} className="text-[var(--color-accent)]" />
            {isBatch
              ? t('export.batchTitle').replace('{n}', String(chapterNumbers.length))
              : t('export.singleTitle').replace('{n}', displayChapters[0]?.title || '')}
          </DialogTitle>
          <DialogDescription>
            {isBatch ? t('export.batchDesc') : t('export.singleDesc')}
          </DialogDescription>
        </DialogHeader>

        {/* 章节预览：排序 + 多选（点击行切换选中） */}
        <div className="px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                {t('export.chapterPreview')}
              </span>
              <span className="text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>
                ({t('export.selectedCount').replace('{n}', String(selected.size)).replace('{total}', String(displayChapters.length))})
              </span>
            </div>
            <div className="flex items-center gap-1">
              {/* 排序：章节号 / 标题 + 方向 */}
              <button
                type="button"
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[0.65rem] transition-colors"
                style={{ color: sortKey === 'number' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                onClick={() => toggleSort('number')}
              >
                {t('export.sortNumber')}
                {sortKey === 'number' ? (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
              </button>
              <button
                type="button"
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[0.65rem] transition-colors"
                style={{ color: sortKey === 'title' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                onClick={() => toggleSort('title')}
              >
                {t('export.sortTitle')}
                {sortKey === 'title' ? (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
              </button>
              {/* 全选 / 清空 */}
              <button
                type="button"
                className="px-1.5 py-0.5 rounded text-[0.65rem] transition-colors hover:opacity-80"
                style={{ color: 'var(--color-text-muted)' }}
                onClick={() => setSelected(new Set(displayChapters.map(c => c.number)))}
              >
                {t('export.selectAll')}
              </button>
              <button
                type="button"
                className="px-1.5 py-0.5 rounded text-[0.65rem] transition-colors hover:opacity-80"
                style={{ color: 'var(--color-text-muted)' }}
                onClick={() => setSelected(new Set())}
              >
                {t('export.selectNone')}
              </button>
            </div>
          </div>
          <div
            className="max-h-40 overflow-y-auto rounded-lg border p-1.5 space-y-0.5"
            style={{
              backgroundColor: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border)',
            }}
          >
            {sortedChapters.map(ch => {
              const checked = selected.has(ch.number)
              return (
                <div
                  key={ch.number}
                  className="flex items-center gap-2 text-xs py-1 px-1 rounded cursor-pointer transition-colors"
                  style={{ backgroundColor: checked ? 'rgba(var(--color-accent-rgb), 0.08)' : 'transparent' }}
                  onClick={() => toggleSelect(ch.number)}
                >
                  <span
                    className="flex items-center justify-center w-3.5 h-3.5 rounded border flex-shrink-0"
                    style={{ borderColor: checked ? 'var(--color-accent)' : 'var(--color-border)', backgroundColor: checked ? 'var(--color-accent)' : 'transparent' }}
                  >
                    {checked && <Check size={10} style={{ color: '#fff' }} />}
                  </span>
                  <FileText size={11} style={{ color: checked ? 'var(--color-accent)' : 'var(--color-text-muted)', flexShrink: 0 }} />
                  <span style={{ color: checked ? 'var(--color-text)' : 'var(--color-text-secondary)' }} className="truncate">
                    {t('chapter.label').replace('{n}', String(ch.number))} {ch.title}
                  </span>
                </div>
              )
            })}
            {sortedChapters.length === 0 && (
              <div className="text-xs py-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('export.noChapters')}
              </div>
            )}
          </div>
        </div>

        {/* ==== 导出格式（顶层） ==== */}
        <div className="px-5 pb-1">
          <div className="text-xs font-medium mb-2.5" style={{ color: 'var(--color-text)' }}>
            {t('export.formatLabel')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FormatCard
              selected={format === 'zip'}
              icon={<FolderArchive size={18} />}
              label={t('export.zipFormat')}
              desc={t('export.zipDesc')}
              onClick={() => setFormat('zip')}
            />
            <FormatCard
              selected={format === 'folder'}
              icon={<FolderOpen size={18} />}
              label={t('export.folderFormat')}
              desc={t('export.folderDesc')}
              onClick={() => setFormat('folder')}
            />
          </div>
        </div>

        {/* ==== 文件格式（子级） ==== */}
        <div className="px-5 pb-3">
          <div
            className="flex items-center rounded-lg border p-1 gap-0.5"
            style={{
              backgroundColor: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border)',
            }}
          >
            <FileFormatSegment
              label=".md"
              sub="Markdown"
              active={fileFormat === 'md'}
              onClick={() => setFileFormat('md')}
            />
            <FileFormatSegment
              label=".txt"
              sub={t('export.txtChapterFormat')}
              active={fileFormat === 'txt'}
              onClick={() => setFileFormat('txt')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={exporting}>
            {t('action.cancel')}
          </Button>
          <Button variant="ai" onClick={doExport} disabled={exporting}>
            {exporting ? (
              <>
                <Loader2 size={14} className="mr-1 animate-spin" />
                {t('status.generating')}
              </>
            ) : (
              <>
                <Download size={14} className="mr-1" />
                {t('action.export')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 顶层格式卡片 */
function FormatCard({
  selected, icon, label, desc, onClick,
}: {
  selected: boolean
  icon: React.ReactNode
  label: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      className="flex flex-col items-start gap-1.5 px-3 py-3 rounded-xl border-2 transition-all duration-150 cursor-pointer"
      style={{
        borderColor: selected ? 'var(--color-accent)' : 'var(--color-border)',
        backgroundColor: selected ? 'rgba(var(--color-accent-rgb), 0.08)' : 'var(--color-bg-elevated)',
      }}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center gap-2 w-full">
        <span style={{ color: selected ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
          {icon}
        </span>
        <span
          className="text-sm font-medium"
          style={{ color: selected ? 'var(--color-accent)' : 'var(--color-text)' }}
        >
          {label}
        </span>
        {selected && (
          <Check size={14} className="ml-auto flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
        )}
      </div>
      <span className="text-[0.65rem] leading-tight" style={{ color: 'var(--color-text-muted)' }}>
        {desc}
      </span>
    </button>
  )
}

/** 子级文件格式切换段 */
function FileFormatSegment({
  label, sub, active, onClick,
}: {
  label: string
  sub: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all duration-150 cursor-pointer"
      style={{
        backgroundColor: active ? 'var(--color-bg)' : 'transparent',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
        color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
        border: 'none',
      }}
      onClick={onClick}
      type="button"
    >
      <span
        className="text-xs font-mono font-bold"
        style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
      >
        {label}
      </span>
      <span className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
        {sub}
      </span>
    </button>
  )
}
