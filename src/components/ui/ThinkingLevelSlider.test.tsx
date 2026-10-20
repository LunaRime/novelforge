// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import ThinkingLevelSlider from './ThinkingLevelSlider'

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

describe('ThinkingLevelSlider', () => {
  it('渲染四个档位节点，拖动到 Max 回调 max', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const onChange = vi.fn()
    act(() => { createRoot(container).render(<ThinkingLevelSlider value="low" onChange={onChange} />) })
    expect(container.querySelectorAll('[data-thinking-node]').length).toBe(4)
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    act(() => {
      // 绕过 React 的 value tracker（直接赋值会被 tracker 同步，合成 onChange 被去重）
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '4')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      // range 释放时的原生 change 不应造成第二次回调
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('max')
  })

  it('showDescription 时显示当前档位描述', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<ThinkingLevelSlider value="high" onChange={() => {}} showDescription />) })
    expect(container.textContent).toContain('深度规划')
  })
})
