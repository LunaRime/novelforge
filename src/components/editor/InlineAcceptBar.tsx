/**
 * InlineAcceptBar — L1 inline 接受进度浮条（Task 4）
 *
 * 纯展示 + 回调（决策/事务由 CodeMirrorEditor 统一执行）：
 * 进度 = 已接受子 hunk / 总子 hunk；动作 = 全部接受 / 全部拒绝 / 完成 / 关闭。
 * 浮条仅在存在 inlineSession 时渲染；颜色全部走 CSS 变量。
 */
import { useTranslation } from '../../hooks/useTranslation'
import { countAccepted, countSubHunks, type DiffSession } from '../../services/diff/hunk-model'

export interface InlineAcceptBarProps {
  session: DiffSession
  onAcceptAll: () => void
  onRejectAll: () => void
  onFinish: () => void
  onClose: () => void
}

/** 小按钮（内联样式，仅 CSS 变量色，与气泡菜单按钮同风格） */
function BarButton({
  label, onClick, accent, muted, dataAct,
}: {
  label: string
  onClick: () => void
  accent?: boolean
  muted?: boolean
  dataAct?: string
}) {
  return (
    <button
      data-act={dataAct}
      className="px-2 py-0.5 rounded text-xs transition-colors"
      style={{
        backgroundColor: accent ? 'var(--color-accent)' : 'transparent',
        border: muted ? 'none' : '1px solid var(--color-border)',
        color: accent ? 'var(--color-text)' : 'var(--color-text-secondary)',
      }}
      onMouseEnter={e => {
        if (!accent) e.currentTarget.style.backgroundColor = 'var(--color-hover)'
      }}
      onMouseLeave={e => {
        if (!accent) e.currentTarget.style.backgroundColor = 'transparent'
      }}
      onClick={onClick}
    >{label}</button>
  )
}

export function InlineAcceptBar({
  session, onAcceptAll, onRejectAll, onFinish, onClose,
}: InlineAcceptBarProps) {
  const { t } = useTranslation()
  const accepted = countAccepted(session)
  const total = countSubHunks(session)
  const progress = t('inlineAccept.progress')
    .replace('{n}', String(accepted))
    .replace('{m}', String(total))

  return (
    <div className="nf-ia-bar" role="status">
      <span style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }}>{progress}</span>
      <span style={{ flex: 1 }} />
      <BarButton dataAct="accept-all" label={t('inlineAccept.acceptAll')} onClick={onAcceptAll} accent />
      <BarButton dataAct="reject-all" label={t('inlineAccept.rejectAll')} onClick={onRejectAll} />
      <BarButton dataAct="finish" label={t('inlineAccept.finish')} onClick={onFinish} accent />
      <BarButton dataAct="close" label={t('inlineAccept.close')} onClick={onClose} muted />
    </div>
  )
}
