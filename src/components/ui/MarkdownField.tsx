import { useId, useRef, useState, type ComponentProps } from 'react'
import { Eye, Pencil } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { Button } from './Button'
import MarkdownContent from './MarkdownContent'
import { Textarea } from './Textarea'
import MarkdownFormatMenu from './MarkdownFormatMenu'
import { formatTextarea } from './markdown-format'
import { cn } from '../../lib/utils'

/** 保留原始字段值及输入事件；已有内容默认按 Markdown 排版。 */
export default function MarkdownField({ value, startInEdit, className, ref, ...props }: Omit<ComponentProps<typeof Textarea>, 'value'> & { value: string; startInEdit?: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const field = useRef<HTMLTextAreaElement>(null)
  const [edit, setEdit] = useState<boolean>()
  const editing = edit ?? (startInEdit || !value.trim())
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-editor-bg)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-2 py-1">
        <span>{editing && !props.readOnly && <MarkdownFormatMenu compact disabled={props.disabled} onFormat={format => {
          if (field.current) formatTextarea(field.current, format)
        }} />}</span>
        <Button type="button" size="sm" variant="ghost" aria-controls={id} onClick={() => setEdit(!editing)}>
          {editing ? <Eye size={14} /> : <Pencil size={14} />}
          {t(editing ? 'editor.markdownPreview' : 'action.edit')}
        </Button>
      </div>
      <div id={id}>
        <div hidden={!editing}>
          <Textarea {...props} ref={node => {
            field.current = node
            if (typeof ref === 'function') ref(node)
            else if (ref) ref.current = node
          }} value={value} onChange={event => {
            setEdit(true)
            props.onChange?.(event)
          }} className={cn('rounded-none border-0 focus:ring-inset', className)} />
        </div>
        {!editing && (value.trim()
          ? <div className="allow-select max-h-96 overflow-auto px-4 py-3 text-sm"><MarkdownContent content={value} document /></div>
          : <p className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{props.placeholder}</p>)}
      </div>
    </div>
  )
}
