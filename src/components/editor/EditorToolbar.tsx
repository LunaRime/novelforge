/**
 * EditorToolbar — 草稿编辑器顶部工具栏
 *
 * 展示文档状态并执行保存、修稿、审稿与定稿。
 * 从 DraftEditor 提取，减少父组件复杂度。
 */
import { memo } from 'react'
import { Sparkles, Search, BadgeCheck, Save, FileStack, FileText, Wrench, Languages, Type } from 'lucide-react'
import { Button } from '../ui/Button'
import { Select, SelectTrigger, SelectContent, SelectItem } from '../ui/Select'
import { useTranslation } from '../../hooks/useTranslation'
import { useLayoutStore } from '../../stores/layout-store'
import type { DraftMeta, DraftStatus } from '../../services/workflows/chapter-workflow'
import type { RevisionEntry } from '../../services/draft-index'
import { DRAFT_STATUS_LABEL_KEY, DRAFT_STATUS_COLOR } from '../../shared/draft-status'
import type { TextKey } from '../../shared/locale'
import { VersionActions, type VersionAction } from './VersionActions'
import './document-toolbar.css'

export interface EditorToolbarProps {
  textToolsRef?: (node: HTMLDivElement | null) => void
  /** 草稿元数据（null 时显示占位） */
  meta: (DraftMeta & { chapterTitle?: string }) | null
  /** 当前字符数 */
  charCount: number
  /** 是否有未保存修改 */
  isDirty: boolean
  /** 是否只读（已定稿/归档） */
  isReadonly: boolean
  /** 是否正在保存 */
  saving: boolean
  /** 是否正在执行章节工作流 */
  isChapterBusy: boolean
  /** 待合并修稿列表 */
  pendingRevisions: RevisionEntry[]
  /** 审稿报告数量 */
  reviewCount: number
  /** 后处理是否有失败项 */
  hasProcessFailure: boolean
  /** 触发保存 */
  onSave: () => void
  /** 触发 AI 修稿 */
  onRefine: () => void
  /** 触发 AI 审稿 */
  onReview: () => void
  /** 触发正文翻译（目标语言，生成新草稿） */
  onTranslate: (lang: 'zh' | 'en' | 'ru') => void
  /** 触发定稿 */
  onFinalize: () => void
  /** 触发修复定稿后处理 */
  onRepairFinalize: () => void
  /** 打开待合并修稿 */
  onOpenRevision: (rev: RevisionEntry) => void
  /** 打开最新审稿报告 */
  onOpenReview: () => void
}

function EditorToolbar({
  textToolsRef,
  meta,
  charCount,
  isDirty,
  isReadonly,
  saving,
  isChapterBusy,
  pendingRevisions,
  reviewCount,
  hasProcessFailure,
  onSave,
  onRefine,
  onReview,
  onTranslate,
  onFinalize,
  onRepairFinalize,
  onOpenRevision,
  onOpenReview,
}: EditorToolbarProps) {
  const { t } = useTranslation()
  const status: DraftStatus = meta?.status ?? 'draft'

  const statusLabel = isReadonly
    ? t(status === 'finalized' ? 'status.readOnly' : 'status.archived')
    : t(DRAFT_STATUS_LABEL_KEY[status] as TextKey) ?? status

  return (
    <div className="nf-document-toolbar nf-version-action-container" data-extra-actions={pendingRevisions.length > 0 || reviewCount > 0}
      role="group" aria-label={t('panel.editor')}>
      <div className="nf-document-state">
        <span className="nf-document-badge" style={{ color: DRAFT_STATUS_COLOR[status] }} title={statusLabel}>
          <span className="truncate">{statusLabel}</span>
        </span>
        {isDirty && !isReadonly && (
          <span className="nf-document-dirty" title={t('statusbar.unsaved')} aria-label={t('statusbar.unsaved')} />
        )}
        {charCount > 0 && (
          <span className="nf-version-actions-wide text-xs tabular-nums text-[var(--color-text-muted)]">
            {charCount.toLocaleString()} {t('unit.chars')}
          </span>
        )}
      </div>
      <div className="nf-document-actions">
        {/* 稿纸外观从当前文档直达，设置和正文继续使用同一套作者偏好。 */}
        <Button type="button" variant="ghost" size="icon" className="nf-document-appearance size-8"
          title={t('settings.typography')} aria-label={t('settings.typography')}
          onClick={() => useLayoutStore.getState().openSettings('editor')}>
          <Type size={15} aria-hidden="true" />
        </Button>
        {!isReadonly && (
          <DraftVersionActions
            isChapterBusy={isChapterBusy} pendingRevisions={pendingRevisions} reviewCount={reviewCount}
            onRefine={onRefine} onReview={onReview} onTranslate={onTranslate} onFinalize={onFinalize}
            onOpenRevision={onOpenRevision} onOpenReview={onOpenReview} />
        )}
        {!isReadonly && isDirty && (
          <Button type="button" variant="default" className="min-h-8" onClick={onSave} disabled={saving} title={t('tip.saveShortcut')}>
            <Save size={13} aria-hidden="true" />
            {saving ? t('status.saving') : t('editor.save')}
          </Button>
        )}
        {isReadonly && status === 'finalized' && hasProcessFailure && (
          <Button type="button" variant="outline" size="sm" onClick={onRepairFinalize} disabled={isChapterBusy} title={t('tip.retryPostProcess')}>
            <Wrench size={13} aria-hidden="true" /> {t('editor.repairBtn')}
          </Button>
        )}
        {textToolsRef && <div ref={textToolsRef} className="shrink-0" />}
      </div>
    </div>
  )
}

