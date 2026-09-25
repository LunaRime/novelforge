import React from 'react'
import { cn } from '../../lib/utils'

export type PopoverPlacement = 'above-start' | 'above-end' | 'below-start' | 'below-end'

interface Props {
  children: React.ReactNode
  /**
   * JS 定位模式：直接接 `useFloatingPosition` 返回的回调 ref。
   * 与 `anchorName` 二选一——同时给时以本模式为准（会带上 `position: fixed; visibility: hidden`）。
   * 只接受回调 ref：那是 hook 的返回形态，写死坐标的 RefObject 会让首帧定位落空。
   */
  ref?: React.RefCallback<HTMLDivElement>
  /**
   * CSS 锚点模式：锚点按钮上 `style={{ anchorName: '--menu-x' }}` 的名字。
   * 由 `index.css` 的 `.floating-menu` 负责定位与超界翻转。
   */
  anchorName?: string
  /** 仅 CSS 锚点模式生效，默认 `above-end` */
  placement?: PopoverPlacement
  className?: string
  style?: React.CSSProperties
}

/**
 * 下拉浮层的共用视觉外壳 —— **只管外观，不管行为**。
 *
 * 它不持有开关状态、不接管定位算法、不挂 Esc/点击外部（那些仍由调用方与
 * `useFloatingPosition` / `useEscapeKey` / `useOutsideClick` 各自负责）。
 * 收敛的只有此前 10 处各自内联的同一份外壳：底色 `--color-sidebar`、描边
 * `--color-border`、阴影 `--shadow-popover`、圆角 `rounded-lg`，以及两种定位机制
 * 各自的初始样式契约。
 *
 * ⚠️ 两种模式的差别不是风格选择，而是**契约不同**：
 * - JS 模式必须带 `position: fixed; visibility: hidden`——浮层首帧在视口外测量，
 *   定位后由 hook 改写成实际坐标并置为 visible；
 * - 锚点模式**绝不能带 `visibility: hidden`**——这条路上没有 hook 去把它改回来，
 *   带上就是永久隐形（且仍挂着键盘监听，用户看不见却能选走条目）。
 *
 * 用法：
 * ```tsx
 * // JS 定位（锚点是容器时用；见 useFloatingPosition 的说明）
 * const menuRef = useFloatingPosition<HTMLDivElement>(anchorRef, open, { placement: 'above' })
 * <PopoverSurface ref={menuRef} className="py-1" style={{ width: 240 }}>…</PopoverSurface>
 *
 * // CSS 锚点（锚点是按钮本身时用）
 * <PopoverSurface anchorName="--menu-model" className="py-1" style={{ width: 220 }}>…</PopoverSurface>
 * ```
 */
export function PopoverSurface({
  children,
  ref,
  anchorName,
  placement = 'above-end',
  className,
  style,
}: Props) {
  const anchorMode = anchorName != null

  return (
    <div
      ref={ref}
      className={cn(
        anchorMode ? `floating-menu floating-menu--${placement}` : 'z-[var(--z-dropdown)]',
        'rounded-lg',
        className,
      )}
      style={
        {
          backgroundColor: 'var(--color-sidebar)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-popover)',
          ...(anchorMode
            ? { positionAnchor: anchorName }
            : { position: 'fixed', visibility: 'hidden' }),
          /* 调用方最后覆盖：宽度/内边距/最大高度等个体差异由此传入 */
          ...style,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  )
}
