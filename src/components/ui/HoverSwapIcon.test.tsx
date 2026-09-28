// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { BookOpen } from 'lucide-react'
import HoverSwapIcon from './HoverSwapIcon'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(node) })
  return container
}

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('HoverSwapIcon — 悬停置换（ui-interaction-standard §3.1）', () => {
  it('两图层叠放（功能图标 + 箭头）同时存在——不是条件渲染，快速划过不闪烁', () => {
    const el = render(<HoverSwapIcon icon={<BookOpen size={12} />} swap="nav" />)
    // 同一时刻两个 svg 都在 DOM（交叉渐隐而非替换节点）
    expect(el.querySelectorAll('svg')).toHaveLength(2)
    expect(el.querySelector('.lucide-book-open')).toBeTruthy()
    expect(el.querySelector('.lucide-chevron-right')).toBeTruthy()
  })

  it('hover 与 focus-within 双通道触发（键盘等价）', () => {
    const el = render(<HoverSwapIcon icon={<BookOpen size={12} />} swap="nav" />)
    expect(el.innerHTML).toContain('group-hover:opacity-0')
    expect(el.innerHTML).toContain('group-focus-within:opacity-0')
    expect(el.innerHTML).toContain('group-hover:opacity-100')
    expect(el.innerHTML).toContain('group-focus-within:opacity-100')
  })

  it('expand 语义：收起 → ›（ChevronRight）；展开 → ⌄（ChevronDown）', () => {
    const a = render(<HoverSwapIcon icon={<BookOpen size={12} />} swap="expand" expanded={false} />)
    expect(a.querySelector('.lucide-chevron-right')).toBeTruthy()
    act(() => root?.unmount()); container?.remove()
    const b = render(<HoverSwapIcon icon={<BookOpen size={12} />} swap="expand" expanded />)
    expect(b.querySelector('.lucide-chevron-down')).toBeTruthy()
  })

  it('nav 语义：ChevronRight（›）', () => {
    const el = render(<HoverSwapIcon icon={<BookOpen size={12} />} swap="nav" />)
    expect(el.querySelector('.lucide-chevron-right')).toBeTruthy()
    expect(el.querySelectorAll('svg')[0].classList.contains('lucide-chevron-right')).toBe(false)
  })
})
