// @vitest-environment jsdom
/**
 * useEscapeKey — Esc 关闭浮层
 *
 * 契约：active 时按 Esc 调用 onClose；active=false 时不监听（不该关掉已关的东西）；
 * 卸载即移除监听（不泄漏）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useEscapeKey } from './useEscapeKey'

function Harness({ active, onClose }: { active: boolean; onClose: () => void }): null {
  useEscapeKey(onClose, active)
  return null
}

const roots: Root[] = []

function render(ui: React.ReactElement): void {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  roots.push(root)
}

function pressEscape(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })
}

afterEach(() => {
  for (const r of roots.splice(0)) act(() => { r.unmount() })
  document.body.innerHTML = ''
})

describe('useEscapeKey', () => {
  it('active 时按 Esc → 调用 onClose', () => {
    const onClose = vi.fn()
    render(<Harness active onClose={onClose} />)

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('active=false 时不监听（不该关掉已关闭的浮层）', () => {
    const onClose = vi.fn()
    render(<Harness active={false} onClose={onClose} />)

    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('非 Esc 键不触发', () => {
    const onClose = vi.fn()
    render(<Harness active onClose={onClose} />)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('卸载后移除监听（不泄漏）', () => {
    const onClose = vi.fn()
    render(<Harness active onClose={onClose} />)
    act(() => { roots.splice(0).forEach((r) => r.unmount()) })

    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
  })
})
