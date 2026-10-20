import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** 弹层触发器需要的 ARIA 属性（状态栏分段可选透传） */
type AriaPopupProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-haspopup' | 'aria-expanded'
>

/**
 * 状态栏分段（可点击）——原生 button：键盘可达（Tab/Enter/Space），符合可访问性。
 *
 * 从 StatusBar.tsx 抽出（Task 10）：状态栏里的思考等级控件也用它，
 * 避免为了一个分段把整份 StatusBar 的私有实现再抄一遍。
 */
export function StatusBarSegment({
  children,
  title,
  onClick,
  ...aria
}: {
  children: ReactNode
  title?: string
  onClick?: () => void
} & AriaPopupProps) {
  return (
    <button
      type="button"
      {...aria}
      className="flex items-center gap-1 px-2 h-full cursor-default transition-colors"
      title={title}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onMouseEnter={e => {
        if (onClick) {
          e.currentTarget.style.backgroundColor = 'rgba(var(--color-accent-rgb), 0.08)'
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {children}
    </button>
  )
}

/** 状态栏分隔符 */
export function StatusBarDivider() {
  return (
    <span style={{ opacity: 0.25, fontSize: "var(--text-micro)", userSelect: 'none' }}>|</span>
  )
}
