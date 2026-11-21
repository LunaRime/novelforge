// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { FilterButtons, OptionCards, ViewTabs } from './ChoiceControls'

const items = [{ value: 'one', label: '一' }, { value: 'two', label: '二' }]

it.each([
  { appearance: 'tabs', Control: ViewTabs },
  { appearance: 'cards', Control: OptionCards },
  { appearance: 'filters', Control: FilterButtons },
])('三种形态通过同一受控接口处理选中与禁用（$appearance）', ({ appearance, Control }) => {
  const container = document.createElement('div')
  const root = createRoot(container)
  const onChange = vi.fn()
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previous = globals.IS_REACT_ACT_ENVIRONMENT
  globals.IS_REACT_ACT_ENVIRONMENT = true
  try {
    act(() => root.render(<Control items={items} value="one" onChange={onChange} />))
    const choices = container.querySelector(`[data-appearance="${appearance}"]`)
    const buttons = choices!.querySelectorAll('button')
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false')
    act(() => buttons[1].click())
    expect(onChange).toHaveBeenCalledWith('two')
    act(() => root.render(<Control items={items} value="two" onChange={onChange} disabled />))
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true')
    expect(Array.from(buttons).every(button => button.disabled)).toBe(true)
  } finally {
    act(() => root.unmount())
    globals.IS_REACT_ACT_ENVIRONMENT = previous
  }
})
