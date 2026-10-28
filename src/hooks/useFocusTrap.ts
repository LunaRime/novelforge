import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * 模态焦点陷阱 + 焦点归还（审计 P0-5 / 批次 2）
 *
 * 打开时把焦点移入容器，Tab / Shift+Tab 在容器内循环；关闭时还给打开前的元素。
 * 不做 aria-hidden 背景，只解决「Tab 逃到背景」与「关掉后焦点丢失」两个可感知问题。
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusables = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(el => el.getClientRects().length > 0)

    const first = focusables()[0]
    first?.focus()

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) return
      const index = list.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey) {
        if (index <= 0) {
          e.preventDefault()
          list[list.length - 1].focus()
        }
        return
      }
      if (index === -1 || index === list.length - 1) {
        e.preventDefault()
        list[0].focus()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [containerRef, active])
}
