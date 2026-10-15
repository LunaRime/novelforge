// @vitest-environment jsdom
/**
 * MetricChip — 指标原语契约（六项 UI 改进 §2.4）
 *
 * 靶点：一条 `·` 串把语义不同的计数拍平成同等权重的纯文本。本原语的契约是：
 * 一个指标 = 一个 chip（图标 + 标签 + 等宽数值），语气只着色（数值与图标），
 * 数值等宽对齐；`title` 是解释型 tooltip，**不是**可点暗示（无 hover 底色 / 无 cursor-pointer）。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { Scissors } from 'lucide-react'
import { MetricChip, MetricRow, type MetricTone } from './MetricChip'

beforeAll(() => {
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  g.IS_REACT_ACT_ENVIRONMENT = true
})

/** 本文件挂载过的 root 清理器（逐档遍历用例需要多次挂载，统一在 afterEach 卸载，避免重复卸载） */
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

function chipOf(el: HTMLElement): HTMLElement {
  const chip = el.querySelector('[data-metric-chip]') as HTMLElement | null
  expect(chip).toBeTruthy()
  return chip!
}

describe('MetricChip — 指标原语（六项 UI 改进 §2.4）', () => {
  it('tone → 数值与图标同色；标签恒 muted；片底/描边不随 tone 变（色块不互抢）', () => {
    const cases: Array<[MetricTone, string]> = [
      ['neutral', 'var(--color-text-secondary)'],
      ['good', 'var(--color-success)'],
      ['warn', 'var(--color-warning)'],
      ['bad', 'var(--color-error)'],
    ]
    for (const [tone, color] of cases) {
      const chip = chipOf(render(<MetricChip icon={<Scissors size={12} />} label="截断" value={3} tone={tone} />))
      expect(chip.getAttribute('data-tone')).toBe(tone)
      // 语义色只落在数值与图标上
      expect((chip.querySelector('[data-metric-value]') as HTMLElement).style.color).toBe(color)
      expect((chip.querySelector('[data-metric-icon]') as HTMLElement).style.color).toBe(color)
      // 标签不受 tone 影响
      expect((chip.querySelector('[data-metric-label]') as HTMLElement).style.color).toBe('var(--color-text-muted)')
      // 片底四档一致（tone 只着色，不改形状；描边同为 --color-border 常量）
      expect(chip.style.backgroundColor).toBe('var(--color-panel)')
    }
  })

  it('默认 tone=neutral（不传 tone 与显式 neutral 同色）', () => {
    const chip = chipOf(render(<MetricChip label="压缩" value={0} />))
    expect(chip.getAttribute('data-tone')).toBe('neutral')
    expect((chip.querySelector('[data-metric-value]') as HTMLElement).style.color)
      .toBe('var(--color-text-secondary)')
  })

  it('数值等宽 + tabular-nums（多行数值竖向对齐）', () => {
    const chip = chipOf(render(<MetricChip label="跳过" value={12} />))
    const value = chip.querySelector('[data-metric-value]') as HTMLElement
    expect(value.className).toContain('font-mono')
    expect(value.className).toContain('tabular-nums')
  })

  it('0 值正常渲染（0 是信息：学习尚未积累，不做整片隐藏）', () => {
    const chip = chipOf(render(<MetricChip label="保真告警" value={0} tone="warn" />))
    expect((chip.querySelector('[data-metric-value]') as HTMLElement).textContent).toBe('0')
    expect(chip.textContent).toContain('保真告警')
  })

  it('title 透传（解释型 tooltip）；不携带任何可点暗示', () => {
    const chip = chipOf(render(<MetricChip label="移除" value={2} title="你手动移除压缩批次的次数" />))
    expect(chip.getAttribute('title')).toBe('你手动移除压缩批次的次数')
    // 不可点：无 cursor-pointer、无 hover 底色
    expect(chip.className).not.toContain('cursor-pointer')
    expect(chip.className).not.toContain('hover:')
    expect(chip.tagName).toBe('SPAN')
  })

  it('无 icon → 不渲染图标槽（纯标签 + 数值）', () => {
    const chip = chipOf(render(<MetricChip label="重生成" value={1} />))
    expect(chip.querySelector('[data-metric-icon]')).toBeFalsy()
    expect(chip.textContent).toBe('重生成1')
  })

  it('className 附加类可让数值右贴（label 左 / 值右的明细行形态）', () => {
    const chip = chipOf(render(<MetricChip className="w-full" label="身份与行为指导" value="40 · 120" />))
    expect(chip.className).toContain('w-full')
    // marginLeft auto 承担右贴（无需调用方再写 justify-between）
    expect((chip.querySelector('[data-metric-value]') as HTMLElement).style.marginLeft).toBe('auto')
  })
})

describe('MetricRow — 指标行分组', () => {
  it('横向 flex-wrap 分组（窄容器自动折行），承载多个 chip', () => {
    const el = render(<MetricRow><MetricChip label="压缩" value={0} /><MetricChip label="跳过" value={0} /></MetricRow>)
    const row = el.querySelector('[data-metric-row]') as HTMLElement
    expect(row).toBeTruthy()
    expect(row.className).toContain('flex-wrap')
    expect(row.className).toContain('gap-1.5')
    expect(el.querySelectorAll('[data-metric-chip]')).toHaveLength(2)
  })
})
