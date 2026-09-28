/**
 * SidebarGroup — 侧栏区块分组（行片形态，2026-09-28 批 0）
 *
 * 头部 = `MenuRow`（行片唯一实现）；`<section>` 只做分组容器（**无卡片边框/底色**，
 * 分组靠父容器间距 —— 见设计 spec §二「分组 = 纯间距分组」）。
 *
 * 四类契约（与 2026-09-27 可供性重构一致，形态改由 MenuRow 承担）：
 *  - 折叠卡（无 onTitleClick）：主按钮 = 展开/折叠；指示箭头由悬停置换承担（收起 › / 展开 ⌄）
 *  - 导航卡（onTitleClick + collapsible=false）：主按钮 = 进入；悬停置换为 ›（**无右端常驻 `>`**）
 *  - 导航+折叠卡（两者都有）：左端独立折叠按钮（常驻 ›/⌄）+ 主按钮（进入，悬停置换 ›）
 *  - 纯状态卡（都没有）：无热区、无 hover、无手型、**不传 swap**（纯展示行不得有置换暗示）
 *  - 操作按钮（独立行为）一律作主按钮的**兄弟**；不渲染任何 disabled 按钮（反模式）
 *  - 头部图标按钮固定像素 32×32（标准 §5.2；rem 档位在 html{font-size:14px} 下不足）
 */
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import MenuRow from '../../ui/MenuRow'
import { useTranslation } from '../../../hooks/useTranslation'

interface SidebarGroupProps {
  /** 标题图标（建议 12px，accent 色） */
  icon: ReactNode
  /** 区块标题 */
  title: string
  /** 数量/进度（纯展示 → 进主按钮，标题行右侧 ml-auto） */
  count?: ReactNode
  /** 有独立行为的操作按钮组（数量右侧，主按钮的兄弟） */
  actions?: ReactNode
  /** 点击主按钮（打开编辑器等）。不传 → 主行为 = 展开/折叠（折叠卡） */
  onTitleClick?: () => void
  /** 主按钮悬停提示（挂在动作所在的元素上——不得挂整行容器，否则暗示超热区） */
  titleHint?: string
  /** 标题行右键菜单 */
  onContextMenu?: (e: React.MouseEvent) => void
  /** 默认展开（折叠状态由组件内部管理） */
  defaultOpen?: boolean
  /** 无内容时隐藏折叠按钮（单行入口块，如小说配置/章节蓝图） */
  collapsible?: boolean
  children?: ReactNode
}

export default function SidebarGroup({
  icon,
  title,
  count,
  actions,
  onTitleClick,
  titleHint,
  onContextMenu,
  defaultOpen = true,
  collapsible = true,
  children,
}: SidebarGroupProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)

  const toggle = () => setOpen(v => !v)
  const iconSlot = (
    <span style={{ color: 'var(--color-accent)', flexShrink: 0, display: 'flex' }}>{icon}</span>
  )
  // 导航+折叠卡：左端独立折叠按钮（常驻、状态可见；›/⌄ 与行语言统一）
  const foldButton = (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
      style={{ width: 32, height: 32, color: 'var(--color-text-muted)' }}
      title={open ? t('action.close') : t('action.open')}
    >
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
    </button>
  )

  return (
    <section>
      {/* 头部行片（MenuRow）：主按钮含图标+标题+计数；操作按钮为兄弟。
          ⚠️ 不得改回「标题按钮 + 计数兄弟」——那正是计数死区的根因（真机 S1b/S2b/S3b NO_CHANGE）。 */}
      <MenuRow
        icon={iconSlot}
        title={title}
        count={count}
        titleHint={titleHint}
        onContextMenu={onContextMenu}
        onPrimary={onTitleClick ?? (collapsible ? toggle : undefined)}
        swap={onTitleClick || collapsible ? (onTitleClick ? 'nav' : 'expand') : undefined}
        expanded={open}
        leadingButton={onTitleClick && collapsible ? foldButton : undefined}
        actions={actions}
      />

      {collapsible ? (open ? children : null) : children}
    </section>
  )
}
