// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import StatusBarThinking from './StatusBarThinking'
import { useThinkingStore } from '../../stores/thinking-store'

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  document.body.innerHTML = ''
  useThinkingStore.setState({ level: 'high', initialized: true })
})

describe('StatusBarThinking', () => {
  it('显示当前档位，切换后写入全局 store', () => {
    const originalSetLevel = useThinkingStore.getState().setLevel
    const setLevel = vi.fn(originalSetLevel)
    useThinkingStore.setState({ setLevel })

    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<StatusBarThinking />) })
    expect(container.textContent).toContain('高')

    act(() => { (container.querySelector('button') as HTMLButtonElement).click() })
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    act(() => {
      // 绕过 React 的 value tracker（直接赋值会被 tracker 同步，合成 onChange 被去重）
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '4')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(setLevel).toHaveBeenCalledTimes(1)
    expect(setLevel).toHaveBeenCalledWith('max')
    expect(useThinkingStore.getState().level).toBe('max')

    // 松手时的原生 change 不应二次写（同一手势只回调一次）
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(setLevel).toHaveBeenCalledTimes(1)

    useThinkingStore.setState({ setLevel: originalSetLevel })
  })
})
