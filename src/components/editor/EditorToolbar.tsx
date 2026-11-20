/**
 * EditorToolbar — 草稿编辑器顶部工具栏
 *
 * 显示章节标题、版本号、字数统计、保存状态、AI 操作按钮、定稿按钮。
 * 从 DraftEditor 提取，减少父组件复杂度。
 */
import { memo } from 'react'
import { Sparkles, Search, BadgeCheck, Save, FileStack, FileText, Wrench, Languages } from 'lucide-react'
import { Button } from '../ui/Button'
import { Select, SelectTrigger, SelectContent, SelectItem } from '../ui/Select'
import { useTranslation } from '../../hooks/useTranslation'
import type { DraftMeta, DraftStatus } from '../../services/workflows/chapter-workflow'
import type { RevisionEntry } from '../../services/draft-index'
import { DRAFT_STATUS_LABEL_KEY, DRAFT_STATUS_COLOR } from '../../shared/draft-status'
import type { TextKey } from '../../shared/locale'
import { VersionActions, type VersionAction } from './VersionActions'

export interface EditorToolbarProps {
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

  return (
    <div
      className="nf-version-action-container flex items-center justify-between gap-2 px-2 sm:px-3 h-9 flex-shrink-0"
      style={{
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-editor-bg)',
      }}
    >
      {/* 标题和版本显示在稿纸上，工具栏保留当前文档的操作。 */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {meta ? t('chapter.label').replace('{n}', String(meta.chapterNumber)) : t('editor.draft')}
        </span>
      </div>

      {/* 右侧操作区 */}
      {!isReadonly && (
        <RightActions
          charCount={charCount}
          isDirty={isDirty}
          saving={saving}
          isChapterBusy={isChapterBusy}
          pendingRevisions={pendingRevisions}
          reviewCount={reviewCount}
          status={status}
          onSave={onSave}
          onRefine={onRefine}
          onReview={onReview}
          onTranslate={onTranslate}
          onFinalize={onFinalize}
          onOpenRevision={onOpenRevision}
          onOpenReview={onOpenReview}
        />
      )}

      {/* 已定稿/归档 → 只读提示 + 修复按钮 */}
      {isReadonly && (
        <ReadonlyActions
          charCount={charCount}
          isChapterBusy={isChapterBusy}
          hasProcessFailure={hasProcessFailure}
          status={status}
          onRepairFinalize={onRepairFinalize}
        />
      )}
    </div>
  )
}

/** 正常编辑模式下的右侧操作区 */
function RightActions({
  charCount,
  isDirty,
  saving,
  isChapterBusy,
  pendingRevisions,
  reviewCount,
  status,
  onSave,
  onRefine,
  onReview,
  onTranslate,
  onFinalize,
  onOpenRevision,
  onOpenReview,
}: {
  charCount: number
  isDirty: boolean
  saving: boolean
  isChapterBusy: boolean
  pendingRevisions: RevisionEntry[]
  reviewCount: number
  status: DraftStatus
  onSave: () => void
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
      onSelect: onRefine, variant: 'ai', disabled: isChapterBusy },
    { label: t('editor.aiReviewBtn'), title: t('tip.aiReview'), icon: <Search size={12} />,
      onSelect: onReview, variant: 'ai', disabled: isChapterBusy },
    { label: t('editor.finalizeBtn'), title: t('tip.finalize'), icon: <BadgeCheck size={12} />,
      onSelect: onFinalize, variant: 'success', disabled: isChapterBusy },
  )
  const languages = ['zh', 'en', 'ru'] as const
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {charCount > 0 && (
        <span className="nf-version-actions-wide text-xs tabular-nums mr-1" style={{ color: 'var(--color-text-muted)' }}>
          {charCount.toLocaleString()} {t('unit.chars')}
        </span>
      )}
      {isDirty && (
        <>
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0 mr-0.5"
            style={{ backgroundColor: 'var(--color-warning)' }}
            title={t('statusbar.unsaved')}
          />
          <Button variant="outline" size="sm" onClick={onSave} disabled={saving} title={t('tip.saveShortcut')}>
            <Save size={12} />
            {saving ? t('status.saving') : t('editor.save')}
          </Button>
        </>
      )}
      <span
        className="text-micro px-1.5 py-0.5 rounded flex-shrink-0"
        style={{
          backgroundColor: 'var(--color-hover)',
          color: DRAFT_STATUS_COLOR[status] ?? 'var(--color-text-muted)',
        }}
      >
        {t(DRAFT_STATUS_LABEL_KEY[status] as TextKey) ?? status}
      </span>
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
    </div>
  )
}

/** 只读模式下的右侧显示 */
function ReadonlyActions({
  charCount,
  isChapterBusy,
  hasProcessFailure,
  status,
  onRepairFinalize,
}: {
  charCount: number
  isChapterBusy: boolean
  hasProcessFailure: boolean
  status: DraftStatus
  onRepairFinalize: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {charCount > 0 && (
        <span className="nf-version-actions-wide text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
          {charCount.toLocaleString()} {t('unit.chars')}
        </span>
      )}
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {status === 'finalized' ? t('status.readOnly') : t('status.archived')}
      </span>
      {status === 'finalized' && hasProcessFailure && (
        <Button
          variant="outline" size="sm"
          onClick={onRepairFinalize}
          disabled={isChapterBusy}
          title={t('tip.retryPostProcess')}
        >
          <Wrench size={11} />
          {t('editor.repairBtn')}
        </Button>
      )}
    </div>
  )
}

export default memo(EditorToolbar)
