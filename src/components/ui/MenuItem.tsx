/**
 * 通用菜单项按钮
 * 供下拉/右键菜单的条目渲染复用（ContextMenu 内部调用）
 */
export interface MenuItemProps {
  label: string
  onClick?: () => void
  icon?: React.ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
}

export function MenuItem({ label, onClick, icon, shortcut, disabled, danger }: MenuItemProps) {
  return (
    <button
      onClick={!disabled ? onClick : undefined}
      disabled={disabled}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
      style={{
        color: danger
          ? 'var(--color-error)'
          : disabled
          ? 'var(--color-text-muted)'
          : 'var(--color-text)',
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
      {shortcut && (
        <span className="text-[0.7rem] opacity-40 font-mono ml-2 flex-shrink-0">{shortcut}</span>
      )}
    </button>
  )
}
