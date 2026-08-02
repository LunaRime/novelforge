/**
 * GlobalTitleTooltip — 全局 title 属性现代化代理
 *
 * 将原生 `<title>` 悬停提示（浏览器默认样式）统一替换为现代化 Tooltip UI：
 * 毛玻璃背景、圆角、缩放渐显动画、视口边缘自动翻转。
 *
 * 工作原理（事件委托，零侵入）：
 * 1. document 捕获阶段监听 mouseover/mouseout，读取元素 title 属性
 * 2. **进入元素即移除 title 屏蔽原生提示**（原值存入 ref），彻底消灭
 *    原生 tooltip 与自定义 tooltip 并存/竞争的双 UI 窗口期
 * 3. MutationObserver 监控 title 属性——React 重挂载/重渲染恢复 title
 *    时立即再次屏蔽，保证悬停期间原生提示永不出现
 * 4. 400ms 延迟后显示自定义 tooltip；移出/滚动/窗口变化时恢复 title 并隐藏
 * 5. 位置跟随元素（居中于元素下方），接近视口边缘时自动翻转
 *
 * 挂载一次（App.tsx 顶层）即可覆盖全部 title 用法，内容仍由各组件
 * t() 国际化文本提供。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 显示延迟（与原生 tooltip 接近的体验） */
const SHOW_DELAY = 400

interface TipAnchor {
  text: string
  /** 锚点：元素水平中心 */
  x: number
  /** 锚点：元素底部 */
  y: number
}

interface TipPos {
  left: number
  top: number
}

export default function GlobalTitleTooltip() {
  const [anchor, setAnchor] = useState<TipAnchor | null>(null)
  const [pos, setPos] = useState<TipPos | null>(null)
  const tipElRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number>(0)
  const titleElRef = useRef<HTMLElement | null>(null)
  const originalTitleRef = useRef<string | null>(null)
  const observerRef = useRef<MutationObserver | null>(null)

  useEffect(() => {
    const cancelTimer = () => { window.clearTimeout(timerRef.current) }

    /** 停止监控 title 属性恢复 */
    const stopObserving = () => {
      observerRef.current?.disconnect()
      observerRef.current = null
    }

    /**
     * 监控当前元素 title 属性：React 重挂载/重渲染会恢复 title，
     * 此时原生 tooltip 开始计时，必须立即重新屏蔽（并同步备份值）
     */
    const startObserving = (el: HTMLElement) => {
      stopObserving()
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type !== 'attributes' || m.attributeName !== 'title') continue
          const target = m.target as HTMLElement
          const current = target.getAttribute('title')
          if (current !== null) {
            originalTitleRef.current = current
            target.removeAttribute('title')
          }
        }
      })
      observer.observe(el, { attributes: true, attributeFilter: ['title'] })
      observerRef.current = observer
    }

    /** 恢复元素 title 属性（屏蔽期被临时移除） */
    const restoreTitle = () => {
      const el = titleElRef.current
      if (el && originalTitleRef.current !== null) {
        el.setAttribute('title', originalTitleRef.current)
      }
      originalTitleRef.current = null
      titleElRef.current = null
    }

    const hide = () => {
      cancelTimer()
      stopObserving()
      restoreTitle()
      setAnchor(null)
      setPos(null)
    }

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target) return
      const el = target.closest<HTMLElement>('[title]')
      const current = titleElRef.current
      if (current) {
        // 关键：鼠标仍在当前处理元素内部移动（按钮内图标↔padding 穿越时
        // title 已被屏蔽，closest 找不到，但位置仍在元素内）→ 保持现状，
        // 绝不 hide —— 否则会恢复 title 让原生提示重新计时，来回切换
        if (el === current || current.contains(target)) return
      }
      if (!el) { hide(); return }
      hide()
      const text = el.getAttribute('title')
      if (!text) return // 空 title 不显示（与原生行为一致）
      titleElRef.current = el
      originalTitleRef.current = text
      // 进入元素即屏蔽原生 title —— 原生提示从这一刻起绝无弹出机会
      el.removeAttribute('title')
      startObserving(el)
      timerRef.current = window.setTimeout(() => {
        const rect = el.getBoundingClientRect()
        setAnchor({ text, x: rect.left + rect.width / 2, y: rect.bottom })
        setPos(null) // 等待布局测量校正
      }, SHOW_DELAY)
    }

    const handleMouseOut = (e: MouseEvent) => {
      const el = titleElRef.current
      if (!el) return
      const related = e.relatedTarget as Node | null
      if (related && el.contains(related)) return // 仍在元素内部移动
      hide()
    }

    // 滚动 / 窗口变化时隐藏（与原生 tooltip 行为一致）
    const hideOnViewportChange = () => hide()

    document.addEventListener('mouseover', handleMouseOver, true)
    document.addEventListener('mouseout', handleMouseOut, true)
    window.addEventListener('scroll', hideOnViewportChange, true)
    window.addEventListener('resize', hideOnViewportChange)
    return () => {
      document.removeEventListener('mouseover', handleMouseOver, true)
      document.removeEventListener('mouseout', handleMouseOut, true)
      window.removeEventListener('scroll', hideOnViewportChange, true)
      window.removeEventListener('resize', hideOnViewportChange)
      cancelTimer()
      stopObserving()
      restoreTitle()
    }
  }, [])

  // 布局测量：视口边缘自动翻转，useLayoutEffect 在绘制前同步校正，无闪烁
  useLayoutEffect(() => {
    const el = tipElRef.current
    if (!el || !anchor) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 8
    let left = anchor.x - w / 2
    let top = anchor.y + gap // 默认显示在元素下方
    left = Math.max(gap, Math.min(left, vw - w - gap))
    if (top + h > vh - gap) top = anchor.y - h - gap // 下方放不下则翻转到上方
    top = Math.max(gap, top)
    setPos({ left, top })
  }, [anchor])

  if (!anchor) return null

  return (
    <div
      ref={tipElRef}
      role="tooltip"
      className="pointer-events-none fixed z-[var(--z-tooltip)] max-w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs font-medium leading-relaxed shadow-[var(--shadow-tooltip)] animate-in fade-in-0 zoom-in-95 duration-150"
      style={{
        left: pos?.left,
        top: pos?.top,
        visibility: pos ? 'visible' : 'hidden', // 测量校正前隐藏，避免闪现未校正位置
        backgroundColor: 'var(--color-tooltip-bg)',
        color: 'var(--color-tooltip-text)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {anchor.text}
    </div>
  )
}
