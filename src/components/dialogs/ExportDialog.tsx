import { useState } from 'react'
import { Download, FileText, Files, Type } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { exportNovel, type ExportFormat } from '../../services/export-service'
import { ipc } from '../../services/ipc-client'
import { t } from '../../shared/locale'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

interface Props {
  isOpen: boolean
  onClose: () => void
}

/** 导出对话框 — 使用 shadcn/ui */
export default function ExportDialog({ isOpen, onClose }: Props) {
  const currentProject = useProjectStore(s => s.currentProject)
  const [format, setFormat] = useState<ExportFormat>('merged-md')
  const [includeOutline, setIncludeOutline] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; path?: string; error?: string } | null>(null)

  const handleExport = async () => {
    if (!currentProject) return
    const dir = await ipc.invoke('dialog:select-folder')
    if (!dir) return

    setExporting(true)
    setResult(null)
    const res = await exportNovel({ format, outputDir: dir, includeOutline })
    setResult(res)
    setExporting(false)
  }

  function getFormatOptions() {
    return [
      { value: 'merged-md' as ExportFormat, label: t('export.mergedMD'), desc: t('export.mergedDesc'), icon: <FileText size={18} /> },
      { value: 'split-md' as ExportFormat, label: t('export.perChapterMD'), desc: t('export.perChapterDesc'), icon: <Files size={18} /> },
      { value: 'txt' as ExportFormat, label: t('export.plainText'), desc: t('export.txtDesc'), icon: <Type size={18} /> },
    ]
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download size={16} className="text-[var(--color-accent)]" />
            {t('export.title')}
          </DialogTitle>
          <DialogDescription>{t('export.chooseFormat')}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-3">
          {/* 格式选择 */}
          <div className="space-y-2">
            {getFormatOptions().map((opt) => (
              <div
                key={opt.value}
                onClick={() => setFormat(opt.value)}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors border',
                  format === opt.value
                    ? 'bg-[var(--color-active)] border-[var(--color-accent)]'
                    : 'bg-[var(--color-panel)] border-[var(--color-border)] hover:bg-[var(--color-hover)]'
                )}
              >
                <div className={cn(
                  'transition-colors',
                  format === opt.value ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'
                )}>
                  {opt.icon}
                </div>
                <div>
                  <div className="text-xs font-medium text-[var(--color-text)]">{opt.label}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{opt.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 选项 */}
          <label className="flex items-center gap-2 text-xs cursor-pointer text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={includeOutline} onChange={(e) => setIncludeOutline(e.target.checked)} />
            {t('export.includeOutline')}
          </label>

          {/* 结果 */}
          {result && (
            <div className={cn(
              'p-3 rounded-lg text-xs',
              result.success ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
            )}>
              {result.success
                ? `✅ ${t('export.success').replace('{path}', result.path ?? '')}`
                : t('export.failed').replace('{error}', result.error ?? '')
              }
            </div>
          )}
        </div>

        <DialogFooter className="justify-end">
          <Button variant="default" onClick={handleExport} disabled={exporting}>
            <Download size={13} />
            {exporting ? t('status.saving') : t('export.chooseAndExport')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
