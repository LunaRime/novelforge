// @vitest-environment jsdom
/**
 * ContextBudgetBar 明细弹层测试（B 档第二轮 T6）
 *
 * 靶点：弹层此前只有 4 个聚合数字 —— 无法回答"这段来自哪、占多少字节"；
 * 且面板的历史值与**实发**值不同（发送前还要裁一次），必须分列而非混为一谈。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ContextBudgetBar from './ContextBudgetBar'
import type { ContextUsage } from '../../../services/agent/context-usage'

const usage = (over: Partial<ContextUsage> = {}): ContextUsage => ({
  base: 100, memory: 50, history: 200, current: 30, modelMax: 10000, total: 380,
  segments: [
    { key: 'identity', tokens: 40, chars: 120 },
    { key: 'tools', tokens: 60, chars: 210, source: '23 个工具说明', truncated: true },
    { key: 'memory-m1', tokens: 50, chars: 180, source: '会话摘要（M1 滚动）' },
  ],
  historyPanelTokens: 200,
  historySentTokens: 150,
  prefix: { changed: true, sharedChars: 42 },
  ...over,
})

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(node) })
  return container
}

const openPopover = () => {
  const btn = document.querySelector('button')!
  act(() => btn.click())
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ContextBudgetBar 明细弹层（B 档第二轮 T6）', () => {
  it('逐段明细：每段给出 token 与字符数', () => {
    const el = render(<ContextBudgetBar usage={usage()} />)
    openPopover()
    const text = el.textContent ?? ''
    expect(text).toContain('120')          // identity 的字符数
    expect(text).toContain('210')          // tools 的字符数
    // 来源挂在 title（悬停可查"这段来自哪"）
    expect(el.querySelector('[title="23 个工具说明"]')).toBeTruthy()
  })

  it('面板值 vs 实发值分列（口径诚实，不混为一个数）', () => {
    const el = render(<ContextBudgetBar usage={usage()} />)
    openPopover()
    const text = el.textContent ?? ''
    expect(text).toMatch(/150/)            // 实发
    expect(text).toMatch(/200/)            // 面板
  })

  it('前缀行：变化时显示共享字符数', () => {
    const el = render(<ContextBudgetBar usage={usage()} />)
    openPopover()
    expect(el.textContent).toContain('42')
  })

  it('无 segments（旧数据）时不崩、仍显示聚合四段', () => {
    const el = render(<ContextBudgetBar usage={usage({ segments: undefined, prefix: undefined })} />)
    openPopover()
    expect(el.textContent).toContain('380')
  })
})
