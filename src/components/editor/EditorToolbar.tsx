/**
 * EditorToolbar — 草稿编辑器顶部工具栏
 *
 * 显示章节标题、版本号、字数统计、保存状态、AI 操作按钮、定稿按钮。
 * 从 DraftEditor 提取，减少父组件复杂度。
 */
import { memo } from 'react'
import { Sparkles, Search, BadgeCheck, Save, FileStack, FileText, Wrench } from 'lucide-react'
import { Button } from '../ui/Button'
import { useTranslation } from '../../hooks/useTranslation'
import type { DraftMeta, DraftStatus } from '../../services/workflows/chapter-workflow'
import type { RevisionEntry } from '../../services/draft-index'
import { DRAFT_STATUS_LABEL, DRAFT_STATUS_COLOR } from '../../shared/draft-status'

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
  onFinalize,
  onRepairFinalize,
  onOpenRevision,
  onOpenReview,
}: EditorToolbarProps) {
  const { t } = useTranslation()
  const status: DraftStatus = meta?.status ?? 'draft'

  return (
    <div
      className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
      style={{
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-editor-bg)',
      }}
    >
      {/* 左侧：章节标题 + 版本 */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {meta ? t('editor.chapterLabel').replace('{n}', String(meta.chapterNumber)).replace('{title}', meta.chapterTitle ?? '') : t('editor.draft')}
        </span>
        {meta && (
          <span className="text-[0.7rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
            v{meta.version}
          </span>
        )}
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
  onFinalize: () => void
  onOpenRevision: (rev: RevisionEntry) => void
  onOpenReview: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {/* 字数 */}
      {charCount > 0 && (
        <span className="text-xs tabular-nums mr-1" style={{ color: 'var(--color-text-muted)' }}>
          {charCount.toLocaleString()} {t('unit.chars')}
        </span>
      )}

      {/* 未保存指示灯 */}
      {isDirty && (
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0 mr-0.5"
          style={{ backgroundColor: 'var(--color-warning)' }}
          title={t('statusbar.unsaved')}
        />
      )}

      {/* 保存按钮 */}
      {isDirty && (
        <Button variant="outline" size="sm" onClick={onSave} disabled={saving} title={t('tip.saveShortcut')}>
          <Save size={12} />
          {saving ? t('status.saving') : t('editor.save')}
        </Button>
      )}

      {/* 状态标签 */}
      <span
        className="text-[0.7rem] px-1.5 py-0.5 rounded flex-shrink-0"
        style={{
          backgroundColor: 'var(--color-hover)',
          color: DRAFT_STATUS_COLOR[status] ?? 'var(--color-text-muted)',
        }}
      >
        {DRAFT_STATUS_LABEL[status] ?? status}
      </span>

      {/* 📋 待合并修稿 */}
      {pendingRevisions.length > 0 && (
        <Button
          variant="outline" size="sm"
          onClick={() => onOpenRevision(pendingRevisions[0])}
          title={t('tip.pendingMerge')}
        >
          <FileStack size={12} />
          {t('editor.pendingMergeBtn').replace('{n}', String(pendingRevisions.length))}
        </Button>
      )}

      {/* 📝 审稿报告 */}
      {reviewCount > 0 && (
        <Button
          variant="outline" size="sm"
          onClick={onOpenReview}
          title={t('tip.viewReviewReport')}
        >
          <FileText size={12} />
          {t('editor.reviewReportBtn').replace('{n}', String(reviewCount))}
        </Button>
      )}

      {/* AI 修稿 */}
      <Button
        variant="ai" size="sm"
        onClick={onRefine}
        disabled={isChapterBusy}
        title={t('tip.aiPolish')}
      >
        <Sparkles size={12} />
        {t('editor.aiPolishBtn')}
      </Button>

      {/* AI 审稿 */}
      <Button
        variant="ai" size="sm"
        onClick={onReview}
        disabled={isChapterBusy}
        title={t('tip.aiReview')}
      >
        <Search size={12} />
        {t('editor.aiReviewBtn')}
      </Button>

      {/* 定稿 */}
      <Button
        variant="success" size="sm"
        onClick={onFinalize}
        disabled={isChapterBusy}
        title={t('tip.finalize')}
      >
        <BadgeCheck size={12} />
        {t('editor.finalizeBtn')}
      </Button>
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
        <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
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
