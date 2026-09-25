import { Check } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * 通用菜单项按钮
 * 供下拉/右键菜单的条目渲染复用（ContextMenu 内部调用）
 */
export interface MenuItemProps {
  label: string
  /** 事件透传：主题切换要用点击坐标做过渡动画的起点，故不吞掉 MouseEvent */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  icon?: React.ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  /**
   * 当前选中项 → **accent 文字 + 尾部 Check**。
   * ⚠️ 刻意不用底色表示选中：菜单项的悬停底色就是 `--color-hover`，
   * 选中若也用底色，用户无法分辨「正悬停」与「当前选中」（模型菜单曾如此）。
   */
  selected?: boolean
  /** Check 之前的内容（provider 徽标、comingSoon 提示等） */
  trailing?: React.ReactNode
  className?: string
}

export function MenuItem({
  label,
  onClick,
  icon,
  shortcut,
  disabled,
  danger,
  selected,
  trailing,
  className,
}: MenuItemProps) {
  /* 优先级：danger > disabled > selected > 常态 */
  const color = danger
    ? 'var(--color-error)'
    : disabled
    ? 'var(--color-text-muted)'
    : selected
    ? 'var(--color-accent)'
    : 'var(--color-text)'

  return (
    <button
      type="button"
      onClick={!disabled ? onClick : undefined}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
        className,
      )}
      style={{
        color,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        backgroundColor: 'transparent',
      }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.backgroundColor = danger
            ? 'color-mix(in srgb, var(--color-error) 10%, transparent)'
            : 'var(--color-hover)'
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {icon && (
        <span
          style={{
            color: danger ? 'var(--color-error)' : 'var(--color-text-secondary)',
            width: 14,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {icon}
        </span>
      )}
      <span className="flex-1">{label}</span>
      {trailing}
      {shortcut && (
        <span className="text-micro opacity-40 font-mono ml-2 flex-shrink-0">{shortcut}</span>
      )}
      {selected && <Check size={12} className="flex-shrink-0" />}
    </button>
  )
}
