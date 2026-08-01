import * as React from 'react'
import { cn } from '../../lib/utils'

/**
 * 原生 select 的统一样式封装（轻量替代 Radix Select）
 *
 * 现代化样式：
 * - 自定义 chevron 箭头（内联 SVG，跟随当前文本色，支持主题切换）
 * - hover 边框高亮 + 轻微阴影，focus 双层 ring
 * - 圆角/高度与 Button 体系一致（rounded-lg / h-8）
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        className={cn(
          'flex h-8 w-full appearance-none cursor-pointer rounded-lg border border-[var(--color-border)]',
          'bg-[var(--color-panel)] pl-3 pr-8 py-1 text-xs text-[var(--color-text)]',
          // 自定义箭头：内联 SVG chevron-down（currentColor 跟随主题）
          'bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2712%27%20height=%2712%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27currentColor%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E")]',
          'bg-no-repeat bg-[right_0.65rem_center]',
          // hover / focus 状态
          'transition-all duration-150 hover:border-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_4%,var(--color-panel))]',
          'focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    )
  }
)
NativeSelect.displayName = 'NativeSelect'

export { NativeSelect }
