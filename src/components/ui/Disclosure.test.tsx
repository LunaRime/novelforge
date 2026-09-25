// @vitest-environment jsdom
/**
 * Disclosure — 默认收起的「高级设置」折叠区（2026-09-25 抽取）
 *
 * 抽取自 `VectorConfigSection` 里那处手写的 `<details>/<summary>`（Ollama 地址折叠区），
 * 把那次的真机修复一并带走。**本测试的重点是守住那次修复**，不是复述 `<details>` 的原生行为。
 *
 * 2026-09-22 真机反馈原文：「看起来不能点击」——原来的摘要行是 10px 灰字、行高仅 14px、
 * 无箭头无 hover，虽然点得动但完全不像可点。当次修了四件事，本测试逐条钉住：
 *   ① 有箭头（且展开时旋转）  ② 有 hover 底色  ③ 加大点击区  ④ 提亮文字
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Disclosure } from './Disclosure'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(node)
  })
  return container.firstElementChild as HTMLElement
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

const summaryOf = (el: HTMLElement) => el.querySelector('summary') as HTMLElement

describe('Disclosure', () => {
  it('用原生 <details>/<summary>（键盘可达免费获得，无需 JS 状态）', () => {
    const el = render(<Disclosure label="高级设置">内容</Disclosure>)
    expect(el.tagName).toBe('DETAILS')
    expect(summaryOf(el)).toBeTruthy()
  })

  it('默认收起', () => {
    const el = render(<Disclosure label="高级设置">内容</Disclosure>) as HTMLDetailsElement
    expect(el.open).toBe(false)
  })

  it('defaultOpen 时展开', () => {
    const el = render(<Disclosure label="高级设置" defaultOpen>内容</Disclosure>) as HTMLDetailsElement
    expect(el.open).toBe(true)
  })

  it('渲染 label 与内容', () => {
    const el = render(<Disclosure label="高级设置"><span>API 地址</span></Disclosure>)
    expect(summaryOf(el).textContent).toContain('高级设置')
    expect(el.querySelector('span')?.textContent).toBe('API 地址')
  })

  describe('守住 2026-09-22 的「看起来不能点击」修复', () => {
    it('① 有箭头，且展开时旋转（group-open:rotate-90）', () => {
      const el = render(<Disclosure label="高级设置">内容</Disclosure>)
      const arrow = summaryOf(el).querySelector('svg')
      expect(arrow, '缺箭头 = 回到「看起来不能点击」').toBeTruthy()
      expect(arrow?.getAttribute('class')).toContain('group-open:rotate-90')
    })

    it('② 有 hover 底色', () => {
      const el = render(<Disclosure label="高级设置">内容</Disclosure>)
      expect(summaryOf(el).className).toContain('hover:bg-[var(--color-hover)]')
    })

    it('③ 点击区靠负外边距向两侧扩张（不止文字那么窄）', () => {
      const el = render(<Disclosure label="高级设置">内容</Disclosure>)
      const cls = summaryOf(el).className
      expect(cls).toContain('-mx-1.5')
      expect(cls).toContain('px-1.5')
      expect(cls).toContain('py-1')
    })

    it('④ 可点暗示：cursor-pointer + select-none（拖选文字不算点击）', () => {
      const el = render(<Disclosure label="高级设置">内容</Disclosure>)
      expect(summaryOf(el).className).toContain('cursor-pointer')
      expect(summaryOf(el).className).toContain('select-none')
    })

    it('文字用次级色而非 muted（提亮那条）', () => {
      const el = render(<Disclosure label="高级设置">内容</Disclosure>)
      expect(summaryOf(el).getAttribute('style')).toContain('--color-text-secondary')
    })
  })

  it('className 透传给 details（调用方控制外边距）', () => {
    const el = render(<Disclosure label="高级设置" className="mt-3">内容</Disclosure>)
    expect(el.className).toContain('mt-3')
    expect(el.className).toContain('group')
  })
})
