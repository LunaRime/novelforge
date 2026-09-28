import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

interface HoverSwapIconProps {
  /** 功能图标（默认态显示；12px 档） */
  icon: ReactNode
  /** nav = 跳转/滑出（悬停显 ›）；expand = 原地展开（收起 › / 展开 ⌄） */
  swap: 'nav' | 'expand'
  /** swap='expand'：当前是否已展开（决定箭头方向） */
  expanded?: boolean
  /** 图标档位（ui-layout-standard 图标五档；默认 12） */
  size?: number
}

/**
 * 悬停态图标置换（ui-interaction-standard §3.1）：
 * 默认显示功能图标，父级 hover / focus-within 时交叉渐隐为指示箭头。
 * 纯 CSS 驱动（由外层容器的 group-hover / group-focus-within 触发），无 JS hover state ——
 * 快速划过不闪烁、键盘 Tab 等价；prefers-reduced-motion 降级为瞬时切换。
 * ⚠️ 使用方必须给外层可悬停容器加 `group` 类。
 */
export default function HoverSwapIcon({ icon, swap, expanded = false, size = 12 }: HoverSwapIconProps) {
  const arrow = swap === 'nav'
    ? <ChevronRight size={size} />
    : (expanded ? <ChevronDown size={size} /> : <ChevronRight size={size} />)
  return (
    <span
      className="relative inline-flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, color: 'var(--color-accent)' }}
    >
      {/* 功能图标层：悬停/聚焦时隐去 */}
      <span className="inline-flex transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-0 group-focus-within:opacity-0">
        {icon}
      </span>
      {/* 指示箭头层：与图标层叠放（绝对定位，零布局位移），悬停/聚焦时渐现 */}
      <span
        className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {arrow}
      </span>
    </span>
  )
}
