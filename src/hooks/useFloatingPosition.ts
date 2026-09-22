import { useLayoutEffect, useRef, type RefObject } from 'react'

export interface FloatingPositionOptions {
  /** 相对锚点的展开方向（空间不足时自动翻到另一侧） */
  placement?: 'above' | 'below'
  /** 与锚点的对齐方式 */
  align?: 'start' | 'end'
  /** 与锚点的间距（px） */
  offset?: number
}

/**
 * 让浮层**浮在整个程序窗口之上**：返回一个绑定到菜单元素的 ref，挂载/打开时用锚点位置算出
 * `position: fixed` 坐标并夹在视口内。
 *
 * 为什么用 JS 而不是 CSS 锚点定位（`position-anchor` + `anchor()`）：
 * 后者在「锚点是容器」时**不解析** —— 实测锚点为使用者的祖先、或锚点在 DOM 中排在使用者之后时，
 * 菜单会掉到屏幕外（`[0,-270]`）；只有锚点是按钮本身才好使。JS 计算没有这个限制，
 * 同样不受任何祖先 `overflow` 裁剪（模型菜单曾越界窗口右 25px、主题菜单越界底部 58px）。
 *
 * 用法：
 * ```tsx
 * const anchorRef = useRef<HTMLDivElement>(null)   // 锚在触发按钮/容器上
 * const menuRef = useFloatingPosition<HTMLDivElement>(anchorRef, open, { placement: 'above' })
 * <div ref={anchorRef}>触发按钮</div>
 * {open && <div ref={menuRef} className="..." style={{ position: 'fixed', visibility: 'hidden', zIndex: 'var(--z-dropdown)' }}>菜单</div>}
 * ```
 * ⚠️ 菜单的初始 style 必须带 `position: 'fixed'` 与 `visibility: 'hidden'`（首帧在视口外测量，
 *    定位后本 hook 会把它显示出来），且 `top/left` 不要写死。
 *
 * 实现上**直接写 DOM style**（不走 React state）：避免 effect 里同步 setState 触发
 * `react-hooks/set-state-in-effect`，也省掉一次重渲染。
 */
export function useFloatingPosition<T extends HTMLElement>(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  options: FloatingPositionOptions = {},
): RefObject<T | null> {
  const { placement = 'above', align = 'start', offset = 6 } = options
  const menuRef = useRef<T>(null)

  useLayoutEffect(() => {
    if (!open) return
    const el = menuRef.current
    const anchor = anchorRef.current
    if (!el || !anchor) return

    const position = () => {
      const a = anchor.getBoundingClientRect()
      const m = el.getBoundingClientRect()
      const margin = 8
      // 主方向：优先按 placement，空间不足则翻到另一侧
      let top = placement === 'above' ? a.top - m.height - offset : a.bottom + offset
      if (top < margin) {
        const flipped = a.bottom + offset
        top = flipped + m.height <= innerHeight - margin ? flipped : margin
      }
      if (top + m.height > innerHeight - margin) {
        top = Math.max(margin, innerHeight - margin - m.height)
      }
      // 次方向：与锚点对齐后夹进视口
      let left = align === 'end' ? a.right - m.width : a.left
      left = Math.max(margin, Math.min(left, innerWidth - margin - m.width))

      el.style.position = 'fixed'
      el.style.top = `${Math.round(top)}px`
      el.style.left = `${Math.round(left)}px`
      el.style.visibility = 'visible'
    }

    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [open, anchorRef, placement, align, offset])

  return menuRef
}
