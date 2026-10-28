import { useEffect } from 'react'

/**
 * Esc 关闭浮层——与 `useOutsideClick` 成对使用（两者是同一类"浮层该能被关掉"的约定）。
 *
 * 2026-09-25 新增：UI 审计发现 9 处自绘浮层**只有点击外部关闭、没有 Esc**（`+` 菜单 /
 * 深度档位 / 模型菜单 / AGENT「更多」/ 上下文明细 / 水温面板 / 主题菜单 / 接受浮层 /
 * 设置模态），而项目内 Radix 系（Dialog/Select）与 ContextMenu、气泡菜单、@提及、斜杠、
 * 文件选择**都有** Esc —— 同一应用里一半能按一半不能按，属一致性缺口。
 *
 * 挂在 `window` 而不是元素上：浮层打开时焦点往往还在触发按钮或输入框里。
 *
 * @param onClose 关闭回调（浮层已关闭时不会被调用）
 * @param active  浮层是否打开；false 时不注册监听
 */
export function useEscapeKey(onClose: () => void, active: boolean): void {
  useEffect(() => {
    if (!active) return
    /**
     * 子层优先：Radix Select/Menu 打开时，它们的 Esc 只关自己且不阻断冒泡，
     * 结果设置页这种上层模态也被一起关掉（审计 P0-5）。这里用「DOM 里是否还有
     * 打开的 popper/listbox/menu/dialog」判断，把这一次 Esc 让给子层。
     */
    const hasOpenNestedLayer = (): boolean => {
      if (typeof document === 'undefined') return false
      return !!document.querySelector(
        '[data-radix-popper-content-wrapper], [role="listbox"][data-state="open"], [role="menu"][data-state="open"], [role="dialog"][data-state="open"]',
      )
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (e.defaultPrevented) return
      if (hasOpenNestedLayer()) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, active])
}
