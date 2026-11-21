import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { MenuItem } from './MenuItem'
import './context-menu.css'

export interface ContextMenuItem {
  key: string
  label: string
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  selected?: boolean
  onClick?: () => void
}

export type ContextMenuEntry = ContextMenuItem | {
  key: string
  type: 'divider' | 'heading'
  label?: string
}

interface CommonProps {
  items: ContextMenuEntry[]
  onClose: () => void
  autoFocus?: boolean
  label?: string
}

type Props = CommonProps & (
  { position: { x: number; y: number }; anchor?: never } |
  { anchor: RefObject<HTMLElement | null>; position?: never }
)

const enabledItems = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLButtonElement>('[role=menuitem]:enabled')]

/** 右键与按钮共用菜单，按实测尺寸夹紧视口，长列表在浮层内滚动。 */
export function ContextMenu({ items, position, anchor, label, onClose, autoFocus = true }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const initialFocus = useRef<HTMLElement | null>(null)
  const x = position?.x
  const y = position?.y
  const restoreFocus = () => (anchor?.current ?? initialFocus.current)?.focus({ preventScroll: true })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const place = () => {
      const rect = anchor?.current?.getBoundingClientRect()
      const gap = 8
      const { width, height } = menu.getBoundingClientRect()
      const left = rect ? rect.right - width : x ?? gap
      const below = rect ? rect.bottom + 4 : y ?? gap
      const top = rect && below + height + gap > innerHeight && rect.top - 4 - height >= gap ? rect.top - 4 - height : below
      menu.style.left = `${Math.max(gap, Math.min(left, innerWidth - width - gap))}px`
      menu.style.top = `${Math.max(gap, Math.min(top, innerHeight - height - gap))}px`
    }
    place()
    window.addEventListener('resize', place)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    observer?.observe(menu)
    return () => { observer?.disconnect(); window.removeEventListener('resize', place) }
  }, [anchor, x, y])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    initialFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (autoFocus) {
      const entries = enabledItems(menu)
      const initial = entries.find(item => item.hasAttribute('aria-current')) ?? entries[0] ?? menu
      initial.focus({ preventScroll: true })
      initial.scrollIntoView?.({ block: 'nearest' })
    }
  }, [autoFocus])

  useLayoutEffect(() => {
    const outside = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Node && !menuRef.current?.contains(target) && !anchor?.current?.contains(target)) onClose()
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onClose()
      const target = anchor?.current ?? initialFocus.current
      target?.focus({ preventScroll: true })
    }
    document.addEventListener('mousedown', outside, true)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', escape) }
  }, [onClose, anchor])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      restoreFocus()
      onClose()
      return
    }
    const list = enabledItems(event.currentTarget)
    if (!list.length || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = list.findIndex(item => item === document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1
      : index < 0 ? (event.key === 'ArrowDown' ? 0 : list.length - 1)
      : (index + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length
    list[next]?.focus()
  }

  return createPortal(
    <div ref={menuRef} role="menu" aria-label={label} tabIndex={-1} className="nf-context-menu"
      onKeyDown={onKeyDown} onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}>
      {items.map(entry => {
        if ('type' in entry) {
          return entry.type === 'divider' ? <div key={entry.key} role="separator" className="nf-context-divider" />
            : <div key={entry.key} className="nf-context-heading">{entry.label}</div>
        }
        return <MenuItem key={entry.key} menuItem label={entry.label} icon={entry.icon} shortcut={entry.shortcut}
          disabled={entry.disabled} danger={entry.danger} selected={entry.selected}
          onClick={() => {
            onClose()
            restoreFocus()
            entry.onClick?.()
          }} />
      })}
    </div>,
    document.body,
  )
}
