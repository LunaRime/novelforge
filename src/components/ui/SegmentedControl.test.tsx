// @vitest-environment jsdom
/**
 * SegmentedControl — 分段切换控件（2026-09-25 收敛，批次 4 剩余项 2）
 *
 * 收敛 5 处分段控件（ActivityView / UsageStatsView / LogsView / LogFileDialog /
 * ChapterExportDialog）+ StatusBar 的温度预设。形态按用户拍板定为**分段条**：
 * 1px 描边容器 + 激活块 accent 实底白字贴边（overflow-hidden 负责裁圆角），
 * 而非药丸容器或浮起白药丸 —— 后者那处用的是硬编码 boxShadow，违背阴影令牌规矩。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { SegmentedControl } from './SegmentedControl'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): { box: HTMLElement; items: HTMLElement[] } {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(node)
  })
  const box = container.firstElementChild as HTMLElement
  return { box, items: Array.from(box.querySelectorAll('button')) as HTMLElement[] }
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

const ITEMS = [
  { value: 'daily', label: '每日' },
  { value: 'monthly', label: '每月' },
]

describe('SegmentedControl', () => {
  it('渲染全部选项，文字来自 label', () => {
    const { items } = render(<SegmentedControl items={ITEMS} value="daily" onChange={() => {}} />)
    expect(items.map((b) => b.textContent)).toEqual(['每日', '每月'])
  })

  it('容器是描边分段条：1px 描边 + 圆角 + 裁边（激活块贴边无圆角）', () => {
    const { box } = render(<SegmentedControl items={ITEMS} value="daily" onChange={() => {}} />)
    expect(box.className).toContain('rounded-lg')
    expect(box.className).toContain('overflow-hidden')
    expect(box.className).toContain('border')
  })

  describe('激活视觉', () => {
    it('激活项：accent 实底 + 白字', () => {
      const { items } = render(<SegmentedControl items={ITEMS} value="daily" onChange={() => {}} />)
      expect(items[0].className).toContain('bg-[var(--color-accent)]')
      expect(items[0].className).toContain('text-white')
    })

    it('未激活项：muted 文字，悬停转正文色 + hover 底', () => {
      const { items } = render(<SegmentedControl items={ITEMS} value="daily" onChange={() => {}} />)
      expect(items[1].className).toContain('text-[var(--color-text-muted)]')
      expect(items[1].className).toContain('hover:bg-[var(--color-hover)]')
      expect(items[1].className).not.toContain('bg-[var(--color-accent)]')
    })

    it('激活项随 value 切换', () => {
      const { items } = render(<SegmentedControl items={ITEMS} value="monthly" onChange={() => {}} />)
      expect(items[0].className).not.toContain('bg-[var(--color-accent)]')
      expect(items[1].className).toContain('bg-[var(--color-accent)]')
    })
  })

  it('点击回调带上该项的 value', () => {
    const onChange = vi.fn()
    const { items } = render(<SegmentedControl items={ITEMS} value="daily" onChange={onChange} />)
    act(() => items[1].click())
    expect(onChange).toHaveBeenCalledWith('monthly')
  })

  it('激活项标记 aria-pressed（读屏能播报当前档）', () => {
    const { items } = render(<SegmentedControl items={ITEMS} value="daily" onChange={() => {}} />)
    expect(items[0].getAttribute('aria-pressed')).toBe('true')
    expect(items[1].getAttribute('aria-pressed')).toBe('false')
  })

  describe('尺寸两档', () => {
    it('sm：11px 次级文字档 + 紧凑内边距', () => {
      const { items } = render(
        <SegmentedControl items={ITEMS} value="daily" onChange={() => {}} size="sm" />,
      )
      expect(items[0].className).toContain('text-micro')
      expect(items[0].className).toContain('px-1.5')
    })

    it('默认 md：12px 正文档', () => {
      const { items } = render(<SegmentedControl items={ITEMS} value="daily" onChange={() => {}} />)
      expect(items[0].className).toContain('text-xs')
      expect(items[0].className).toContain('px-2.5')
    })
  })

  describe('fill：等宽铺满', () => {
    it('默认不铺满（按内容宽度）', () => {
      const { box, items } = render(<SegmentedControl items={ITEMS} value="daily" onChange={() => {}} />)
      expect(box.className).not.toContain('w-full')
      expect(items[0].className).not.toContain('flex-1')
    })

    it('开启后容器铺满、各项等分', () => {
      const { box, items } = render(
        <SegmentedControl items={ITEMS} value="daily" onChange={() => {}} fill />,
      )
      expect(box.className).toContain('w-full')
      expect(items[0].className).toContain('flex-1')
    })
  })

  it('支持图标与 title（图标档位切换等场景）', () => {
    const { items } = render(
      <SegmentedControl
        items={[{ value: 'a', label: '甲', icon: <span data-testid="ico" />, title: '提示' }]}
        value="a"
        onChange={() => {}}
      />,
    )
    expect(items[0].querySelector('[data-testid="ico"]')).toBeTruthy()
    expect(items[0].getAttribute('title')).toBe('提示')
  })

  it('每项都是 button 且带焦点环（键盘可达）', () => {
    const { items } = render(<SegmentedControl items={ITEMS} value="daily" onChange={() => {}} />)
    expect(items.every((b) => b.tagName === 'BUTTON')).toBe(true)
    expect(items[0].className).toContain('focus-visible:ring')
    expect(items[0].getAttribute('type')).toBe('button')
  })

  it('className 透传给容器', () => {
    const { box } = render(
      <SegmentedControl items={ITEMS} value="daily" onChange={() => {}} className="flex-shrink-0" />,
    )
    expect(box.className).toContain('flex-shrink-0')
  })
})
