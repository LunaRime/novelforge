import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface EditorPageHeaderProps {
  icon: ReactNode
  title: string
  /** 标题后的统计/状态（通常放 CountBadge） */
  meta?: ReactNode
  /** 右侧动作组 */
  actions?: ReactNode
  actionsClassName?: string
  className?: string
}

/**
 * 章节蓝图、章节看板和时间线共用页头。操作随可用宽度换行，页面保留自身的数据和事件。
 */
export default function EditorPageHeader({
  icon,
  title,
  meta,
  actions,
  actionsClassName,
  className,
}: EditorPageHeaderProps) {
  return (
    <header className={cn('flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--color-border)] bg-[var(--color-editor-bg)] px-3 py-2', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-panel)] text-[var(--color-accent)]">
          {icon}
        </span>
        <h2 className="min-w-0 truncate text-base font-semibold text-[var(--color-text)]" title={title}>
          {title}
        </h2>
        {meta && <span className="flex min-w-0 items-center gap-1">{meta}</span>}
      </div>
      {actions && <div className={cn('flex min-w-0 flex-wrap items-center gap-1', actionsClassName)}>{actions}</div>}
    </header>
  )
}
