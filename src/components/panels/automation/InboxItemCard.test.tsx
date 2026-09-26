// @vitest-environment jsdom
/**
 * InboxItemCard — 自动化收件箱条目卡（D 档 T8）
 *
 * 最关键的不变量：**notify_only 条目绝不渲染执行按钮**（UI 不得绕过用户的策略选择）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import InboxItemCard from './InboxItemCard'
import type { InboxItem } from '../../../services/automation/types'

const actions = vi.hoisted(() => ({
  confirmInboxItem: vi.fn(),
  dismissInboxItem: vi.fn(),
  markInboxRead: vi.fn(),
}))

vi.mock('../../../stores/automation-store', () => ({
  useAutomationStore: () => actions,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(node) })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.clearAllMocks()
})

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'i1', automationId: 'a1', triggerId: 't1', status: 'pending', actionPolicy: 'confirm',
  title: '第 1-3 章已成批', summary: '可运行后处理管线',
  evidence: [{ source: 'chapter', title: '第1章', ref: '1' }],
  fingerprint: 'fp1', createdAt: Date.now(), ...over,
})

describe('InboxItemCard', () => {
  it('confirm 条目 → 渲染「确认运行」与「忽略」', () => {
    const el = render(<InboxItemCard item={item()} />)
    expect(el.textContent).toContain('确认运行')
    expect(el.textContent).toContain('忽略')
  })

  it('notify_only 条目 → 只渲染「忽略」，不出现「确认运行」（策略不得被 UI 绕过）', () => {
    const el = render(<InboxItemCard item={item({ actionPolicy: 'notify_only' })} />)
    expect(el.textContent).not.toContain('确认运行')
    expect(el.textContent).toContain('忽略')
    expect(el.textContent).toContain('仅提醒')
  })

  it('auto_run 条目 → 不渲染任何操作按钮', () => {
    const el = render(<InboxItemCard item={item({ status: 'auto_run', actionPolicy: 'auto_run' })} />)
    expect(el.textContent).not.toContain('确认运行')
    expect(el.textContent).not.toContain('忽略')
  })

  it('证据超过 3 条 → 只显示前 3 条 + 「还有 N 条」', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ source: 'chapter', title: `第${i + 1}章`, ref: String(i + 1) }))
    const el = render(<InboxItemCard item={item({ evidence: many })} />)
    expect(el.textContent).toContain('第1章')
    expect(el.textContent).toContain('第3章')
    expect(el.textContent).not.toContain('第4章')
    expect(el.textContent).toContain('还有 2 条')
  })

  it('actionError 存在 → 在卡片上可见（执行失败不静默）', () => {
    const el = render(<InboxItemCard item={item({ actionError: 'no default model' })} />)
    expect(el.textContent).toContain('no default model')
  })

  it('点「确认运行」→ 调用 store 的 confirmInboxItem(id)', () => {
    render(<InboxItemCard item={item()} />)
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('确认运行'))!
    act(() => btn.click())
    expect(actions.confirmInboxItem).toHaveBeenCalledWith('i1')
  })
})
