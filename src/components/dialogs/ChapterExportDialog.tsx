/**
 * ChapterExportDialog — 已定稿章节导出对话框
 *
 * 层级结构：
 *   顶层：ZIP 压缩包 / 文件夹
 *   子级：.md (Markdown) / .txt (纯文本)
 */
import { useState, useMemo } from 'react'
import { Download, FolderArchive, FolderOpen, FileText, Check, Loader2 } from 'lucide-react'
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

  const isBatch = chapterNumbers.length !== 1
  const displayChapters = useMemo(() => {
    return chapterNumbers.map(cn => ({
      number: cn,
      title: chapterTitles[cn] || t('chapter.label').replace('{n}', String(cn)),
    }))
  }, [chapterNumbers, chapterTitles, t])

  const doExport = async () => {
    if (!project) return
    setExporting(true)
    try {
      const outputDir = await ipc.invoke('export:select-output-dir')
      if (!outputDir) { setExporting(false); return }

      const result = await ipc.invoke('export:export-chapters', {
        chapterNumbers: chapterNumbers.length > 0 ? chapterNumbers : undefined,
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

        {/* 章节预览 */}
        <div className="px-5 py-3">
          <div className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>
            {t('export.chapterPreview')}
            <span className="ml-1 font-normal" style={{ color: 'var(--color-text-muted)' }}>
              ({displayChapters.length})
            </span>
          </div>
          <div
            className="max-h-32 overflow-y-auto rounded-lg border p-2 space-y-0.5"
            style={{
              backgroundColor: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border)',
            }}
          >
            {displayChapters.slice(0, 10).map(ch => (
              <div key={ch.number} className="flex items-center gap-2 text-xs py-0.5">
                <FileText size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {t('chapter.label').replace('{n}', String(ch.number))} {ch.title}
                </span>
              </div>
            ))}
            {displayChapters.length > 10 && (
              <div className="text-xs pt-1" style={{ color: 'var(--color-text-muted)' }}>
                ...{t('export.andMore').replace('{n}', String(displayChapters.length - 10))}
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
