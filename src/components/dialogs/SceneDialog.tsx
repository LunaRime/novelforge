/**
 * SceneDialog — 场景卡新建/编辑弹框（计划书 工作流 E）
 *
 * 字段：标题（必填）/ 概要 / 状态（planned | writing | done）。
 * 字数与 contentId 不在弹框里改：字数由正文统计回填，contentId 由后续「场景正文」接入。
 */
import { useEffect, useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { toast } from '../ui/Toast'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Textarea } from '../ui/Textarea'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { upsertScene, type SceneItem } from '../../services/scene-service'

interface Props {
  isOpen: boolean
  onClose: () => void
  chapterNumber: number
  /** 编辑目标（null = 新建） */
  editing: SceneItem | null
  /** 新建时追加到该顺序位（已有场景最大 sortOrder + 10） */
  nextSortOrder: number
  /** 保存成功后通知列表重载 */
  onSaved?: () => void
}

const STATUSES = [
  { value: 'planned', labelKey: 'scene.statusPlanned' },
  { value: 'writing', labelKey: 'scene.statusWriting' },
  { value: 'done', labelKey: 'scene.statusDone' },
] as const

export default function SceneDialog({ isOpen, onClose, chapterNumber, editing, nextSortOrder, onSaved }: Props) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [status, setStatus] = useState<string>('planned')
  const [saving, setSaving] = useState(false)

  // 打开时回填（微任务里 setState：effect 内同步 setState 会触发 eslint 规则）
  useEffect(() => {
    if (!isOpen) return
    let mounted = true
    Promise.resolve().then(() => {
      if (!mounted) return
      setTitle(editing?.title ?? '')
      setSummary(editing?.summary ?? '')
      setStatus(editing?.status ?? 'planned')
      setSaving(false)
    })
    return () => { mounted = false }
  }, [isOpen, editing])

  const handleSave = async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      toast.warning(t('scene.invalidTitle'))
      return
    }
    setSaving(true)
    const res = await upsertScene({
      id: editing?.id,
      chapterNumber,
      title: trimmed,
      summary: summary.trim(),
      status,
      sortOrder: editing?.sortOrder ?? nextSortOrder,
      wordCount: editing?.wordCount ?? 0,
      contentId: editing?.contentId ?? null,
    })
    setSaving(false)
    if (res.success) {
      toast.success(editing ? t('scene.editScene') : t('scene.newScene'))
      onSaved?.()
      onClose()
    } else {
      toast.error(t('scene.saveFailed').replace('{error}', res.error ?? 'DB'))
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clapperboard size={16} className="text-[var(--color-accent)]" />
            {editing ? t('scene.dialogEdit') : t('scene.dialogNew')}
          </DialogTitle>
          <DialogDescription>
            {t('chapter.label').replace('{n}', String(chapterNumber))}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          <div>
            <Label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--color-text)' }}>
              {t('scene.name')}
            </Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('scene.namePlaceholder')}
              autoFocus
            />
          </div>

          <div>
            <Label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--color-text)' }}>
              {t('scene.status')}
            </Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => (
                  <SelectItem key={s.value} value={s.value}>
                    {t(s.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--color-text)' }}>
              {t('scene.summary')}
            </Label>
            <Textarea
              value={summary}
              onChange={e => setSummary(e.target.value)}
              rows={4}
              className="text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('action.cancel')}</Button>
          <Button variant="default" onClick={handleSave} disabled={saving}>
            <Clapperboard size={13} />
            {t('action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
