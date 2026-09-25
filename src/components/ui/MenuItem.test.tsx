// @vitest-environment jsdom
/**
 * MenuItem — 菜单项按钮（2026-09-25 扩展，批次 4 剩余项 2）
 *
 * 原有 props（label/onClick/icon/shortcut/disabled/danger）保持不变，新增三项以收编
 * 三处自绘菜单项（AgentInputBox 的 ContextMenuItem / ModelMenuItem、RightToolWindowBar
 * 的主题项）：
 * - `selected`：当前选中 → **accent 文字 + 尾部 Check**
 * - `trailing`：Check 之前的内容（provider 徽标、comingSoon 提示）
 * - `className`：透传
 *
 * 选中视觉为何定为「Check + accent 文字」而非底色高亮：菜单项的**悬停**底色就是
 * `--color-hover`，若选中也用底色，用户无法分辨「正悬停」与「当前选中」——
 * 模型菜单此前正是如此。Check 不占用底色，两种状态终生可分。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MenuItem } from './MenuItem'

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

const checkOf = (el: HTMLElement) => el.querySelector('svg.lucide-check')

describe('MenuItem', () => {
  it('渲染 label 与 shortcut', () => {
    const el = render(<MenuItem label="保存" shortcut="Ctrl+S" />)
    expect(el.textContent).toContain('保存')
    expect(el.textContent).toContain('Ctrl+S')
  })

  it('点击触发 onClick', () => {
    const onClick = vi.fn()
    const el = render(<MenuItem label="保存" onClick={onClick} />)
    act(() => el.click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  describe('禁用态', () => {
    it('带 disabled 属性且点击不触发', () => {
      const onClick = vi.fn()
      const el = render(<MenuItem label="保存" onClick={onClick} disabled />)
      expect(el.hasAttribute('disabled')).toBe(true)
      act(() => el.click())
      expect(onClick).not.toHaveBeenCalled()
    })
  })

  describe('selected（当前选中）', () => {
    it('默认不选中：无 Check、文字走正文色', () => {
      const el = render(<MenuItem label="模型 A" />)
      expect(checkOf(el)).toBeNull()
      expect(el.getAttribute('style')).toContain('--color-text')
    })

    it('选中时文字转 accent 且尾部出现 Check', () => {
      const el = render(<MenuItem label="模型 A" selected />)
      const style = el.getAttribute('style') ?? ''
      expect(style).toContain('--color-accent')
      expect(checkOf(el)).toBeTruthy()
    })

    it('选中态不占用底色（底色留给悬停，否则两者无法分辨）', () => {
      const el = render(<MenuItem label="模型 A" selected />)
      expect(el.style.backgroundColor).toBe('transparent')
    })

    it('selected 与 disabled 同现时以 disabled 的 muted 色为准', () => {
      const el = render(<MenuItem label="模型 A" selected disabled />)
      expect(el.getAttribute('style')).toContain('--color-text-muted')
    })

    it('danger 优先级高于 selected', () => {
      const el = render(<MenuItem label="删除" selected danger />)
      expect(el.getAttribute('style')).toContain('--color-error')
    })
  })

  describe('trailing（Check 之前的尾部内容）', () => {
    it('无 selected 时只渲染 trailing', () => {
      const el = render(<MenuItem label="模型 A" trailing={<span data-testid="badge">openai</span>} />)
      expect(el.querySelector('[data-testid="badge"]')?.textContent).toBe('openai')
      expect(checkOf(el)).toBeNull()
    })

    it('有 selected 时 trailing 与 Check 共存，且 trailing 在前', () => {
      const el = render(<MenuItem label="模型 A" selected trailing={<span data-testid="badge">openai</span>} />)
      const badge = el.querySelector('[data-testid="badge"]')!
      const check = checkOf(el)!
      expect(badge).toBeTruthy()
      // 文档序：badge 在 check 之前
      expect(badge.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  })

  it('icon 渲染在 label 之前', () => {
    const el = render(<MenuItem label="主题" icon={<span data-testid="ico" />} />)
    const ico = el.querySelector('[data-testid="ico"]')!
    expect(ico.compareDocumentPosition(el.querySelector('span.flex-1')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('className 透传', () => {
    const el = render(<MenuItem label="主题" className="px-2.5" />)
    expect(el.className).toContain('px-2.5')
    expect(el.className).toContain('w-full')
  })
})
