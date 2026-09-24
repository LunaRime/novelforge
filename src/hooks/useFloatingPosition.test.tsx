// @vitest-environment jsdom
/**
 * useFloatingPosition — 浮层定位（含 2026-09-25 修的「重挂载不重定位」回归）
 *
 * 契约：
 * - 节点**每次挂载**都定位（回调 ref），而不是只在 `open` 变化时定位
 * - 空间不足时向上/向下翻转；左右夹进视口
 * - 定位结果写进内联 style（position:fixed / top / left）并把 visibility 打开
 *
 * ⚠️ 回归点（本条最重要）：@提及 / 斜杠 / 文件选择三个菜单传的 `open` **恒为 true**
 * （由父组件条件渲染）。当菜单因「0 条结果 → return null」卸载、随后重新匹配又挂载时，
 * 若实现依赖 `useLayoutEffect([open, ...])` 则**不会重跑** —— 新节点停在初始
 * `visibility: hidden` 且无 top/left：**菜单永久隐形、却仍挂着键盘监听**（回车会把用户
 * 根本没看见的第一条命令选走）。复现：输入 `@zzz` 再退格回 `@世`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act, useRef } from 'react'
import { useFloatingPosition } from './useFloatingPosition'

const ANCHOR = { top: 300, left: 300, width: 20, height: 20 }
const MENU = { width: 200, height: 100 }

/** jsdom 没有布局引擎：按元素上是否有 `data-menu` 返回伪造的 rect */
function fakeRect(r: { top: number; left: number; width: number; height: number }): DOMRect {
  return {
    ...r,
    right: r.left + r.width,
    bottom: r.top + r.height,
    x: r.left,
    y: r.top,
    toJSON: () => ({}),
  } as DOMRect
}

let anchorRect = { ...ANCHOR }
const originalRect = Element.prototype.getBoundingClientRect

beforeEach(() => {
  anchorRect = { ...ANCHOR }
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.hasAttribute('data-menu') ? fakeRect({ ...MENU, top: 0, left: 0 }) : fakeRect(anchorRect)
  } as typeof Element.prototype.getBoundingClientRect
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect
  document.body.innerHTML = ''
})

function Harness({ show }: { show: boolean }): React.ReactElement {
  const anchorRef = useRef<HTMLDivElement>(null)
  // open 恒为 true —— 与三个自动菜单的真实用法一致
  const menuRef = useFloatingPosition<HTMLDivElement>(anchorRef, true)
  return (
    <div>
      <div ref={anchorRef}>anchor</div>
      {show && (
        <div ref={menuRef} data-menu style={{ position: 'fixed', visibility: 'hidden', top: 0, left: 0 }}>
          menu
        </div>
      )}
    </div>
  )
}

function mount(): { root: Root; container: HTMLElement } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<Harness show />) })
  return { root, container }
}

const menu = (container: HTMLElement): HTMLElement =>
  container.querySelector('[data-menu]') as HTMLElement

describe('useFloatingPosition', () => {
  it('挂载即定位：算出坐标并把 visibility 打开（初始在视口外隐藏，定位后显示）', () => {
    const { container } = mount()
    const el = menu(container)

    expect(el.style.visibility).toBe('visible')
    expect(el.style.position).toBe('fixed')
    // above + offset 6：锚点 top 300 − 菜单高 100 − 6
    expect(el.style.top).toBe('194px')
    // align start：左缘与锚点对齐
    expect(el.style.left).toBe('300px')
  })

  it('回归：卸载后重新挂载**仍会被定位**（不能停在初始的 hidden / 0,0）', () => {
    const { root, container } = mount()
    expect(menu(container).style.visibility).toBe('visible')

    // 模拟「0 条结果 → return null」
    act(() => { root.render(<Harness show={false} />) })
    expect(container.querySelector('[data-menu]')).toBeNull()

    // 模拟「重新匹配 → 又挂载」
    act(() => { root.render(<Harness show />) })
    const remounted = menu(container)
    expect(remounted.style.visibility).toBe('visible')
    expect(remounted.style.top).toBe('194px')
    expect(remounted.style.left).toBe('300px')
  })

  it('左右夹取：锚点贴近右缘时菜单不越出视口', () => {
    anchorRect = { top: 300, left: 1000, width: 20, height: 20 } // 1000 + 200 > innerWidth
    const { container } = mount()

    // innerWidth(1024) − margin(8) − 宽(200) = 816
    expect(menu(container).style.left).toBe('816px')
  })

  it('上方空间不足 → 翻到锚点下方', () => {
    anchorRect = { top: 50, left: 300, width: 20, height: 20 }
    const { container } = mount()

    // 50 − 100 − 6 < 8 → 翻到 bottom(70) + offset(6)
    expect(menu(container).style.top).toBe('76px')
  })
})
