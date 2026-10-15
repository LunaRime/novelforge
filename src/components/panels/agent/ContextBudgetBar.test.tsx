// @vitest-environment jsdom
/**
 * ContextBudgetBar 明细弹层测试
 *
 * 靶点：弹层此前只有 4 个聚合数字 —— 无法回答"这段来自哪、占多少字节"；
 * 且面板的历史值与**实发**值不同（发送前还要裁一次），必须分列而非混为一谈。
 *
 * ⚠️ 2026-10-16 用户要求：明细面板改成 **DSH `ContextMeter` 同款样式**（可本地特色化）——
 * 标题行（占比 + `~已用 / 上限`）+ 4px 分段条（各段按占比着色、总长 = 占用百分比）+
 * `dl` 明细行（8px 色块 + 段名左、token 数右）。以前那套「每段一个 MetricChip」已移除。
 * 本文件按**新形态**钉住：数值口径、分段条宽度总和、告警标记、口径行（实发/前缀/降级）一个都不许丢。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ContextBudgetBar from './ContextBudgetBar'
import type { ContextUsage } from '../../../services/agent/context-usage'
import { t } from '../../../shared/locale'

const usage = (over: Partial<ContextUsage> = {}): ContextUsage => ({
  base: 1000, memory: 500, history: 2000, current: 500, modelMax: 10000, total: 4000,
  segments: [
    { key: 'identity', tokens: 400, chars: 120 },
    { key: 'tools', tokens: 600, chars: 210, source: '23 个工具说明', truncated: true },
    { key: 'memory-m1', tokens: 500, chars: 180, source: '会话摘要（M1 滚动）' },
  ],
  historyPanelTokens: 2000,
  historySentTokens: 1500,
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

/** 明细行（按段 key 取） */
const rowOf = (el: HTMLElement, key: string) =>
  el.querySelector<HTMLElement>(`[data-budget-row="${key}"]`)

describe('ContextBudgetBar 明细弹层', () => {
  it('分段条：总长 = 占用百分比，各段按占比分成四色（DSH 同款）', () => {
    const el = render(<ContextBudgetBar usage={usage()} />)
    openPopover()
    const bar = el.querySelector<HTMLElement>('[data-budget-bar]')!
    expect(bar).toBeTruthy()
    // 四段各自一段（比例 > 0 的都渲染）
    const parts = [...bar.querySelectorAll<HTMLElement>('[data-budget-bar-part]')]
    expect(parts.map(p => p.getAttribute('data-budget-bar-part'))).toEqual(['base', 'memory', 'history', 'current'])
    // 宽度总和 = 占用百分比（40%），不再乘以任何别的分母
    const totalWidth = parts.reduce((sum, p) => sum + parseFloat(p.style.width), 0)
    expect(totalWidth).toBeCloseTo(40, 5)
    // 每段宽度 = 该段占比 × 40%
    expect(parseFloat(parts[0].style.width)).toBeCloseTo(0.25 * 40, 5) // base 1000/4000
    expect(parseFloat(parts[2].style.width)).toBeCloseTo(0.5 * 40, 5)  // history 2000/4000
  })

  it('标题行：占比 + `~已用 / 上限`（数字与百分比都进同一行）', () => {
    const el = render(<ContextBudgetBar usage={usage()} />)
    openPopover()
    const text = el.textContent ?? ''
    expect(text).toContain('40%')
    expect(text).toContain('~4k / 10k')
  })

  it('四段全 0：不画任何色条（0% 不许画成实心条）', () => {
    const el = render(<ContextBudgetBar usage={usage({
      base: 0, memory: 0, history: 0, current: 0, total: 0, segments: undefined,
    })} />)
    openPopover()
    const bar = el.querySelector<HTMLElement>('[data-budget-bar]')!
    expect(bar.querySelectorAll('[data-budget-bar-part]')).toHaveLength(0)
    expect(el.textContent).toContain('0%')
  })

  it('明细行：每段「色块 + 段名」左、token 数右；字符数进 title（DSH 无此概念，本仓保留）', () => {
    const el = render(<ContextBudgetBar usage={usage()} />)
    openPopover()
    const tools = rowOf(el, 'tools')!
    expect(tools).toBeTruthy()
    expect(tools.textContent).toContain(t('context.seg.tools'))
    // 值 = token 数（不再是「token · 字符数」的串）
    expect(tools.querySelector('[data-budget-row-value]')!.textContent).toBe('600')
    // 来源与字符数都还在（title 上）
    expect(tools.getAttribute('title')).toBe('23 个工具说明')
    expect(tools.querySelector('[data-budget-row-value]')!.getAttribute('title')).toBe('600 tokens · 210 chars')
  })

  it('面板值 vs 实发值分列（口径诚实，不混为一个数）', () => {
    const el = render(<ContextBudgetBar usage={usage()} />)
    openPopover()
    const text = el.textContent ?? ''
    expect(text).toMatch(/1\.5k/)           // 实发 1500
    expect(text).toMatch(/2k/)              // 面板 2000
  })

  it('前缀行：变化时显示共享字符数', () => {
    const el = render(<ContextBudgetBar usage={usage()} />)
    openPopover()
    expect(el.textContent).toContain('42')
  })

  it('无 segments（旧数据）时不崩、回落四段聚合行', () => {
    const el = render(<ContextBudgetBar usage={usage({ segments: undefined, prefix: undefined })} />)
    openPopover()
    // 四段聚合行都在，值口径不变
    expect(['base', 'memory', 'history', 'current'].map(k => rowOf(el, k)!.querySelector('[data-budget-row-value]')!.textContent))
      .toEqual(['1k', '500', '2k', '500'])
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

  // ===== 告警标记（原来的 warn 语气 chip 语义，在新形态下靠行内标记 + title 承担）=====
  it('截断段：行内 ✂ 标记 + title 给来源（信号不再靠正文里的裸符号配色）', () => {
    const el = render(<ContextBudgetBar usage={usage()} />)
    openPopover()
    const tools = rowOf(el, 'tools')!
    expect(tools.textContent).toContain('✂')
    expect(tools.getAttribute('title')).toBe('23 个工具说明')
    const identity = rowOf(el, 'identity')!
    expect(identity.textContent).not.toContain('✂')
  })

  it('常驻告警：⚠ 优先于 ✂，原因与来源一起进 title（悬停整行即得）', () => {
    const el = render(<ContextBudgetBar usage={usage({
      segments: [{
        key: 'memory-resident', tokens: 0, chars: 0, truncated: true,
        source: 'book-state.md', warning: '常驻超上限（4000 tokens），本轮未注入',
      }],
    })} />)
    openPopover()
    const row = rowOf(el, 'memory-resident')!
    expect(row.textContent).toContain('⚠')
    expect(row.textContent).not.toContain('✂')
    expect(row.getAttribute('title')).toContain('book-state.md')
    expect(row.getAttribute('title')).toContain('4000')
  })

  it('明细超过 6 段：其余折成「其它 N 段」（窄面板不被撑高）', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ key: `s${i}`, tokens: 100, chars: 10 }))
    const el = render(<ContextBudgetBar usage={usage({ segments: many })} />)
    openPopover()
    expect(el.querySelectorAll('[data-budget-row]')).toHaveLength(6)
    expect(el.textContent).toContain(t('ccr.moreSegments').replace('{n}', '2'))
  })
})
