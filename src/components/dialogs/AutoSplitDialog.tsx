/**
 * AutoSplitDialog — 分卷自动划分弹框
 *
 * 按卷数均分全书章节（余数分散前卷），实时预览每卷范围，
 * 确认后批量创建分卷（已存在的卷号跳过，不覆盖）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { splitChaptersIntoVolumes, type VolumeSplitResult } from '../../services/volume-utils'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'

interface Props {
  isOpen: boolean
  onClose: () => void
  /** 全书章节数（划分范围） */
  totalChapters: number
  /** 已存在的卷号（划分时跳过，避免覆盖用户手建卷） */
  existingNumbers: number[]
  /** 确认应用划分（返回创建数/跳过数） */
  onApply: (splits: VolumeSplitResult[]) => Promise<void>
}

export default function AutoSplitDialog({ isOpen, onClose, totalChapters, existingNumbers, onApply }: Props) {
  const { t } = useTranslation()
  const [volumeCount, setVolumeCount] = useState<number | ''>(4)
  const [applying, setApplying] = useState(false)
  const prevOpenRef = useRef(false)

  // 仅在「打开瞬间」重置卷数（微任务惯例）。
  // 不能每次 totalChapters 变化都重置——summary 异步加载完成会触发 0→N，
  // 会把用户已输入的卷数冲掉
  useEffect(() => {
    let mounted = true
    if (isOpen && !prevOpenRef.current) {
      Promise.resolve().then(() => {
        if (mounted) {
          setVolumeCount(Math.min(4, Math.max(1, totalChapters)))
          setApplying(false)
        }
      })
    }
    prevOpenRef.current = isOpen
    return () => { mounted = false }
  }, [isOpen, totalChapters])

  const splits = useMemo(() => {
    const n = Number(volumeCount)
    if (!n || n < 1 || totalChapters < 1) return []
    return splitChaptersIntoVolumes(totalChapters, n)
  }, [volumeCount, totalChapters])

  // 已有卷号集合（预览时标注跳过）
  const existingSet = useMemo(() => new Set(existingNumbers), [existingNumbers])
  const skipCount = splits.filter(s => existingSet.has(s.volumeNumber)).length

  const handleApply = async () => {
    if (splits.length === 0) return
    setApplying(true)
    try {
      await onApply(splits)
      onClose()
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && !applying && onClose()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers size={16} className="text-[var(--color-accent)]" />
            {t('volume.splitTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('volume.splitDesc').replace('{n}', String(totalChapters))}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center gap-3">
            <Label className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--color-text)' }}>
              {t('volume.volumeCount')}
            </Label>
            <Input
              type="number" min={1} max={Math.max(1, totalChapters)}
              value={volumeCount}
              onChange={e => setVolumeCount(e.target.value === '' ? '' : parseInt(e.target.value))}
              className="w-24"
            />
            <span className="text-[0.65rem] opacity-50">
              {t('volume.splitMax').replace('{n}', String(Math.max(1, totalChapters)))}
            </span>
          </div>

          {/* 划分预览 */}
          {splits.length > 0 && (
            <div
              className="rounded-lg border max-h-[220px] overflow-y-auto p-2 space-y-1"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}
            >
              {splits.map(s => {
                const skipped = existingSet.has(s.volumeNumber)
                return (
                  <div
                    key={s.volumeNumber}
                    className="flex items-center gap-2 text-[0.7rem] px-1.5 py-1 rounded"
                    style={{
                      backgroundColor: skipped ? 'rgba(var(--color-warning-rgb), 0.08)' : 'transparent',
                      color: skipped ? 'var(--color-warning)' : 'var(--color-text-secondary)',
                    }}
                  >
                    <span className="font-medium flex-shrink-0">
                      {t('volume.ordinal').replace('{n}', String(s.volumeNumber))}
                    </span>
                    <span className="opacity-70 flex-shrink-0">
                      {t('volume.chapters').replace('{start}', String(s.chapterStart)).replace('{end}', String(s.chapterEnd))}
                    </span>
                    {skipped && (
                      <span className="ml-auto opacity-60">{t('volume.splitSkip')}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={applying}>{t('action.cancel')}</Button>
          <Button variant="default" onClick={handleApply} disabled={applying || splits.length === 0}>
            <Layers size={13} />
            {t('volume.splitApply')}{skipCount > 0 ? `（${t('volume.splitSkipCount').replace('{n}', String(skipCount))}）` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
