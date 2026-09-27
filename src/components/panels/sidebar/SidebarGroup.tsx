/**
 * SidebarGroup — 侧栏区块卡片容器（VolumeGroup 风格统一）
 *
 * rounded-xl border + panel 背景卡片。
 *
 * 2026-09-27 可供性重构（依据 card-affordance-standard §1/§2/§3 + 真机验证 RM-SB-02/03/04/06）：
 *  - 头部唯一主按钮（flex-1）：图标 + 标题 + 计数全在其内 → 整行可点（计数死区清零）
 *  - 折叠卡（无 onTitleClick）：主按钮 = 展开/折叠，chevron 在主按钮内**置左**，右侧不放 `>`
 *  - 导航卡（onTitleClick + collapsible=false）：主按钮 = 进入，`>` 装饰在主按钮内末尾
 *  - 导航+折叠卡（两者都有）：左 chevron 独立按钮（折叠）+ 主按钮（进入，内含 `>`）
 *  - 纯状态卡（都没有）：无热区、无 hover、无手型
 *  - 操作按钮（独立行为）一律作主按钮的**兄弟**；不渲染任何 disabled 按钮（反模式）
 *  - 头部图标按钮固定像素 22×22（≥20×20 底线；rem 档位在 html{font-size:14px} 下不足）
 */
import { useState, type ReactNode } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
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
  const foldIcon = open ? <ChevronDown size={12} /> : <ChevronRight size={12} />
  const iconSlot = (
    <span style={{ color: 'var(--color-accent)', flexShrink: 0, display: 'flex' }}>{icon}</span>
  )
  const titleText = (
    <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
      {title}
    </span>
  )
  const countText = count !== undefined && (
    <span className="ml-auto text-micro flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
      {count}
    </span>
  )

  return (
    <section
      className="rounded-xl border p-2.5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}
    >
      {/* 头部：唯一主按钮（图标 + 标题 + 计数全在其内）+ 操作按钮兄弟。
          ⚠️ 不得改回「标题按钮 + 计数兄弟」——那正是计数死区的根因（真机 S1b/S2b/S3b NO_CHANGE）。 */}
      <div className="flex items-center gap-1.5 mb-1.5" onContextMenu={onContextMenu}>
        {/* 导航+折叠卡：折叠箭头是独立按钮（置左；右端留给「进入」） */}
        {onTitleClick && collapsible && (
          <button
            type="button"
            onClick={toggle}
            className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
            style={{ width: 22, height: 22, color: 'var(--color-text-muted)' }}
            title={open ? t('action.close') : t('action.open')}
          >
            {foldIcon}
          </button>
        )}

        {onTitleClick ? (
          /* 导航卡（含导航+折叠）：主按钮 = 进入；`>` 纯装饰在主按钮内末尾 */
          <button
            type="button"
            onClick={onTitleClick}
            className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
            title={titleHint}
          >
            {iconSlot}
            {titleText}
            {countText}
            <ChevronRight size={12} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }} />
          </button>
        ) : collapsible ? (
          /* 折叠卡：主按钮 = 展开/折叠；chevron 在主按钮内、置左；右侧不放 `>` */
          <button
            type="button"
            onClick={toggle}
            className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
            title={titleHint}
          >
            <span className="flex items-center flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
              {foldIcon}
            </span>
            {iconSlot}
            {titleText}
            {countText}
          </button>
        ) : (
          /* 纯状态卡：无热区、无 hover、无手型（不得渲染 disabled 按钮） */
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {iconSlot}
            {titleText}
            {countText}
          </div>
        )}

        {actions}
      </div>

      {collapsible ? (open ? children : null) : children}
    </section>
  )
}
