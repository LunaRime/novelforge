import { useCallback, useLayoutEffect, useRef, type RefCallback, type RefObject } from 'react'

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
): RefCallback<T> {
  const { placement = 'above', align = 'start', offset = 6 } = options
  const elRef = useRef<T | null>(null)

  const position = useCallback(() => {
    const el = elRef.current
    const anchor = anchorRef.current
    if (!el || !anchor) return

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
  }, [anchorRef, placement, align, offset])

  /**
   * ⚠️ 返回**回调 ref** 而不是 RefObject（2026-09-25 修）。
   *
   * 原实现是 `useRef` + `useLayoutEffect([open, anchorRef, ...])`。而 @提及 / 斜杠 / 文件选择
   * 三个菜单传的 `open` **恒为 true**（它们由父组件条件渲染）——于是当菜单因「0 条结果 → return null」
   * 卸载、随后又因重新匹配而挂载时，effect 依赖没有任何变化 → **不会重跑** → 新节点停在初始的
   * `position: fixed; visibility: hidden` 且没有 top/left：**菜单永久隐形，却仍挂着键盘监听**
   * （回车会把用户根本没看见的第一条命令选走）。复现：输入 `@zzz` 再退格回 `@世`。
   *
   * 回调 ref 在节点每次挂载时立即定位，从根上消除「节点换了但没人重算坐标」这一整类问题
   * （`ContextBudgetBar` 的 `if (!usage) return null` 同隐患，一并覆盖）。
   */
  const setRef = useCallback<RefCallback<T>>((node) => {
    elRef.current = node
    if (node) position()
  }, [position])

  useLayoutEffect(() => {
    if (!open) return
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [open, position])

  return setRef
}
