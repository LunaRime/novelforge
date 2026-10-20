// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
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
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<StatusBarThinking />) })
    expect(container.textContent).toContain('高')

    act(() => { (container.querySelector('button') as HTMLButtonElement).click() })
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    act(() => {
      input.value = '4'
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(useThinkingStore.getState().level).toBe('max')
  })
})