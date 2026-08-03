/**
 * GlobalTitleTooltip — 全局 title 属性现代化代理
 *
 * 将原生 `<title>` 悬停提示（浏览器默认样式）统一替换为现代化 Tooltip UI：
 * 毛玻璃背景、圆角、缩放渐显动画、视口边缘自动翻转。
 *
 * 工作原理（根源性设计——title 在 DOM 中**永不存活**）：
 * 1. 挂载时全量扫描 document，提取所有 [title] 文本存入 WeakMap 并移除属性
 * 2. 全局 MutationObserver（document 级）持续拦截：任何新插入/属性变化的
 *    title 在 microtask 内被提取并移除——比 mouseover 事件排队更早执行，
 *    即使主线程被阻塞（流式 LLM 高频渲染），title 存活窗口也只是微任务延迟
 * 3. 原生 tooltip 需要元素 title 存在 + 悬停计时（秒级）——title 在 DOM 中
 *    不存在，原生提示**从根上无弹出机会**，不存在与 UI 线程竞争的竞态
 * 4. mouseover 捕获阶段从 WeakMap 取文本，400ms 延迟显示自定义 tooltip
 * 5. 位置跟随元素（居中于元素下方），接近视口边缘时自动翻转
 *
 * 挂载一次（App.tsx 顶层）即可覆盖全部 title 用法，内容仍由各组件
 * t() 国际化文本提供。
 *
 * ⚠️ 注意：不要依赖元素上的 title 属性定位/取文本（已被移除）——
 * 一律走 titleStore WeakMap。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 显示延迟（与原生 tooltip 接近的体验） */
const SHOW_DELAY = 400

/** 元素 → 原始 title 文本（DOM 属性移除后唯一事实来源） */
const titleStore = new WeakMap<Element, string>()

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

  // ===== 全局 title 提取与拦截（DOM 层根除原生 tooltip） =====
  // 观察器回调在 microtask 执行：主线程再忙，当前任务一结束就处理，
  // 远早于 mouseover 事件排队（task 级）——竞态窗口收敛到微任务延迟
  useLayoutEffect(() => {
    // 挂载时全量扫描（useLayoutEffect：paint 前完成，首帧即无 title）
    const existing = document.querySelectorAll<HTMLElement>('[title]')
    for (const el of existing) {
      const text = el.getAttribute('title')
      if (text) {
        titleStore.set(el, text)
        el.removeAttribute('title')
      }
    }

    // 全局观察器：拦截后续所有 title 出现（React 重挂载插入 / 代码 setAttribute）。
    // 快速路径：仅处理 addedNodes 自身——React 挂载是逐节点插入，带 title 的
    // 节点必作为 addedNodes 出现；不做子树递归（CodeMirror 等高频 DOM 变更下
    // 递归 O(N) 扫描会卡顿）。innerHTML 批量插入的 title 由 mouseover 兜底移除。
    const globalObserver = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          // title 属性被（重）设置——提取并移除
          const el = r.target as Element
          const text = el.getAttribute('title')
          if (text !== null) {
            titleStore.set(el, text)
            el.removeAttribute('title')
          }
        } else {
          for (const node of r.addedNodes) {
            if (node.nodeType !== 1) continue
            const el = node as Element
            const text = el.getAttribute('title')
            if (text !== null) {
              titleStore.set(el, text)
              el.removeAttribute('title')
            }
          }
        }
      }
    })
    globalObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title'],
    })

    return () => {
      globalObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    const cancelTimer = () => { window.clearTimeout(timerRef.current) }

    const hide = () => {
      cancelTimer()
      titleElRef.current = null
      setAnchor(null)
      setPos(null)
    }

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target) return
      // 双源查找：WeakMap 记录（观察器已提取）或 DOM 上仍存的 title 属性
      // （观察器漏网兜底——mouseover 捕获是事件最早时机，同步移除可杜绝
      //   原生提示的任何计时窗口）
      let el: Element | null = target
      while (el && !titleStore.has(el) && !el.hasAttribute('title')) {
        el = el.parentElement
      }
      const current = titleElRef.current
      if (current) {
        // 关键：鼠标仍在当前处理元素内部移动（按钮内图标↔padding 穿越时
        // 仍会触发 mouseover）→ 保持现状，绝不 hide —— 否则 tooltip 反复
        // 隐藏/重现，体验闪烁
        if (el === current || current.contains(target)) return
      }
      if (!el) { hide(); return }
      hide()
      // 兜底：DOM 上仍有 title（观察器漏网）→ 立即提取并移除
      const domTitle = el.getAttribute('title')
      if (domTitle !== null) {
        titleStore.set(el, domTitle)
        el.removeAttribute('title')
      }
      const text = titleStore.get(el)
      if (!text) return // 空 title 不显示（与原生行为一致）
      titleElRef.current = el as HTMLElement
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
      titleElRef.current = null
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
      className="pointer-events-none fixed z-[var(--z-tooltip)] max-w-[min(360px,calc(100vw-24px))] overflow-hidden whitespace-pre-line rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs font-medium leading-relaxed shadow-[var(--shadow-tooltip)] animate-in fade-in-0 zoom-in-95 duration-150"
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
