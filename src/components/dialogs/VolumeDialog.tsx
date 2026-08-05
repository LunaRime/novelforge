/**
 * VolumeDialog — 分卷新建/编辑弹框
 *
 * 字段：卷号（唯一）/ 卷标题 / 卷简介 / 起始章节 / 结束章节（0 = 进行中）。
 * 校验：卷号 ≥ 1、起始 ≥ 1、结束 ≥ 起始 或 0。
 */
import { useEffect, useState } from 'react'
import { BookMarked } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { toast } from '../ui/Toast'
import { renderLog } from '../../services/render-logger'
import { useVolumeStore } from '../../stores/volume-store'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Textarea } from '../ui/Textarea'
import type { VolumeData } from '../../../electron/repositories/volume-repository'

interface Props {
  isOpen: boolean
  onClose: () => void
  /** 编辑目标（null = 新建） */
  editing: VolumeData | null
  /** 已存在卷号集合（新建时校验唯一性） */
  existingNumbers: number[]
}

export default function VolumeDialog({ isOpen, onClose, editing, existingNumbers }: Props) {
  const { t } = useTranslation()
  const upsert = useVolumeStore(s => s.upsert)

  const [volumeNumber, setVolumeNumber] = useState<number | ''>(1)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [chapterStart, setChapterStart] = useState<number | ''>(1)
  const [chapterEnd, setChapterEnd] = useState<number | ''>(0)
  const [saving, setSaving] = useState(false)

  // 打开时初始化表单（编辑 = 回填；新建 = 默认下一卷号）
  // setState 放入微任务（项目惯例：effect 内同步 setState 被 ESLint 拦截）
  useEffect(() => {
    let mounted = true
    if (isOpen) {
      Promise.resolve().then(() => {
        if (!mounted) return
        if (editing) {
          setVolumeNumber(editing.volumeNumber)
          setTitle(editing.title)
          setDescription(editing.description)
          setChapterStart(editing.chapterStart || 1)
          setChapterEnd(editing.chapterEnd || 0)
        } else {
          const next = (Math.max(0, ...existingNumbers) + 1) || 1
          setVolumeNumber(next)
          setTitle('')
          setDescription('')
          setChapterStart(1)
          setChapterEnd(0)
        }
        setSaving(false)
      })
    }
    return () => { mounted = false }
  }, [isOpen, editing, existingNumbers])

  const handleSave = async () => {
    const num = Number(volumeNumber)
    const start = Number(chapterStart)
    const end = Number(chapterEnd)

    // 校验：卷号 ≥ 1；起始 ≥ 1；结束 0 或 ≥ 起始
    if (!num || num < 1) {
      toast.warning(t('volume.invalidRange'))
      return
    }
    if (!start || start < 1 || (end !== 0 && end < start)) {
      toast.warning(t('volume.invalidRange'))
      return
    }
    // 新建时卷号唯一性
    if (!editing && existingNumbers.includes(num)) {
      toast.warning(t('volume.invalidRange'))
      return
    }

    setSaving(true)
    const ok = await upsert({
      volumeNumber: num,
      title: title.trim(),
      description: description.trim(),
      chapterStart: start,
      chapterEnd: end,
    })
    setSaving(false)
    if (ok) {
      // 保存行为日志流（视觉反馈已有 toast.success）
      renderLog('info', 'Save:Volume', `分卷保存成功 第${num}卷「${title.trim()}」（${editing ? '编辑' : '新建'}）`)
      onClose()
      toast.success(editing ? t('volume.editVolume') : t('volume.newVolume'))
    } else {
      renderLog('error', 'Save:Volume', `分卷保存失败 第${num}卷: DB 写入失败`)
      toast.error(t('volume.saveFailed').replace('{error}', 'DB'))
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookMarked size={16} className="text-[var(--color-accent)]" />
            {editing ? t('volume.dialogEdit') : t('volume.dialogNew')}
          </DialogTitle>
          <DialogDescription>
            {t('volume.title')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--color-text)' }}>
                {t('volume.number')}
              </Label>
              <Input
                type="number" min={1}
                value={volumeNumber}
                // 编辑模式禁用卷号：卷号是主键（UNIQUE），改号会残留旧行（重复卷）
                // 或覆盖已存在卷（数据错乱）——只允许新建时指定
                disabled={!!editing}
                onChange={e => setVolumeNumber(e.target.value === '' ? '' : parseInt(e.target.value))}
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--color-text)' }}>
                {t('volume.name')}
              </Label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={t('volume.namePlaceholder')}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--color-text)' }}>
              {t('volume.range')}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number" min={1}
                value={chapterStart}
                onChange={e => setChapterStart(e.target.value === '' ? '' : parseInt(e.target.value))}
                className="w-20"
              />
              <span className="text-xs opacity-50">—</span>
              <Input
                type="number" min={0}
                value={chapterEnd}
                onChange={e => setChapterEnd(e.target.value === '' ? '' : parseInt(e.target.value))}
                className="w-20"
              />
              <span className="text-[0.65rem] opacity-50">{t('volume.endHint')}</span>
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--color-text)' }}>
              {t('volume.description')}
            </Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('action.cancel')}</Button>
          <Button variant="default" onClick={handleSave} disabled={saving}>
            <BookMarked size={13} />
            {t('action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
