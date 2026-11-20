import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** 弹层触发器需要的 ARIA 属性（状态栏分段可选透传） */
type AriaPopupProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-haspopup' | 'aria-expanded'
>

/** 状态栏分段。有操作时用原生按钮，纯状态信息使用文本容器。 */
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
  const className = 'flex h-full min-w-0 items-center gap-1 whitespace-nowrap px-2'
  if (!onClick) return <span className={className} title={title}>{children}</span>

  return (
    <button
      type="button"
      {...aria}
      className={`${className} cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] transition-colors`}
      title={title}
      onClick={onClick}
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
