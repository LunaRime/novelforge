// @vitest-environment jsdom
/**
 * ThinkingCollapse — 头部可供性契约（2026-09-27 修复）
 *
 * 修复前：折叠箭头在右端（与「进入」语义冲突）；按钮无 hover 反馈（可点却无暗示）。
 * 修复后：箭头置左 + hover 底色；整行原生 button 的形态不变。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ThinkingCollapse from './ThinkingCollapse'

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
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  g.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ThinkingCollapse — 头部可供性（2026-09-27）', () => {
  it('整行原生 button：可聚焦、点击展开/收起、箭头在最前（左端）、带 hover 反馈类', async () => {
    const el = render(<ThinkingCollapse thinking={'正文思考内容'} />)
    const btn = el.querySelector('button') as HTMLButtonElement
    expect(btn).toBeTruthy()
    btn.focus()
    expect(document.activeElement).toBe(btn)
    // hover 反馈（可点必须有暗示）
    expect(btn.className).toContain('hover:bg-')
    // 折叠箭头置左 = 第一个子元素
    expect(btn.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    // 默认折叠：正文不可见
    expect(el.textContent).not.toContain('正文思考内容')
    await act(async () => { btn.click() })
    expect(el.textContent).toContain('正文思考内容')
    await act(async () => { btn.click() })
    expect(el.textContent).not.toContain('正文思考内容')
  })

  it('无 button 嵌 button', () => {
    const el = render(<ThinkingCollapse thinking={'x'} />)
    expect(el.querySelectorAll('button button')).toHaveLength(0)
  })
})
