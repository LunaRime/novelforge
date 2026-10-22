// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import CountBadge from './CountBadge'

beforeAll(() => {
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  g.IS_REACT_ACT_ENVIRONMENT = true
})

const cleanups: Array<() => void> = []

function render(node: React.ReactNode): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(node) })
  cleanups.push(() => { act(() => root.unmount()); container.remove() })
  return container
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

describe('CountBadge — 计数徽标', () => {
  it('渲染 current/total + 单位，数字使用等宽对齐', () => {
    const el = render(<CountBadge value={4} total={4} unit="章" tone="success" />)
    expect(el.textContent).toContain('4/4')
    expect(el.textContent).toContain('章')
    expect((el.firstElementChild as HTMLElement).className).toContain('tabular-nums')
  })

  it('progress：按比例绘制 2px 进度条；无 total 时不渲染', () => {
    const withProgress = render(<CountBadge value={2} total={4} progress tone="warning" />)
    const bar = withProgress.querySelector('[data-count-progress]') as HTMLElement
    expect(bar).toBeTruthy()
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('50%')

    const withoutProgress = render(<CountBadge value={2} progress />)
    expect(withoutProgress.querySelector('[data-count-progress]')).toBeFalsy()
  })

  it('字符串值（待生成）不按数字解析，也不绘制进度', () => {
    const el = render(<CountBadge value="待生成" progress total={4} />)
    expect(el.textContent).toContain('待生成/4')
    expect(el.querySelector('[data-count-progress]')).toBeFalsy()
  })
})