function DraftVersionActions({
  isChapterBusy,
  pendingRevisions,
  reviewCount,
  onRefine,
  onReview,
  onTranslate,
  onFinalize,
  onOpenRevision,
  onOpenReview,
}: {
  isChapterBusy: boolean
  pendingRevisions: RevisionEntry[]
  reviewCount: number
  onRefine: () => void
  onReview: () => void
  onTranslate: (lang: 'zh' | 'en' | 'ru') => void
  onFinalize: () => void
  onOpenRevision: (rev: RevisionEntry) => void
  onOpenReview: () => void
}) {
  const { t } = useTranslation()
  const actions: VersionAction[] = []
  if (pendingRevisions.length > 0) actions.push({
    label: t('editor.pendingMergeBtn').replace('{n}', String(pendingRevisions.length)),
    title: t('tip.pendingMerge'), icon: <FileStack size={12} />,
    onSelect: () => onOpenRevision(pendingRevisions[0]),
  })
  if (reviewCount > 0) actions.push({
    label: t('editor.reviewReportBtn').replace('{n}', String(reviewCount)),
    title: t('tip.viewReviewReport'), icon: <FileText size={12} />, onSelect: onOpenReview,
  })
  actions.push(
    { label: t('editor.aiPolishBtn'), title: t('tip.aiPolish'), icon: <Sparkles size={12} />,
      onSelect: onRefine, variant: 'outline', disabled: isChapterBusy },
    { label: t('editor.aiReviewBtn'), title: t('tip.aiReview'), icon: <Search size={12} />,
      onSelect: onReview, variant: 'outline', disabled: isChapterBusy },
    { label: t('editor.finalizeBtn'), title: t('tip.finalize'), icon: <BadgeCheck size={12} />,
      onSelect: onFinalize, variant: 'outline', disabled: isChapterBusy },
  )
  const languages = ['zh', 'en', 'ru'] as const
  return (
    <VersionActions
      actions={actions}
      overflowExtra={languages.map(lang => ({
        label: `${t('translate.title')} ${t(`translate.lang.${lang}`)}`,
        icon: <Languages size={12} />,
        onSelect: () => onTranslate(lang),
      }))}
      wideExtra={
        <Select value="" onValueChange={(v) => onTranslate(v as typeof languages[number])}>
          <SelectTrigger className="h-6 w-auto min-w-[4.5rem] rounded text-micro" title={t('translate.title')}>
            <Languages size={11} />
            <span style={{ color: 'var(--color-text)' }}>{t('translate.title')}</span>
          </SelectTrigger>
          <SelectContent>
            {languages.map(lang => <SelectItem key={lang} value={lang}>{t(`translate.lang.${lang}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      }
    />
  )
}

export default memo(EditorToolbar)
