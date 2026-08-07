/**
 * PublicationGroup — 连载监控（项目结构侧栏组）
 *
 * 本地优先：作者手动粘贴平台章节正文（不自动抓取），与本地定稿对比相似度
 * （字符频率 Dice）+ 审计告警（术语/水文）。相似度徽标分色提示平台删改风险。
 */
import { useState, useEffect } from 'react'
import { Satellite, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from '../../../hooks/useTranslation'
import { ipc } from '../../../services/ipc-client'
import { toast } from '../../ui/Toast'
import { confirm } from '../../ui/Confirm'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Label } from '../../ui/Label'
import { Textarea } from '../../ui/Textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../../ui/Dialog'
import SidebarGroup from './SidebarGroup'
import type { PublicationEntry } from '../../../../electron/repositories/publication-repository'

interface Props {
  /** 项目路径（项目切换时组件重挂载重新加载） */
  projectPath: string
}

export default function PublicationGroup({ projectPath }: Props) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<PublicationEntry[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = async () => {
    try {
      setEntries(await ipc.invoke('db:publication-list'))
    } catch { /* 无项目/表缺失静默 */ }
  }

  useEffect(() => {
    if (!projectPath) return
    let mounted = true
    Promise.resolve().then(() => { if (mounted) void load() })
    return () => { mounted = false }
  }, [projectPath])

  /** 相似度徽标色：≥0.9 绿（一致）/ ≥0.5 黄（有差异）/ 低 红（大幅改） */
  const simColor = (s: number) => {
    if (s >= 0.9) return 'var(--color-success)'
    if (s >= 0.5) return 'var(--color-warning)'
    return 'var(--color-danger)'
  }

  const handleDelete = async (e: PublicationEntry) => {
    const ok = await confirm(t('pub.deleteConfirm').replace('{n}', String(e.chapterNumber)), { danger: true })
    if (!ok) return
    await ipc.invoke('db:publication-delete', e.chapterNumber)
    void load()
  }

  return (
    <div className="mt-1.5">
      <SidebarGroup
        icon={<Satellite size={12} />}
        title={t('pub.title')}
        count={entries.length > 0 ? String(entries.length) : undefined}
        defaultOpen={false}
        actions={
          <button
            type="button"
            className="p-0.5 rounded transition-colors hover:opacity-80 cursor-pointer flex-shrink-0"
            title={t('pub.import')}
            onClick={() => setDialogOpen(true)}
            style={{ color: 'var(--color-accent)' }}
          >
            <Plus size={12} />
          </button>
        }
      >
        {/* 紧凑列表：章节号/标题 + 相似度/告警徽标 + 删除（与 VolumeGroup 列表行风格一致） */}
        {entries.length === 0 ? (
          <div className="px-1.5 py-1 text-[0.68rem]" style={{ color: 'var(--color-text-muted)' }}>
            {t('pub.empty')}
          </div>
        ) : (
          <div className="mt-1.5 space-y-0.5">
            {entries.map((e) => (
              <div key={e.chapterNumber} className="flex items-center gap-1.5 px-1.5 py-1 rounded group" style={{ backgroundColor: 'var(--color-hover)' }}>
                <span className="text-[0.7rem] flex-1 truncate" style={{ color: 'var(--color-text)' }}>
                  {t('pub.chapterLabel').replace('{n}', String(e.chapterNumber))}
                  {e.externalTitle ? ` · ${e.externalTitle}` : ''}
                </span>
                <span
                  className="text-[0.62rem] px-1 py-0.5 rounded flex-shrink-0"
                  style={{ backgroundColor: 'var(--color-panel)', color: simColor(e.similarity) }}
                  title={t('pub.similarity').replace('{p}', String(Math.round(e.similarity * 100)))}
                >
                  {Math.round(e.similarity * 100)}%
                </span>
                {e.auditIssues > 0 && (
                  <span
                    className="text-[0.62rem] px-1 py-0.5 rounded flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-panel)', color: 'var(--color-warning)' }}
                    title={t('pub.auditIssues').replace('{n}', String(e.auditIssues))}
                  >
                    {e.auditIssues}
                  </span>
                )}
                <button
                  type="button"
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  title={t('action.delete')}
                  onClick={() => void handleDelete(e)}
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </SidebarGroup>

      <PublishImportDialog
        isOpen={dialogOpen}
        onClose={() => { setDialogOpen(false); void load() }}
        existingNumbers={entries.map(e => e.chapterNumber)}
      />
    </div>
  )
}

/** 导入弹窗：章节号/标题/平台正文（保存时主进程对比本地定稿 + 审计） */
function PublishImportDialog({ isOpen, onClose, existingNumbers }: {
  isOpen: boolean
  onClose: () => void
  existingNumbers: number[]
}) {
  const { t } = useTranslation()
  const [chapterNumber, setChapterNumber] = useState<number | ''>(1)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    if (isOpen) {
      Promise.resolve().then(() => {
        if (!mounted) return
        setChapterNumber((Math.max(0, ...existingNumbers) + 1) || 1)
        setTitle('')
        setContent('')
      })
    }
    return () => { mounted = false }
  }, [isOpen, existingNumbers])

  const handleSave = async () => {
    if (!chapterNumber || !content.trim()) return
    setSaving(true)
    try {
      // 术语：角色名（与内容审计一致的最小术语集）
      let terms: string[] = []
      try {
        const chars = await ipc.invoke('db:character-get-all') as Array<{ name: string }>
        terms = chars.map(c => c.name).filter(Boolean)
      } catch { /* 术语获取失败不阻断（仅审计缺失） */ }
      const res = await ipc.invoke('db:publication-save', {
        chapterNumber,
        title,
        content,
        terms,
      })
      if (!res.success) throw new Error(res.error || 'save failed')
      toast.success(t('pub.saveSuccess').replace('{n}', String(chapterNumber)))
      onClose()
    } catch (e) {
      toast.error(t('pub.saveFailed').replace('{error}', String(e)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pub.import')}</DialogTitle>
          <DialogDescription>{t('pub.importHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('pub.chapterNumber')}</Label>
              <Input
                type="number"
                min={1}
                value={chapterNumber}
                onChange={(e) => setChapterNumber(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
              />
            </div>
            <div>
              <Label>{t('pub.externalTitle')}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('pub.externalTitlePlaceholder')} />
            </div>
          </div>
          <div>
            <Label>{t('pub.externalContent')}</Label>
            <Textarea
              className="min-h-[160px]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('pub.externalContentPlaceholder')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="ai" onClick={() => void handleSave()} disabled={saving || !content.trim()}>
            {saving ? t('status.saving') : t('action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
