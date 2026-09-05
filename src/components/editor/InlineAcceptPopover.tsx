/**
 * InlineAcceptPopover — L1 inline 接受浮层（Task 4）
 *
 * 点击 pending 区段打开：展示「第 n/m 处改动」+ 句级子 hunk 勾选列表
 * （每行 改前[划除] / 改后[高亮] 预览，checkbox 勾选 = 待接受），
 * 底部动作：接受选中 / 整体接受 / 拒绝 / 关闭。
 * 纯展示 + 回调：doc 事务与 store 决策由 CodeMirrorEditor 统一执行。
 */
import { useState } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import type { DiffSession, SubHunk } from '../../services/diff/hunk-model'

export interface InlineAcceptPopoverProps {
  session: DiffSession
  /** 当前 hunk 在 session.hunks 中的下标 */
  hunkIdx: number
  /** 当前点击子句 id（默认勾选；popover 以 key 随点击目标重建） */
  activeSubId: string
  position: { top: number; left: number }
  onAcceptSelected: (subIds: string[]) => void
  onAcceptWhole: () => void
  onReject: () => void
  onClose: () => void
}

/** 浮层小按钮（内联样式，仅 CSS 变量色） */
function PopoverButton({
  label, onClick, accent, disabled, danger, dataAct,
}: {
  label: string
  onClick: () => void
  accent?: boolean
  disabled?: boolean
  danger?: boolean
  dataAct?: string
}) {
  return (
    <button
      data-act={dataAct}
      disabled={disabled}
      className="px-2 py-1 text-xs rounded-md transition-colors"
      style={{
        backgroundColor: accent ? 'var(--color-accent)' : 'transparent',
        border: '1px solid var(--color-border)',
        color: danger ? 'var(--color-error)' : 'var(--color-text-secondary)',
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={e => {
        if (!disabled && !accent) e.currentTarget.style.backgroundColor = 'var(--color-hover)'
      }}
      onMouseLeave={e => {
        if (!disabled && !accent) e.currentTarget.style.backgroundColor = 'transparent'
      }}
      onClick={onClick}
    >{label}</button>
  )
}

export function InlineAcceptPopover({
  session, hunkIdx, activeSubId, position, onAcceptSelected, onAcceptWhole, onReject, onClose,
}: InlineAcceptPopoverProps) {
  const { t } = useTranslation()
  const hunk = session.hunks[hunkIdx]
  // 默认勾选当前点击的子句（句级快速接受路径）；rejected 子句不可再选
  const [checked, setChecked] = useState<Set<string>>(() => new Set([activeSubId]))

  if (!hunk) return null

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const decided = (s: SubHunk) => session.decisions[s.id]
  const pendingSubs = hunk.sub.filter(s => decided(s) !== 'accepted')
  const acceptIds = pendingSubs.filter(s => decided(s) !== 'rejected' && checked.has(s.id)).map(s => s.id)
  const rejectedIds = new Set(pendingSubs.filter(s => decided(s) === 'rejected').map(s => s.id))

  const progress = t('inlineAccept.bubbleProgress')
    .replace('{n}', String(hunkIdx + 1))
    .replace('{m}', String(session.hunks.length))

  return (
    <div
      className="nf-ia-popover"
      style={{ top: position.top, left: position.left }}
      onMouseDown={e => e.preventDefault()} // 防止编辑器失焦
      onClick={e => e.stopPropagation()}
    >
      <div
        className="text-[10px] font-medium mb-2"
        style={{ color: 'var(--color-text-muted)' }}
      >{progress}</div>

      <ul className="space-y-1.5 mb-2">
        {pendingSubs.map(s => {
          const rejected = rejectedIds.has(s.id)
          return (
            <li key={s.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                data-sub-id={s.id}
                className="nf-ia-sub-check mt-1 shrink-0"
                style={{ accentColor: 'var(--color-accent)' }}
                checked={checked.has(s.id) && !rejected}
                disabled={rejected}
                onChange={() => toggle(s.id)}
              />
              <div className="flex-1 min-w-0 text-xs leading-relaxed">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                    {t('inlineAccept.original')}
                  </span>
                  <span className="line-through break-all" style={{ color: 'var(--color-text-muted)' }}>
                    {s.origText}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                    {t('inlineAccept.revised')}
                  </span>
                  <span className="break-all" style={{ color: 'var(--color-accent)' }}>
                    {s.modText}
                  </span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="flex items-center justify-end gap-2 border-t pt-2"
        style={{ borderColor: 'var(--color-border)' }}>
        <PopoverButton
          dataAct="pv-accept-selected"
          label={t('inlineAccept.acceptSelected')}
          onClick={() => onAcceptSelected(acceptIds)}
          disabled={acceptIds.length === 0}
          accent
        />
        <PopoverButton
          dataAct="pv-accept-whole"
          label={t('inlineAccept.acceptWhole')}
          onClick={onAcceptWhole}
        />
        <PopoverButton
          dataAct="pv-reject"
          label={t('inlineAccept.reject')}
          onClick={onReject}
          danger
        />
        <PopoverButton dataAct="pv-close" label={t('inlineAccept.close')} onClick={onClose} />
      </div>
    </div>
  )
}
