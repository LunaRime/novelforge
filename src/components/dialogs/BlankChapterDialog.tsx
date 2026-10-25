import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Spinner } from '../ui/Spinner'
import { toast } from '../ui/Toast'
import { useTranslation } from '../../hooks/useTranslation'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../../services/ipc-client'
import { createBlankChapter } from '../../services/blank-chapter-service'
import { openDraftById } from '../panels/sidebar/SidebarShared'

interface Props {
  open: boolean
  onClose: () => void
}

/** 写作优先入口：不经过 AI，创建空白草稿并直接打开 */
export default function BlankChapterDialog({ open, onClose }: Props) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((s) => s.currentProject)
  const [chapterNumber, setChapterNumber] = useState<number | ''>(1)
  const [title, setTitle] = useState('')
  const [loadingDefault, setLoadingDefault] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // 放到宏任务里：effect 内同步 setState 会触发级联渲染（react-hooks/set-state-in-effect）
    const timer = setTimeout(async () => {
      setLoadingDefault(true)
      setTitle('')
      if (!currentProject) {
        if (!cancelled) { setChapterNumber(1); setLoadingDefault(false) }
        return
      }
      try {
        const [blueprints, draftChapterNums] = await Promise.all([
          ipc.invoke('db:blueprint-get-all'),
          ipc.invoke('db:draft-get-all-chapter-numbers'),
        ])
        const maxBlueprint = (blueprints as Array<{ chapterNumber?: number }>)
          .reduce((max, bp) => Math.max(max, bp.chapterNumber ?? 0), 0)
        const maxDraft = (draftChapterNums as number[])
          .reduce((max, n) => Math.max(max, n), 0)
        if (!cancelled) setChapterNumber(Math.max(maxBlueprint, maxDraft) + 1)
      } catch {
        if (!cancelled) setChapterNumber(1)
      } finally {
        if (!cancelled) setLoadingDefault(false)
      }
    }, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, currentProject])

  const submit = async () => {
    if (!currentProject) return
    const number = typeof chapterNumber === 'number' ? chapterNumber : Number(chapterNumber)
    if (!Number.isInteger(number) || number < 1) {
      toast.error(t('blankChapter.invalidNumber'))
      return
    }
    setSubmitting(true)
    try {
      const result = await createBlankChapter({
        chapterNumber: number,
        title: title.trim() || undefined,
      })
      const opened = await openDraftById({
        draftId: result.draftId,
        chapterNumber: result.chapterNumber,
        chapterTitle: result.title || title.trim() || undefined,
        version: result.version,
      })
      if (!opened) throw new Error('failed to open draft')
      toast.success(result.kind === 'created' ? t('blankChapter.created') : t('blankChapter.exists'))
      onClose()
    } catch (e) {
      toast.error(t('blankChapter.failed').replace('{error}', e instanceof Error ? e.message : String(e)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('dialog.newBlankChapter')}</DialogTitle>
          <DialogDescription>{t('dialog.blankChapterDesc')}</DialogDescription>
        </DialogHeader>

        {!currentProject ? (
          <div className="px-6 py-6 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('blankChapter.noProject')}
          </div>
        ) : (
          <div className="space-y-3 px-6 py-4">
            <label className="block">
              <span className="mb-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('dialog.chapterNumber')}
              </span>
              <Input
                type="number"
                min={1}
                value={chapterNumber}
                onChange={(e) => setChapterNumber(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('dialog.chapterTitle')}
              </span>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('dialog.chapterTitlePlaceholder')}
              />
            </label>
            <p className="text-micro" style={{ color: 'var(--color-text-muted)' }}>
              {t('blankChapter.hint')}
            </p>
          </div>
        )}

        <DialogFooter className="justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('action.cancel')}</Button>
          <Button
            variant="default"
            onClick={() => void submit()}
            disabled={!currentProject || submitting || loadingDefault}
          >
            {submitting && <Spinner size={12} />}
            {submitting ? t('dialog.creatingChapter') : t('dialog.createAndWrite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}