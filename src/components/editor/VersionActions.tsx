import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Ellipsis } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { useOutsideClick } from '../../hooks/useOutsideClick'
import { Button, type ButtonProps } from '../ui/Button'
import { MenuItem } from '../ui/MenuItem'
import { PopoverSurface } from '../ui/PopoverSurface'

export interface VersionAction {
  label: string
  icon?: ReactNode
  title?: string
  disabled?: boolean
  variant?: ButtonProps['variant']
  onSelect: () => void
}

export function VersionActions({ actions, wideExtra, overflowExtra = [] }: {
  actions: VersionAction[]
  wideExtra?: ReactNode
  overflowExtra?: VersionAction[]
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const id = useId()
  const anchor = `--version-actions-${id.replace(/[^a-z0-9_-]/gi, '')}`
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  useOutsideClick(root, close, open)

  useEffect(() => {
    if (!open || !list.current) return
    const panel = list.current.parentElement
    panel?.showPopover?.()
    const first = list.current.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? list.current
    first.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  if (actions.length === 0 && overflowExtra.length === 0) return null

  return <>
    <div className="nf-version-actions-wide items-center gap-1.5">
      {wideExtra}
      {actions.map(({ label, icon, title, variant, disabled, onSelect }) => (
        <Button key={label} type="button" size="sm" variant={variant ?? 'outline'}
          disabled={disabled} title={title} onClick={onSelect}>
          {icon}{label}
        </Button>
      ))}
    </div>
    <div className="nf-version-actions-narrow shrink-0" ref={root}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      <Button ref={trigger} type="button" variant="ghost" size="icon" className="size-[32px] p-0"
        style={{ anchorName: anchor }} aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={t('tip.moreOptions')} title={t('tip.moreOptions')}
        onClick={() => setOpen(value => !value)}>
        <Ellipsis size={16} aria-hidden="true" />
      </Button>
      {open && (
        <PopoverSurface id={id} popover="manual" anchorName={anchor} placement="below-end"
          className="w-max min-w-40 max-w-[calc(100vw-16px)] p-1"
          style={{ left: 'auto', bottom: 'auto', marginInline: 0, marginBottom: 0 }}>
          <div ref={list} role="group" aria-label={t('tip.moreOptions')} tabIndex={-1}>
            {[...actions, ...overflowExtra].map(({ label, icon, disabled, onSelect }) => (
              <MenuItem key={label} label={label} icon={icon} disabled={disabled} onClick={() => {
                close()
                onSelect()
              }} />
            ))}
          </div>
        </PopoverSurface>
      )}
    </div>
  </>
}
