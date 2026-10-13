// @vitest-environment jsdom
/**
 * TurnErrorRow + RunningStatus — 错误行与计时行契约（线② · dsh 照搬）
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import TurnErrorRow from './TurnErrorRow'
import RunningStatus from './RunningStatus'

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

describe('TurnErrorRow — Turn 级错误行（线② · dsh 照搬）', () => {
  it('状态点（error）+ 人类化文案，可选 code 标签', () => {
    const el = render(<TurnErrorRow message="模型调用超时" code="TIMEOUT" />)
    expect(el.querySelector('[data-state="error"]')).toBeTruthy()
    expect(el.textContent).toContain('生成出错')
    expect(el.textContent).toContain('模型调用超时')
    expect(el.textContent).toContain('TIMEOUT')
  })

  it('无 code 时不渲染 code 标签', () => {
    const el = render(<TurnErrorRow message="失败" />)
    expect(el.querySelector('code')).toBeFalsy()
  })
})

describe('RunningStatus — turn 运行计时行（线② · dsh 照搬）', () => {
  it('运行中显示「生成中，用时」+ 实时计时', () => {
    const start = Date.now() - 3000
    const el = render(<RunningStatus startTime={start} running />)
    expect(el.textContent).toContain('生成中')
    expect(el.textContent).toContain('s')
  })

  it('结束后显示「已完成，用时」', () => {
    const start = Date.now() - 5000
    const el = render(<RunningStatus startTime={start} running={false} />)
    expect(el.textContent).toContain('已完成')
  })
})
