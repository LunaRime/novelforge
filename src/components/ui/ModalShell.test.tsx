// @vitest-environment jsdom
/**
 * ModalShell — 命令式模态框的遮罩 + 卡片外壳（2026-09-25 收敛，批次 4 剩余项 2）
 *
 * 收敛前 `Confirm.tsx` 里两份模态（ConfirmDialog / ConfirmDeleteProjectDialog）
 * 各自内联同一套遮罩与卡片样式，只有 role、minWidth 两处不同。本测试钉住这套外壳：
 * 遮罩（铺满 + 背景虚化 + 层叠层级）、卡片（令牌化配色与圆角）、进出场动画、点击语义。
 *
 * ⚠️ 进出场动画的名字必须与 `index.css` 的 @keyframes 对齐；退场时长 200ms 是
 * 调用方（ConfirmDialog）的职责——本组件只根据 `exiting` 选动画名。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModalShell } from './ModalShell'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): { overlay: HTMLElement; card: HTMLElement } {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(node)
  })
  const overlay = container.firstElementChild as HTMLElement
  return { overlay, card: overlay.firstElementChild as HTMLElement }
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ModalShell', () => {
  describe('遮罩层', () => {
    it('铺满视口、置顶到 --z-modal、背景虚化', () => {
      const { overlay } = render(<ModalShell>内容</ModalShell>)
      expect(overlay.style.position).toBe('fixed')
      expect(overlay.style.inset).toBe('0px')
      expect(overlay.getAttribute('style')).toContain('--z-modal')
      expect(overlay.getAttribute('style')).toContain('--color-backdrop')
      expect(overlay.style.backdropFilter).toContain('blur')
    })

    it('点遮罩触发回调', () => {
      let clicked = 0
      const { overlay } = render(<ModalShell onBackdropClick={() => { clicked++ }}>内容</ModalShell>)
      act(() => {
        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(clicked).toBe(1)
    })

    it('未传回调时点遮罩不报错', () => {
      const { overlay } = render(<ModalShell>内容</ModalShell>)
      expect(() => {
        act(() => {
          overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
      }).not.toThrow()
    })
  })

  describe('卡片', () => {
    it('语义角色与 aria-modal（alertdialog 供 alertError 用）', () => {
      const d = render(<ModalShell>内容</ModalShell>)
      expect(d.card.getAttribute('role')).toBe('dialog')
      expect(d.card.getAttribute('aria-modal')).toBe('true')
      container?.remove()

      const a = render(<ModalShell role="alertdialog">内容</ModalShell>)
      expect(a.card.getAttribute('role')).toBe('alertdialog')
    })

    it('配色与圆角全部走令牌', () => {
      const { card } = render(<ModalShell>内容</ModalShell>)
      const style = card.getAttribute('style') ?? ''
      expect(style).toContain('--color-sidebar')
      expect(style).toContain('--color-border')
      expect(style).toContain('--radius-2xl')
      expect(style).toContain('--shadow-popover')
      expect(style).toContain('20px 24px')
    })

    it('minWidth 可配（确认框 320 / 删除项目 380），maxWidth 固定 460', () => {
      const { card } = render(<ModalShell>内容</ModalShell>)
      expect(card.style.minWidth).toBe('320px')
      expect(card.style.maxWidth).toBe('460px')
      container?.remove()

      const wide = render(<ModalShell minWidth={380}>内容</ModalShell>)
      expect(wide.card.style.minWidth).toBe('380px')
    })

    it('点卡片不冒泡到遮罩（否则点正文就等于取消）', () => {
      let clicked = 0
      const { card } = render(<ModalShell onBackdropClick={() => { clicked++ }}>内容</ModalShell>)
      act(() => {
        card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(clicked).toBe(0)
    })

    it('渲染子内容', () => {
      const { card } = render(<ModalShell><span>正文</span></ModalShell>)
      expect(card.querySelector('span')?.textContent).toBe('正文')
    })
  })

  describe('进出场动画', () => {
    it('常态用 enter 动画（遮罩与卡片各一套）', () => {
      const { overlay, card } = render(<ModalShell>内容</ModalShell>)
      expect(overlay.style.animation).toContain('backdrop-enter')
      expect(card.style.animation).toContain('dialog-enter')
    })

    it('exiting 时切到 exit 动画', () => {
      const { overlay, card } = render(<ModalShell exiting>内容</ModalShell>)
      expect(overlay.style.animation).toContain('backdrop-exit')
      expect(card.style.animation).toContain('dialog-exit')
    })
  })
})
