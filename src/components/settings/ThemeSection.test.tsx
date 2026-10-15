// @vitest-environment jsdom
/**
 * ThemeSection — 设置 → 编辑器的「界面主题」卡片网格（用户建议 5 · docs/ui-6items-plan.md §2.5）。
 *
 * 契约（用户可见）：
 * - 四主题各一张卡：图标 + 主题名（复用 ui.ts 既有 key，不新建重复 key）+ 三色预览条
 * - 点卡片**立即**换主题，并复用 `lib/theme-transition.ts` 的圆形扩散：
 *   运行时没有 View Transitions、或 `prefers-reduced-motion: reduce` → 直切、不播动画
 * - 当前主题有选中态标记（`aria-pressed` + 勾）
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ThemeSection from './ThemeSection'
import { useThemeStore, type Theme } from '../../stores/theme-store'
import { t } from '../../shared/locale'

beforeAll(() => {
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  g.IS_REACT_ACT_ENVIRONMENT = true
})

/** 卡片顺序 = `lib/theme-meta.ts` 的 THEME_ORDER（与右侧图标栏菜单同一份；此处硬编码以钉住契约） */
const CARD_IDS: Theme[] = ['galaxy', 'dark', 'light', 'paper']

const render = (): { container: HTMLElement; root: Root } => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<ThemeSection />) })
  return { container, root }
}

const card = (container: HTMLElement, id: Theme): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>(`[data-theme-card="${id}"]`)!

const click = (el: HTMLElement) => {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120, clientY: 80 })) })
}

/** jsdom 的 matchMedia 恒 matches:false，无法表达 reduced-motion → 覆盖掉 */
const stubMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches, media: query, onchange: null }),
  })
}

const defineOn = (target: object, prop: string, value: unknown) => {
  Object.defineProperty(target, prop, { configurable: true, writable: true, value })
}
const removeFrom = (target: object, prop: string) => {
  delete (target as Record<string, unknown>)[prop]
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.documentElement.classList.remove('galaxy', 'paper', 'dark')
  stubMatchMedia(false)
  // jsdom 是否实现 View Transitions 不保证 → 显式移除，让「无 API」这条分支确定（需要时各用例自己挂）
  removeFrom(document, 'startViewTransition')
  useThemeStore.setState({ theme: 'light' })
})

afterEach(() => {
  removeFrom(document, 'startViewTransition')
  removeFrom(document.documentElement, 'animate')
  stubMatchMedia(false)
})

describe('ThemeSection', () => {
  it('四个主题各渲染一张卡，带区块标题与主题名（复用既有 key）', () => {
    const { container, root } = render()

    const cards = [...container.querySelectorAll('[data-theme-card]')]
    expect(cards.map(c => c.getAttribute('data-theme-card'))).toEqual(CARD_IDS)

    const text = container.textContent ?? ''
    expect(text).toContain(t('theme.appearance'))
    expect(text).toContain(t('theme.appearanceDesc'))
    expect(text).toContain(t('theme.starry'))   // galaxy 的既有 key（勿新建重复 key）
    expect(text).toContain(t('theme.paper'))
    expect(text).toContain(t('theme.dark'))
    expect(text).toContain(t('theme.light'))

    // 每张卡都有三色预览条（aria-hidden 的条：3 段），且 title 只说「当前主题的配色预览」
    for (const c of cards) {
      expect(c.querySelectorAll('span[aria-hidden] > span')).toHaveLength(3)
      expect(c.querySelector('span[aria-hidden][title]')?.getAttribute('title')).toBe(t('theme.palettePreview'))
    }
    act(() => { root.unmount() })
  })

  it('点卡片立即换主题：store 与 html class 同步（无 View Transitions 时直切）', () => {
    const { container, root } = render()
    expect(useThemeStore.getState().theme).toBe('light')

    click(card(container, 'galaxy'))

    expect(useThemeStore.getState().theme).toBe('galaxy')
    expect(document.documentElement.classList.contains('galaxy')).toBe(true)
    act(() => { root.unmount() })
  })

  it('当前主题有选中态标记（aria-pressed + accent 勾），其余卡片没有', () => {
    useThemeStore.setState({ theme: 'paper' })
    const { container, root } = render()

    const active = card(container, 'paper')
    expect(active.getAttribute('aria-pressed')).toBe('true')
    expect(active.getAttribute('data-active')).toBe('true')
    // 主题图标 + 勾 = 2 个 svg（未选中的卡只有主题图标）
    expect(active.querySelectorAll('svg')).toHaveLength(2)

    for (const id of CARD_IDS.filter(i => i !== 'paper')) {
      const other = card(container, id)
      expect(other.getAttribute('aria-pressed')).toBe('false')
      expect(other.getAttribute('data-active')).toBe('false')
      expect(other.querySelectorAll('svg')).toHaveLength(1)
    }
    act(() => { root.unmount() })
  })

  it('prefers-reduced-motion: reduce → 直切主题，且不调用 startViewTransition / animate', () => {
    stubMatchMedia(true)
    const startViewTransition = vi.fn()
    const animate = vi.fn()
    defineOn(document, 'startViewTransition', startViewTransition)
    defineOn(document.documentElement, 'animate', animate)

    const { container, root } = render()
    click(card(container, 'dark'))

    expect(useThemeStore.getState().theme).toBe('dark')
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(animate).not.toHaveBeenCalled()
    act(() => { root.unmount() })
  })

  it('支持 View Transitions 时：以点击坐标为圆心扩散，并仍然换主题', async () => {
    const pending: Array<() => void> = []
    const startViewTransition = vi.fn((cb: () => void) => {
      pending.push(cb)
      return { ready: Promise.resolve() }
    })
    const animate = vi.fn()
    defineOn(document, 'startViewTransition', startViewTransition)
    defineOn(document.documentElement, 'animate', animate)

    const { container, root } = render()
    click(card(container, 'galaxy'))

    // 换主题发生在 startViewTransition 的回调里（由浏览器/API 调用，不是点击同步路径）
    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(useThemeStore.getState().theme).toBe('light')
    act(() => { pending[0]() })
    expect(useThemeStore.getState().theme).toBe('galaxy')

    // 动画：clipPath 以点击点为圆心，作用于新视图快照
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(animate).toHaveBeenCalledTimes(1)
    const [keyframes, options] = animate.mock.calls[0] as [
      { clipPath: string[] },
      { duration: number; pseudoElement: string },
    ]
    expect(keyframes.clipPath[0]).toBe('circle(0px at 120px 80px)')
    expect(keyframes.clipPath[1]).toMatch(/^circle\(\d+(\.\d+)?px at 120px 80px\)$/)
    expect(options.duration).toBe(450)
    expect(options.pseudoElement).toBe('::view-transition-new(root)')
    act(() => { root.unmount() })
  })
})
