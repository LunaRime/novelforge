/**
 * AIActionDialog — AI 修稿/审稿确认弹窗
 *
 * 从 DraftEditor 提取，处理 AI 操作前的确认和参数设置：
 * - 修稿：自定义提示词输入
 * - 审稿：多维度勾选
 */
import { Sparkles } from 'lucide-react'
import { memo, useMemo } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import type { TextKey } from '../../shared/locale'
import { Button } from '../ui/Button'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'

/* eslint-disable react-refresh/only-export-components */
export function getReviewDims(t: (key: TextKey) => string) {
  return [
    { key: 'continuity', label: t('review.continuity'), desc: t('review.continuityDesc') },
    { key: 'logic', label: t('review.logic'), desc: t('review.logicDesc') },
    { key: 'character', label: t('review.character'), desc: t('review.characterDesc') },
    { key: 'foreshadow', label: t('review.foreshadow'), desc: t('review.foreshadowDesc') },
  ] as const
}

export interface AIActionDialogProps {
  /** 当前操作类型（null = 关闭弹窗） */
  action: 'refine' | 'review' | null
  /** 章节标题（用于提示） */
  chapterTitle?: string
  /** 版本号 */
  version?: number
  /** 用户自定义修稿提示词 */
  refinePrompt: string
  /** 审稿维度勾选状态 */
  reviewDims: Record<string, boolean>
  /** 关闭弹窗 */
  onClose: () => void
  /** 修稿提示词变更 */
  onRefinePromptChange: (value: string) => void
  /** 审稿维度勾选切换 */
  onReviewDimToggle: (key: string) => void
  /** 确认执行 */
  onConfirm: () => void
}

export default memo(function AIActionDialog({
  action,
  chapterTitle,
  version,
  refinePrompt,
  reviewDims,
  onClose,
  onRefinePromptChange,
  onReviewDimToggle,
  onConfirm,
}: AIActionDialogProps) {
  const { t } = useTranslation()
  const reviewDimsData = useMemo(() => getReviewDims(t), [t])

  return (
    <Dialog open={action !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={15} className="text-[var(--color-accent)]" />
            {action === 'refine' ? t('dialog.aiPolishTitle') : t('dialog.aiReviewTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('dialog.targetObject')}{chapterTitle ? `${chapterTitle} v${version}` : t('dialog.currentDraft')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-2 text-sm space-y-1.5" style={{ color: 'var(--color-text-secondary)' }}>
          {action === 'refine' ? (
            <>
              <div className="font-medium text-[var(--color-text)]">{t('review.directScope')}</div>
              <div>1. {t('review.directScopeDesc')}</div>
              <div>2. {t('review.directScopeNote')}</div>
            </>
          ) : (
            <>
              <div>{t('review.reviewScope')}</div>
              <div className="mt-3">
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>{t('review.checkDims')}</div>
                <div className="flex flex-wrap gap-2">
                  {reviewDimsData.map(d => (
                    <label
                      key={d.key}
                      className="flex items-center gap-1.5 cursor-pointer select-none px-2 py-1 rounded-md text-xs"
                      style={{
                        border: `1px solid ${reviewDims[d.key] ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        backgroundColor: reviewDims[d.key] ? 'rgba(var(--color-accent-rgb),0.1)' : 'transparent',
                        color: reviewDims[d.key] ? 'var(--color-accent)' : 'var(--color-text-muted)',
                      }}
                      onClick={() => onReviewDimToggle(d.key)}
                    >
                      <div
                        className="w-3 h-3 rounded flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: reviewDims[d.key] ? 'var(--color-accent)' : 'transparent',
                          border: `1.5px solid ${reviewDims[d.key] ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        }}
                      >
                        {reviewDims[d.key] && (
                          <svg width="7" height="5" viewBox="0 0 9 7" fill="none">
                            <path d="M1 3L3.5 5.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      {d.label}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 修稿时显示自定义提示词输入框 */}
        {action === 'refine' && (
          <div className="px-5 pb-2">
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              {t('review.extraPolishLabel')}
            </label>
            <textarea
              className="w-full px-3 py-2 rounded-md text-sm"
              style={{
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                minHeight: 72,
                resize: 'vertical',
                outline: 'none',
              }}
              placeholder={t('review.extraPolishPlaceholder')}
              value={refinePrompt}
              onChange={e => onRefinePromptChange(e.target.value)}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="ai" onClick={onConfirm}>{t('dialog.confirmExecute')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})
