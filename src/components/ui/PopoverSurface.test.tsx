// @vitest-environment jsdom
/**
 * PopoverSurface — 下拉浮层的共用视觉外壳（2026-09-25 收敛，批次 4 剩余项 1）
 *
 * 收敛前 10 处浮层各自内联同一份外壳（底色/描边/阴影/圆角 + 定位契约），
 * 本测试锁住这份外壳的**契约**，防止将来又各自漂移：
 *
 * 1. JS 定位模式（配合 useFloatingPosition）：必须带 `position: fixed` + `visibility: hidden`
 *    —— hook 的落地前提，首帧在视口外测量、定位后由 hook 改写为 visible
 * 2. CSS 锚点模式（配合 index.css 的 .floating-menu）：必须带 `floating-menu--*` 类，
 *    且**绝不能带 `visibility: hidden`** —— 这条模式没有 hook 去把它改回来，
 *    一旦带上菜单就永久隐形（却仍挂着键盘监听，用户看不见却能选走条目）
 * 3. 两种模式共用同一套视觉令牌：`--color-sidebar` 底 / `--color-border` 描边 /
 *    `--shadow-popover` 阴影 / `rounded-lg` 圆角
 * 4. className 与 style 透传，且 style 能覆盖默认值（调用方要传宽度/内边距/最大高度）
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { PopoverSurface } from './PopoverSurface'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(node)
  })
  return container.firstElementChild as HTMLElement
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

/** 内联 style 的原始文本——`var()` 在 jsdom 的 CSSStyleDeclaration 里不一定能回读 */
const rawStyle = (el: HTMLElement) => el.getAttribute('style') ?? ''

describe('PopoverSurface', () => {
  describe('JS 定位模式', () => {
    it('带 useFloatingPosition 要求的初始样式：position fixed + visibility hidden', () => {
      const el = render(<PopoverSurface>菜单</PopoverSurface>)
      expect(el.style.position).toBe('fixed')
      expect(el.style.visibility).toBe('hidden')
    })

    it('带语义层级与圆角类', () => {
      const el = render(<PopoverSurface>菜单</PopoverSurface>)
      expect(el.className).toContain('z-[var(--z-dropdown)]')
      expect(el.className).toContain('rounded-lg')
    })

    it('ref 拿到真实 DOM 节点（供 hook 写坐标）', () => {
      let node: HTMLDivElement | null = null
      render(<PopoverSurface ref={(n) => { node = n }}>菜单</PopoverSurface>)
      expect(node).toBeInstanceOf(HTMLDivElement)
    })
  })

  describe('CSS 锚点模式', () => {
    it('用 .floating-menu 类定位，默认方向 above-end', () => {
      const el = render(<PopoverSurface anchorName="--menu-x">菜单</PopoverSurface>)
      expect(el.className).toContain('floating-menu')
      expect(el.className).toContain('floating-menu--above-end')
      expect(el.className).not.toContain('z-[var(--z-dropdown)]')
    })

    it('placement 可选：above-start / below-end', () => {
      const above = render(<PopoverSurface anchorName="--m" placement="above-start">菜单</PopoverSurface>)
      expect(above.className).toContain('floating-menu--above-start')
      container?.remove()

      const below = render(<PopoverSurface anchorName="--m" placement="below-end">菜单</PopoverSurface>)
      expect(below.className).toContain('floating-menu--below-end')
    })

    it('⚠️ 绝不带 visibility: hidden —— 该模式没有 hook 把它改回 visible，带上即永久隐形', () => {
      const el = render(<PopoverSurface anchorName="--menu-x">菜单</PopoverSurface>)
      expect(el.style.visibility).not.toBe('hidden')
      expect(rawStyle(el)).not.toContain('visibility')
    })

    it('把锚点名写进 positionAnchor', () => {
      const el = render(<PopoverSurface anchorName="--menu-model">菜单</PopoverSurface>)
      expect(rawStyle(el)).toContain('--menu-model')
    })

    it('锚点模式同样带圆角类', () => {
      const el = render(<PopoverSurface anchorName="--menu-x">菜单</PopoverSurface>)
      expect(el.className).toContain('rounded-lg')
    })
  })

  describe('共用的视觉令牌（两种模式都必须有）', () => {
    it.each([
      ['JS 定位', <PopoverSurface key="js">菜单</PopoverSurface>],
      ['CSS 锚点', <PopoverSurface key="anchor" anchorName="--menu-x">菜单</PopoverSurface>],
    ])('%s：--color-sidebar 底 / --color-border 描边 / --shadow-popover 阴影', (_label, node) => {
      const el = render(node)
      const style = rawStyle(el)
      expect(style).toContain('--color-sidebar')
      expect(style).toContain('--color-border')
      expect(style).toContain('--shadow-popover')
    })
  })

  describe('透传与覆盖', () => {
    it('className 透传（调用方传内边距/最小宽度等个体差异）', () => {
      const el = render(<PopoverSurface className="py-1 min-w-[184px]">菜单</PopoverSurface>)
      expect(el.className).toContain('py-1')
      expect(el.className).toContain('min-w-[184px]')
      expect(el.className).toContain('rounded-lg') // 默认项仍在
    })

    it('style 透传且可覆盖默认值', () => {
      const el = render(<PopoverSurface style={{ width: 240, maxHeight: 300 }}>菜单</PopoverSurface>)
      expect(el.style.width).toBe('240px')
      expect(el.style.maxHeight).toBe('300px')
    })
  })
})
