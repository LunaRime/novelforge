import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface EditorPageHeaderProps {
  icon: ReactNode
  title: string
  /** 标题后的统计/状态（通常放 CountBadge） */
  meta?: ReactNode
  /** 右侧动作组 */
  actions?: ReactNode
  className?: string
}

/**
 * 编辑器页头 — 章节蓝图 / 章节看板 / 世界观时间线共用的 h-10 工具栏。
 *
 * 只负责版式：图标 + 标题 + meta + 右侧动作。具体动作与数据仍由页面自己提供，
 * 避免把业务塞进一个「万能页头」。
 */
export default function EditorPageHeader({
  icon,
  title,
  meta,
  actions,
  className,
}: EditorPageHeaderProps) {
  return (
    <div
      className={cn('flex items-center justify-between gap-2 px-3 h-10 flex-shrink-0 border-b', className)}
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="flex flex-shrink-0 items-center" style={{ color: 'var(--color-text-muted)' }}>
          {icon}
        </span>
        <span className="min-w-0 truncate text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {title}
        </span>
        {meta && <span className="flex min-w-0 items-center gap-1">{meta}</span>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}
