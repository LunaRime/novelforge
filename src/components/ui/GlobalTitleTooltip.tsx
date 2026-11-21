/**
 * GlobalTitleTooltip — 全局 title 属性现代化代理
 *
 * 将原生 `<title>` 悬停提示（浏览器默认样式）统一替换为现代化 Tooltip UI：
 * 图标按钮也可用 data-tooltip 声明提示，支持键盘聚焦和右侧定位。
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

/** 提取 title 到 WeakMap 并移除属性 —— title 在 DOM 中**永不存活**（全链路唯一入口） */
function extractTitle(el: Element): void {
  const text = el.getAttribute('title')
  if (text !== null) {
    titleStore.set(el, text)
    el.removeAttribute('title')
  }
}

interface TipAnchor {
  text: string
  rect: DOMRect
  side: 'bottom' | 'right'
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
  const titleElRef = useRef<Element | null>(null)

  // ===== 全局 title 提取与拦截（DOM 层根除原生 tooltip） =====
  // 观察器回调在 microtask 执行：主线程再忙，当前任务一结束就处理，
  // 远早于 mouseover 事件排队（task 级）——竞态窗口收敛到微任务延迟
  useLayoutEffect(() => {
    // 挂载时全量扫描（useLayoutEffect：paint 前完成，首帧即无 title）
    for (const el of document.querySelectorAll('[title]')) extractTitle(el)

    // 全局观察器：拦截后续所有 title 出现（React 重挂载插入 / 代码 setAttribute）。
    // ⚠️ 必须做**子树扫描**（2026-10-02 修复）：React 把整棵子树作为**一个** addedNode 批量
    // 插入（条件挂载 / 数据到达后的列表）——只查 addedNode 自身会让整棵子树的 title 全部漏网，
    // 而 Chromium 对「无 title 的悬停元素」会**回退取最近祖先的 title**弹原生提示
    // （实测：模型行「未配置密钥」红点悬停弹出祖先主按钮的「编辑」原生提示；全文档同型漏网 44 处）。
    // 成本可控：querySelectorAll 只扫**新增子树**（与本次 DOM 变更量成正比），不做全文档重扫。
    const globalObserver = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          extractTitle(r.target as Element)
        } else {
          for (const node of r.addedNodes) {
            if (node.nodeType !== 1) continue
            const el = node as Element
            extractTitle(el)
            for (const sub of el.querySelectorAll('[title]')) extractTitle(sub)
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

    const schedule = (el: Element) => {
      hide()
      const text = el.getAttribute('data-tooltip') ?? titleStore.get(el)
      if (!text) return
      titleElRef.current = el
      timerRef.current = window.setTimeout(() => {
        if (!el.isConnected) return
        setAnchor({
          text,
          rect: el.getBoundingClientRect(),
          side: el.getAttribute('data-tooltip-side') === 'right' ? 'right' : 'bottom',
        })
      }, SHOW_DELAY)
    }

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof Element)) return
      // 双源查找：WeakMap 记录（观察器已提取）或 DOM 上仍存的 title 属性
      // （观察器漏网兜底——mouseover 捕获是事件最早时机，同步移除可杜绝
      //   原生提示的任何计时窗口）
      let el: Element | null = target
      while (el && !el.hasAttribute('data-tooltip') && !titleStore.has(el) && !el.hasAttribute('title')) {
        el = el.parentElement
      }
      // 防御性全链提取（2026-10-02）：把光标路径上仍存活的 title 一律剥入 titleStore——
      // 被悬停元素自身已处理时，祖先 title 只要存活仍会触发原生提示（本次 bug 的形态）；
      // 该循环同时兜住观察器的任何漏网（mouseover 是事件最早时机，同步剥离无计时窗口）
      for (let p: Element | null = target; p; p = p.parentElement) extractTitle(p)
      const current = titleElRef.current
      if (current) {
        // 关键：鼠标仍在当前处理元素内部移动（按钮内图标↔padding 穿越时
        // 仍会触发 mouseover）→ 保持现状，绝不 hide —— 否则 tooltip 反复
        // 隐藏/重现，体验闪烁
        if (el === current || current.contains(target)) return
      }
      if (!el) { hide(); return }
      schedule(el)
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
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target
      if (target instanceof Element && target.matches('[data-tooltip]:focus-visible')) schedule(target)
    }
    const handleFocusOut = (e: FocusEvent) => { if (e.target === titleElRef.current) hide() }

    document.addEventListener('mouseover', handleMouseOver, true)
    document.addEventListener('mouseout', handleMouseOut, true)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)
    window.addEventListener('scroll', hideOnViewportChange, true)
    window.addEventListener('resize', hideOnViewportChange)
    return () => {
      document.removeEventListener('mouseover', handleMouseOver, true)
      document.removeEventListener('mouseout', handleMouseOut, true)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
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
    const { rect, side } = anchor
    let left = side === 'right' ? rect.right + gap : rect.left + (rect.width - w) / 2
    let top = side === 'right' ? rect.top + (rect.height - h) / 2 : rect.bottom + gap
    if (side === 'right' && left + w > vw - gap) left = rect.left - w - gap
    if (side === 'bottom' && top + h > vh - gap) top = rect.top - h - gap
    left = Math.max(gap, Math.min(left, vw - w - gap))
    top = Math.max(gap, Math.min(top, vh - h - gap))
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
