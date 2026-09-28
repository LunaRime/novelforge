/**
 * PublicationGroup — 连载监控（项目结构侧栏组）
 *
 * 本地优先：作者手动粘贴平台章节正文（不自动抓取），与本地定稿对比相似度
 * （字符频率 Dice）+ 审计告警（术语/水文）。相似度徽标分色提示平台删改风险。
 */
import { useState, useEffect } from 'react'
import { Satellite, Plus, Trash2 } from 'lucide-react'
import MenuRow from '../../ui/MenuRow'
import { useTranslation } from '../../../hooks/useTranslation'
import { ipc } from '../../../services/ipc-client'
import { useEditorStore } from '../../../stores/editor-store'
import { toast } from '../../ui/Toast'
import { confirm } from '../../ui/Confirm'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Label } from '../../ui/Label'
import { Textarea } from '../../ui/Textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../../ui/Dialog'
import type { PublicationEntry } from '../../../../electron/repositories/publication-repository'

interface Props {
  /** 项目路径（项目切换时组件重挂载重新加载） */
  projectPath: string
}

export default function PublicationGroup({ projectPath }: Props) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<PublicationEntry[]>([])
  const [open, setOpen] = useState(false)
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
    return 'var(--color-error)'
  }

  const handleDelete = async (e: PublicationEntry) => {
    const ok = await confirm(t('pub.deleteConfirm').replace('{n}', String(e.chapterNumber)), { danger: true })
    if (!ok) return
    await ipc.invoke('db:publication-delete', e.chapterNumber)
    void load()
  }

  /**
   * 打开平台章节正文到编辑器（只读标签页）。
   * 2026-09-27 可供性修复：行此前「hover 变色但无点击处理器」——正文随
   * `db:publication-list` 已返回（publication-repository.ts:26），无需新 IPC。
   * 与记忆文件同一约定：编辑器是唯一查看面，侧栏行只做导航。
   */
  const openEntry = (e: PublicationEntry) => {
    const label = t('pub.chapterLabel').replace('{n}', String(e.chapterNumber))
      + (e.externalTitle ? ` · ${e.externalTitle}` : '')
    useEditorStore.getState().openFile({
      id: `publication://${e.chapterNumber}`,
      name: label,
      type: 'publication',
      content: e.externalContent,
    })
  }

  return (
    <section>
      {/* 头部行片（2026-09-28 批 0）：折叠卡 = MenuRow 主按钮（功能图标悬停置换 ›/⌄、计数在内），
          导入按钮作兄弟；命中区固定 32×32（标准 §5.2） */}
      <MenuRow
        icon={<Satellite size={12} />}
        title={t('pub.title')}
        count={entries.length}
        swap="expand"
        expanded={open}
        onPrimary={() => setOpen(v => !v)}
        actions={
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
            style={{ width: 32, height: 32, color: 'var(--color-text-muted)' }}
            title={t('pub.import')}
          >
            <Plus size={12} />
          </button>
        }
      />

      {!open ? null : entries.length === 0 ? (
        <div className="text-micro py-1 pl-3 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
          {t('pub.empty')}
        </div>
      ) : (
        <div>
          {/* 行间距由片自带的 `margin: 2px 4px` 承担（spec 片间距 2px）——容器不得再加 space-y-*，
              否则 utilities 层的 margin-top 会盖掉片的竖向 margin（实测间距被顶到 3.5px） */}
          {entries.map((e) => (
            <div key={e.chapterNumber} className="menu-chip group flex items-center gap-1.5 select-none">
              {/* 2026-09-27 可供性修复：行主按钮 = 打开平台正文（编辑器只读标签页）。
                  此前整行 hover 变色却无点击处理器（「高亮但点不动」死带的源头）。
                  2026-09-28 批 0：行容器改「行片」——悬停底色由片承担，主按钮不再自带 hover/圆角。 */}
              <button
                type="button"
                onClick={() => openEntry(e)}
                className="flex items-center gap-1.5 flex-1 min-w-0 h-full px-2 text-left cursor-pointer"
              >
                <span className="text-micro flex-1 truncate" style={{ color: 'var(--color-text)' }}>
                  {t('pub.chapterLabel').replace('{n}', String(e.chapterNumber))}
                  {e.externalTitle ? ` · ${e.externalTitle}` : ''}
                </span>
                <span
                  className="text-2xs px-1 py-0.5 rounded flex-shrink-0"
                  style={{ backgroundColor: 'var(--color-hover)', color: simColor(e.similarity) }}
                  title={t('pub.similarity').replace('{p}', String(Math.round(e.similarity * 100)))}
                >
                  {Math.round(e.similarity * 100)}%
                </span>
                {e.auditIssues > 0 && (
                  <span
                    className="text-2xs px-1 py-0.5 rounded flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-warning)' }}
                    title={t('pub.auditIssues').replace('{n}', String(e.auditIssues))}
                  >
                    {e.auditIssues}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity cursor-pointer flex-shrink-0"
                title={t('action.delete')}
                onClick={() => void handleDelete(e)}
                style={{ width: 32, height: 32, color: 'var(--color-text-muted)' }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 导入弹框 */}
      <PublishImportDialog
        isOpen={dialogOpen}
        onClose={() => { setDialogOpen(false); void load() }}
        existingNumbers={entries.map(e => e.chapterNumber)}
      />
    </section>
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
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Satellite size={16} className="text-[var(--color-accent)]" />
            {t('pub.import')}
          </DialogTitle>
          <DialogDescription>
            {t('pub.importHint')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--color-text)' }}>
                {t('pub.chapterNumber')}
              </Label>
              <Input
                type="number"
                min={1}
                value={chapterNumber}
                onChange={(e) => setChapterNumber(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
              />
            </div>
            <div>
              <Label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--color-text)' }}>
                {t('pub.externalTitle')}
              </Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('pub.externalTitlePlaceholder')} />
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--color-text)' }}>
              {t('pub.externalContent')}
            </Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              className="text-xs"
              placeholder={t('pub.externalContentPlaceholder')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('action.cancel')}</Button>
          <Button variant="default" onClick={() => void handleSave()} disabled={saving || !content.trim()}>
            {saving ? t('status.saving') : t('action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
