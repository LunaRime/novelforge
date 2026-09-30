import type { ReactNode } from 'react'
import HoverSwapIcon from './HoverSwapIcon'

interface MenuRowProps {
  /** 功能图标（配 swap 使用；纯展示行可省略） */
  icon?: ReactNode
  /** 行标题（纯展示，进主按钮） */
  title: string
  /** 标题后缀（纯展示，进主按钮）—— 如供应商行的「自定义」标签；与标题同处主按钮热区内 */
  titleSuffix?: ReactNode
  /** 右侧计数/状态（纯展示，进主按钮） */
  count?: ReactNode
  /** 主行为：导航=进入；折叠卡=展开/折叠。不传 = 该行没有主行为 */
  onPrimary?: () => void
  /** 悬停置换语义：nav=›；expand 收起=› / 展开=⌄（随 expanded） */
  swap?: 'nav' | 'expand'
  /** swap='expand'：当前是否已展开 */
  expanded?: boolean
  /** 导航+折叠卡：左端独立折叠按钮（常驻、状态可见；主按钮仍负责进入） */
  leadingButton?: ReactNode
  /** 有独立行为的操作按钮（兄弟节点，常驻） */
  actions?: ReactNode
  /** 主按钮悬停提示 */
  titleHint?: string
  /** 选中态（底色 + 左 2px accent 竖线） */
  active?: boolean
  onContextMenu?: (e: React.MouseEvent) => void
}

/**
 * MenuRow —— 行片（chip）的唯一实现（card-affordance-standard §行片形态，2026-09-28 批 0）。
 *
 * 结构与既有可供性契约一致：外层片容器（视觉/menu-chip/右键菜单）+ `flex-1` 主按钮
 * （图标置换 + 标题 + 计数）+ 操作按钮作兄弟（`button button` 恒为 0，无需 stopPropagation）。
 * 悬停置换由容器 `group` + HoverSwapIcon 的 group-hover/group-focus-within 纯 CSS 驱动。
 *
 * 水平内边距（spec 几何「水平内边距 8px」= 本仓 `px-2`）挂在**可点元素**（主按钮、或纯展示行的内容行）
 * 上，**不挂片容器**——容器上的 padding 会造出「hover 亮起但点不动」的死带（2026-09-27 修过的同类缺陷）。
 */
export default function MenuRow({
  icon, title, titleSuffix, count, onPrimary, swap, expanded, leadingButton, actions, titleHint, active, onContextMenu,
}: MenuRowProps) {
  const content = (
    <>
      {swap ? <HoverSwapIcon icon={icon} swap={swap} expanded={expanded} /> : icon}
      <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{title}</span>
      {titleSuffix}
      {count !== undefined && (
        <span className="ml-auto text-micro flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{count}</span>
      )}
    </>
  )
  return (
    <div
      className="menu-chip group flex items-center gap-1.5 select-none"
      style={active ? { background: 'var(--color-active)', boxShadow: 'inset 2px 0 0 var(--color-accent)' } : undefined}
      onContextMenu={onContextMenu}
    >
      {leadingButton}
      {onPrimary ? (
        <button
          type="button"
          onClick={onPrimary}
          title={titleHint}
          className="flex items-center gap-1.5 flex-1 min-w-0 h-full px-2 text-left enabled:cursor-pointer"
        >
          {content}
        </button>
      ) : (
        /* 纯展示行：无热区、无 hover、无手型（不得渲染 disabled 按钮） */
        <div className="flex items-center gap-1.5 flex-1 min-w-0 px-2">{content}</div>
      )}
      {actions}
    </div>
  )
}
