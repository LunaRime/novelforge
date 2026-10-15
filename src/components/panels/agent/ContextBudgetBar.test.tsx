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
import { t } from '../../../shared/locale'

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

  // ===== S1：token 引擎降级必须可见（预算偏保守，否则用户无法解释"压缩怎么这么频繁"）=====
  it('S1：降级时明细弹层出现降级标记；默认（精确口径）不出现', () => {
    const degraded = render(<ContextBudgetBar usage={usage()} tokenEngineDegraded />)
    openPopover()
    expect(degraded.textContent).toContain(t('ccr.tokenDegradedBadge'))
  })

  it('S1：未降级 → 不显示标记（零变化）', () => {
    const normal = render(<ContextBudgetBar usage={usage()} />)
    openPopover()
    expect(normal.textContent).not.toContain(t('ccr.tokenDegradedBadge'))
  })

  // ===== 2026-10 §2.4：明细行统一到 MetricChip 语言（标签左 / 值右 / title 给来源）=====
  // 数值口径一个都不能变（token 估算 · 字符数 / 聚合四段原始值），故这里既钉形状也钉数值。
  it('逐段明细 = 三段 chip：标签左、值右、来源挂 title，数值口径不变（token · 字符数）', () => {
    const el = render(<ContextBudgetBar usage={usage()} />)
    openPopover()
    const chips = [...el.querySelectorAll('[data-metric-chip]')] as HTMLElement[]
    expect(chips).toHaveLength(usage().segments!.length)
    const tools = chips.find(c => c.textContent?.includes(t('context.seg.tools')))!
    expect(tools).toBeTruthy()
    expect(tools.querySelector('[data-metric-label]')!.textContent).toBe(t('context.seg.tools'))
    expect(tools.querySelector('[data-metric-value]')!.textContent).toBe('60 · 210')
    expect(tools.getAttribute('title')).toBe('23 个工具说明')
  })

  it('截断段走警示语气 + 标记；普通段中性（信号不再靠正文里的裸符号）', () => {
    const el = render(<ContextBudgetBar usage={usage()} />)
    openPopover()
    const chips = [...el.querySelectorAll('[data-metric-chip]')] as HTMLElement[]
    const tools = chips.find(c => c.textContent?.includes(t('context.seg.tools')))!
    expect(tools.getAttribute('data-tone')).toBe('warn')
    expect(tools.textContent).toContain('✂')
    const identity = chips.find(c => c.textContent?.includes(t('context.seg.identity')))!
    expect(identity.getAttribute('data-tone')).toBe('neutral')
    expect(identity.textContent).not.toContain('✂')
  })

  it('常驻告警：⚠ 优先于 ✂，原因与来源一起进 title（悬停整片即得）', () => {
    const el = render(<ContextBudgetBar usage={usage({
      segments: [{
        key: 'memory-resident', tokens: 0, chars: 0, truncated: true,
        source: 'book-state.md', warning: '常驻超上限（4000 tokens），本轮未注入',
      }],
    })} />)
    openPopover()
    const chip = el.querySelector('[data-metric-chip]') as HTMLElement
    expect(chip.textContent).toContain('⚠')
    expect(chip.textContent).not.toContain('✂')
    expect(chip.getAttribute('data-tone')).toBe('warn')
    expect(chip.getAttribute('title')).toContain('book-state.md')
    expect(chip.getAttribute('title')).toContain('4000')
  })

  it('无 segments（旧数据）：聚合四段同样是 chip，数值口径不变', () => {
    const el = render(<ContextBudgetBar usage={usage({ segments: undefined, prefix: undefined })} />)
    openPopover()
    const chips = [...el.querySelectorAll('[data-metric-chip]')] as HTMLElement[]
    expect(chips).toHaveLength(4)
    expect(chips.map(c => c.querySelector('[data-metric-value]')!.textContent)).toEqual(['100', '50', '200', '30'])
    expect(chips.map(c => c.querySelector('[data-metric-label]')!.textContent))
      .toEqual([t('ccr.segBase'), t('ccr.segMemory'), t('ccr.segHistory'), t('ccr.segCurrent')])
  })
})
