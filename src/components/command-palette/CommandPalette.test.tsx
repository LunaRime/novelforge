// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import CommandPalette from './CommandPalette'
import { useCommandStore } from '../../stores/command-store'
import { useLayoutStore } from '../../stores/layout-store'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<CommandPalette />) })
  return container
}

function key(target: HTMLElement, value: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))
  })
}

describe('CommandPalette（Cmd+K）', () => {
  beforeEach(() => {
    useCommandStore.setState({ open: true, mode: 'commands' })
    useLayoutStore.setState({ newProjectOpen: false, settingsOpen: false })
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    useCommandStore.setState({ open: false, mode: 'commands' })
  })

  it('渲染搜索框与命令分组', () => {
    const box = render()
    expect(box.querySelector('input')).toBeTruthy()
    expect(box.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('命令面板')
    expect(box.textContent).toContain('新建项目')
    expect(box.textContent).toContain('快捷键速查')
  })

  it('搜索过滤 + Enter 执行首项', async () => {
    const box = render()
    const input = box.querySelector('input')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '新建项目')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {})
    expect(box.textContent).toContain('新建项目')
    expect(box.textContent).not.toContain('切换侧边栏')
    key(input, 'Enter')
    await act(async () => {})
    expect(useLayoutStore.getState().newProjectOpen).toBe(true)
    expect(useCommandStore.getState().open).toBe(false)
  })

  it('Esc 关闭面板', () => {
    const box = render()
    key(box.querySelector('input')!, 'Escape')
    expect(useCommandStore.getState().open).toBe(false)
  })
})
