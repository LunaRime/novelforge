import React from 'react'

interface Props {
  children: React.ReactNode
  /** 退场中：切到 exit 动画。真正卸载由调用方在动画结束后做（见 Confirm 的退场延时） */
  exiting?: boolean
  /** 点遮罩（卡片以外区域）的回调。不传则点遮罩无反应 */
  onBackdropClick?: () => void
  /** 语义角色：alertError 用 alertdialog（读屏会立即播报），其余用 dialog */
  role?: 'dialog' | 'alertdialog'
  /** 卡片最小宽度：两按钮 320，三按钮（删除项目）380 */
  minWidth?: number
}

/**
 * 命令式模态框的遮罩 + 卡片外壳。
 *
 * 收敛自 `Confirm.tsx` 里两份各自内联同一套样式的模态（ConfirmDialog /
 * ConfirmDeleteProjectDialog），只有 role 与 minWidth 两处不同。**只管外壳**：
 * 按钮、文案、Esc、聚焦、退场时序都留在调用方。
 *
 * 动画名与 `index.css` 的 @keyframes 对齐（backdrop-enter/exit、dialog-enter/exit）；
 * `both` 让 0% 关键帧提前生效，避免首帧闪烁。
 */
export function ModalShell({
  children,
  exiting = false,
  onBackdropClick,
  role = 'dialog',
  minWidth = 320,
}: Props) {
  return (
    /* 遮罩层 */
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-modal)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-backdrop)',
        backdropFilter: 'blur(8px)',
        pointerEvents: 'auto',
        animation: exiting
          ? 'backdrop-exit 0.15s ease-out both'
          : 'backdrop-enter 0.25s ease-out both',
      }}
      onClick={onBackdropClick}
    >
      {/* 卡片主体 */}
      <div
        role={role}
        aria-modal="true"
        style={{
          backgroundColor: 'var(--color-sidebar)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-2xl)',
          boxShadow: 'var(--shadow-popover)',
          padding: '20px 24px',
          minWidth,
          maxWidth: 460,
          animation: exiting
            ? 'dialog-exit 0.15s ease-out both'
            : 'dialog-enter 0.25s var(--transition-spring) both',
        }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
