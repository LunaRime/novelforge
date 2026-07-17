/**
 * AIActionDialog — AI 修稿/审稿确认弹窗
 *
 * 从 DraftEditor 提取，处理 AI 操作前的确认和参数设置：
 * - 修稿：自定义提示词输入
 * - 审稿：多维度勾选
 */
import { Sparkles } from 'lucide-react'
import { Button } from '../ui/Button'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'

export const REVIEW_DIMS = [
  { key: 'continuity', label: '剧情连贯性', desc: '与前文是否矛盾' },
  { key: 'logic', label: '剧情合理性', desc: '因果逻辑、动机、常识' },
  { key: 'character', label: '角色状态', desc: '能力/位置/情感一致性' },
  { key: 'foreshadow', label: '前后章节串联', desc: '伏笔、悬念连贯' },
] as const

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

export default function AIActionDialog({
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
  return (
    <Dialog open={action !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={15} className="text-[var(--color-accent)]" />
            {action === 'refine' ? 'AI 修稿确认' : 'AI 审稿确认'}
          </DialogTitle>
          <DialogDescription>
            对象：{chapterTitle ? `${chapterTitle} v${version}` : '当前草稿'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-2 text-sm space-y-1.5" style={{ color: 'var(--color-text-secondary)' }}>
          {action === 'refine' ? (
            <>
              <div className="font-medium text-[var(--color-text)]">本次【直接修稿】范围：</div>
              <div>1. 全文基础润色、词汇优化，增强画面与表现力。</div>
              <div>2. 可在下方指定的额外修稿要求。</div>
            </>
          ) : (
            <>
              <div>将调用 AI 对本章草稿进行一致性检查，并生成审稿报告。</div>
              <div className="mt-3">
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>重点检查维度：</div>
                <div className="flex flex-wrap gap-2">
                  {REVIEW_DIMS.map(d => (
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
              附加修稿要求（可选）：
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
              placeholder="例如：加强打斗场面的画面感；把结尾的伏笔改为更隐晦的暗示..."
              value={refinePrompt}
              onChange={e => onRefinePromptChange(e.target.value)}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant="ai" onClick={onConfirm}>确认执行</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
