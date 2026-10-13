// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Wrench } from 'lucide-react'
import { StateDot } from './StateDot'
import { DisclosureRow } from './DisclosureRow'
import { TextShimmer } from './TextShimmer'

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

describe('StateDot — 全站统一状态点五态（线② · dsh 照搬）', () => {
  it('solid 态（done/warning/error/idle）画 6px 核心（10px 槽位）', () => {
    for (const state of ['done', 'warning', 'error', 'idle'] as const) {
      const el = render(<StateDot state={state} />)
      expect(el.querySelector(`[data-state="${state}"]`)).toBeTruthy()
      act(() => root?.unmount()); container?.remove()
    }
  })

  it('ongoing 态渲染旋转环（svg + data-state）', () => {
    const el = render(<StateDot state="ongoing" />)
    expect(el.querySelector('svg[data-state="ongoing"]')).toBeTruthy()
  })

  it('step 形态：done 时填充 + 对勾', () => {
    const el = render(<StateDot state="done" appearance="step" />)
    expect(el.querySelector('[data-state="done"] svg')).toBeTruthy()
  })

  it('step 形态：pending（idle）时描边空心', () => {
    const el = render(<StateDot state="idle" appearance="step" />)
    const dot = el.querySelector('[data-state="idle"]') as HTMLElement
    expect(dot.querySelector('svg')).toBeFalsy()
  })
})

describe('DisclosureRow — 24px 流程行（线② · dsh 照搬）', () => {
  it('收起态：语义图标 + 下折角（悬停置换）两图层同时存在', () => {
    const el = render(
      <DisclosureRow icon={<Wrench size={14} />} title="read_file" open={false} expandable onToggle={() => {}} />,
    )
    expect(el.querySelector('.lucide-wrench')).toBeTruthy()
    expect(el.querySelector('.lucide-chevron-down')).toBeTruthy()
  })

  it('展开态：固定上折角（⌃），无置换', () => {
    const el = render(
      <DisclosureRow icon={<Wrench size={14} />} title="read_file" open expandable onToggle={() => {}} />,
    )
    expect(el.querySelector('.lucide-chevron-up')).toBeTruthy()
    expect(el.querySelector('.lucide-chevron-down')).toBeFalsy()
  })

  it('前导按钮独立承载折叠（button button 不嵌套，键盘可达）', () => {
    const el = render(
      <DisclosureRow icon={<Wrench size={14} />} title="t" open={false} expandable onToggle={() => {}} />,
    )
    expect(el.querySelectorAll('button')).toHaveLength(1)
  })

  it('展开体仅在 open 时渲染', () => {
    const a = render(
      <DisclosureRow icon={<Wrench size={14} />} title="t" open={false} expandable onToggle={() => {}}>
        <div data-test-body />
      </DisclosureRow>,
    )
    expect(a.querySelector('[data-test-body]')).toBeFalsy()
    act(() => root?.unmount()); container?.remove()
    const b = render(
      <DisclosureRow icon={<Wrench size={14} />} title="t" open expandable onToggle={() => {}}>
        <div data-test-body />
      </DisclosureRow>,
    )
    expect(b.querySelector('[data-test-body]')).toBeTruthy()
  })
})

describe('TextShimmer — 流式扫光（线② · dsh 照搬）', () => {
  it('active 时叠加 inert 装饰副本（扫光），原文仍在', () => {
    const el = render(<TextShimmer active>正在读取文件</TextShimmer>)
    // 装饰副本 aria-hidden（读屏只读原文），且含原文内容
    const deco = el.querySelector('[aria-hidden="true"]')
    expect(deco).toBeTruthy()
    expect(deco!.textContent).toContain('正在读取文件')
  })

  it('非 active 时不叠加装饰副本', () => {
    const el = render(<TextShimmer active={false}>完成</TextShimmer>)
    expect(el.querySelector('[aria-hidden="true"]')).toBeFalsy()
  })
})
