/**
 * 主题切换过渡 —— 四主题共用的「以点击点为圆心的圆形扩散」（View Transitions API）。
 *
 * 2026-10 抽出：此前这段逻辑只写在 `layout/RightToolWindowBar.tsx` 的主题菜单里；
 * 「设置 → 编辑器」新增主题卡片（`components/settings/ThemeSection.tsx`）后两个入口必须**同源**
 * （见 docs/ui-6items-plan.md §2.5/§2.6）—— 否则两处各写一份，迟早一个改了另一个没改。
 *
 * ⚠️ 行为契约（抽取时逐行保留，勿顺手改）：
 * - 能力检测：`document.startViewTransition` 不存在 → 直接换主题（旧运行时/测试环境）
 * - `prefers-reduced-motion: reduce` → 直接换主题（不做扩散动画）
 * - 动画：clipPath 从点击点 0px 扩散到「到窗口最远角」的半径，450ms，作用于 `::view-transition-new(root)`
 *
 * ⚠️ 直接读 `useThemeStore.getState()`，**本模块不是 hook** —— 两个入口都在事件处理器里调用。
 */
import { useThemeStore, type Theme } from '../stores/theme-store'

/** 过渡起点：React.MouseEvent 与原生 MouseEvent 都满足这个形状（只取点击坐标） */
export interface ThemeTransitionOrigin {
  clientX: number
  clientY: number
}

/** View Transitions 的最小类型（lib.dom 未必收录，别为它升级 TS lib 目标） */
interface ViewTransitionLike {
  ready: Promise<void>
}
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => ViewTransitionLike
}

/**
 * 切换主题并（在支持时）播放圆形扩散过渡。
 *
 * @param nextTheme 目标主题
 * @param event     触发点击的事件（取其 clientX/clientY 作为扩散圆心）
 */
export function applyThemeWithTransition(nextTheme: Theme, event: ThemeTransitionOrigin): void {
  // `typeof` 守卫：Node/jsdom 没有 matchMedia（真机浏览器恒有）——没有它，测试环境一调用就抛
  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (!('startViewTransition' in document) || prefersReducedMotion) {
    useThemeStore.getState().setTheme(nextTheme)
    return
  }

  const x = event.clientX
  const y = event.clientY
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  )
  const transition = (document as DocumentWithViewTransition).startViewTransition!(() => {
    useThemeStore.getState().setTheme(nextTheme)
  })
  transition.ready.then(() => {
    const clipPath = [
      `circle(0px at ${x}px ${y}px)`,
      `circle(${endRadius}px at ${x}px ${y}px)`
    ]
    document.documentElement.animate(
      { clipPath },
      { duration: 450, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }
    )
  })
}
