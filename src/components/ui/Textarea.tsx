import * as React from 'react'
import { cn } from '../../lib/utils'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows, style, ...props }, ref) => {
    // rows 决定起始空间，正文变长则自动增高，超过上限后在框内滚动。
    return (
      <textarea
        className={cn(
          'flex w-full rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-1.5 text-xs text-[var(--color-text)] transition-colors',
          'placeholder:text-[var(--color-text-muted)]',
          'focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'min-h-[max(60px,calc(var(--textarea-lines)*1lh+0.75rem+2px))] max-h-80 resize-none overflow-y-auto [field-sizing:content]',
          className
        )}
        rows={rows}
        style={{ '--textarea-lines': rows ?? 2, ...style } as React.CSSProperties}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
