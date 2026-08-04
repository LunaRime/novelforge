/**
 * SidebarGroup — 侧栏区块卡片容器（VolumeGroup 风格统一）
 *
 * rounded-xl border + panel 背景卡片；标题行：accent 图标 + 标题 + 数量 + 操作按钮 + 折叠
 * 用于项目结构侧栏各部件（故事架构 / 章节蓝图 / 草稿箱 / 正文章节…）
 * 与 VolumeGroup 的 section 结构保持一致，保证侧栏视觉统一。
 */
import { useState, type ReactNode } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { useTranslation } from '../../../hooks/useTranslation'

interface SidebarGroupProps {
  /** 标题图标（建议 12px，accent 色） */
  icon: ReactNode
  /** 区块标题 */
  title: string
  /** 数量/进度（标题行右侧，ml-auto 推右） */
  count?: ReactNode
  /** 操作按钮组（数量右侧） */
  actions?: ReactNode
  /** 点击标题行（打开编辑器等；不设则标题行仅展示） */
  onTitleClick?: () => void
  /** 标题行悬停提示 */
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

  return (
    <section
      className="rounded-xl border p-2.5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}
    >
      <div
        className="flex items-center gap-1.5"
        style={{ cursor: onTitleClick ? 'pointer' : undefined }}
        onClick={onTitleClick}
        onContextMenu={onContextMenu}
        title={titleHint}
      >
        <span style={{ color: 'var(--color-accent)', flexShrink: 0, display: 'flex' }}>{icon}</span>
        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
          {title}
        </span>
        {count !== undefined && (
          <span className="ml-auto text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
            {count}
          </span>
        )}
        {actions}
        {collapsible && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
            className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
            style={{ color: 'var(--color-text-muted)' }}
            title={open ? t('action.close') : t('action.open')}
          >
            {open
              ? <ChevronDown size={12} />
              : <ChevronRight size={12} />}
          </button>
        )}
      </div>
      {collapsible ? (open ? children : null) : children}
    </section>
  )
}
