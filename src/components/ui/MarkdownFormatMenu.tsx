import { useCallback, useRef, useState } from 'react'
import { Bold, Code, Heading, Italic, Link2, List, Quote, Strikethrough, TextCursorInput } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { Button } from './Button'
import { ContextMenu } from './ContextMenu'
import { markdownFormats, type MarkdownFormat } from './markdown-format'

const icons = { heading: Heading, bold: Bold, italic: Italic, strike: Strikethrough, quote: Quote, list: List, code: Code, link: Link2 }

export default function MarkdownFormatMenu({ onFormat, compact, disabled }: {
  onFormat: (format: MarkdownFormat) => void
  compact?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const label = t('editor.markdownTools')
  return <>
    <Button ref={anchor} type="button" size={compact ? 'icon' : 'sm'} variant="ghost" title={label} aria-label={label}
      aria-haspopup="menu" aria-expanded={open} active={open} disabled={disabled}
      onMouseDown={event => event.preventDefault()} onClick={() => setOpen(value => !value)}>
      <TextCursorInput size={15} aria-hidden="true" />{!compact && 'Markdown'}
    </Button>
    {open && !disabled && <ContextMenu anchor={anchor} label={label} onClose={close} items={markdownFormats.map(([id, key]) => {
      const Icon = icons[id]
      return { key: id, label: t(key), icon: <Icon size={14} aria-hidden="true" />, onClick: () => onFormat(id) }
    })} />}
  </>
}
