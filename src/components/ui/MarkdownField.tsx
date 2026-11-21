import { useId, useState, type ComponentProps } from 'react'
import { Eye, Pencil } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { Button } from './Button'
import MarkdownContent from './MarkdownContent'
import { Textarea } from './Textarea'

/** 保留原始字段值及输入事件；已有内容默认按 Markdown 排版。 */
export default function MarkdownField({ value, ...props }: Omit<ComponentProps<typeof Textarea>, 'value'> & { value: string }) {
  const { t } = useTranslation()
  const id = useId()
  const [edit, setEdit] = useState<boolean>()
  const editing = edit ?? !value.trim()
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-editor-bg)]">
      <div className="flex justify-end border-b border-[var(--color-border)] px-2 py-1">
        <Button type="button" size="sm" variant="ghost" aria-controls={id} onClick={() => setEdit(!editing)}>
          {editing ? <Eye size={14} /> : <Pencil size={14} />}
          {t(editing ? 'editor.markdownPreview' : 'action.edit')}
        </Button>
      </div>
      <div id={id}>
        <div hidden={!editing}>
          <Textarea {...props} value={value} onChange={event => {
            setEdit(true)
            props.onChange?.(event)
          }} className="min-h-28 rounded-none border-0" />
        </div>
        {!editing && (value.trim()
          ? <div className="px-4 py-3 text-sm"><MarkdownContent content={value} document /></div>
          : <p className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{props.placeholder}</p>)}
      </div>
    </div>
  )
}
