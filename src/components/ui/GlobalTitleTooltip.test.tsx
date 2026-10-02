// @vitest-environment jsdom
/**
 * GlobalTitleTooltip — 全局 title 拦截的回归锁（2026-10-02）
 *
 * 背景：观察器原「快速路径」只检查 addedNodes **自身**、不做子树递归。
 * React 把整棵子树作为**一个** addedNode 批量插入（条件挂载/数据到达后的列表），
 * 子树内部的 title 全部漏网留在 DOM —— 悬停「无 title 的子元素」时，Chromium 会
 * 回退用**最近祖先的 title** 弹**原生**提示（实测：模型行「未配置密钥」红点悬停，
 * 弹出祖先主按钮的「编辑」原生提示；全文档同型漏网 44 处）。
 *
 * 本文件锁住三层防线：
 * 1. 观察器：子树批量插入 → 整棵子树的 title 全被提取
 * 2. 属性路径 / 挂载前存量：维持既有行为
 * 3. 悬停兜底：即使观察器还来不及跑（同步插入 + 同步悬停），mouseover 也会
 *    把光标路径上的 title 全部剥离（含祖先），杜绝原生提示的任何计时窗口
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import GlobalTitleTooltip from './GlobalTitleTooltip'

let container: HTMLDivElement | null = null
let root: Root | null = null

const flush = () => new Promise(r => setTimeout(r, 0))

function mount(): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<GlobalTitleTooltip />)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  // 清掉本文件可能残留的 title（避免跨用例污染）
  for (const el of document.querySelectorAll('[title]')) el.removeAttribute('title')
})

describe('GlobalTitleTooltip 全局拦截', () => {
  it('子树批量插入：整棵子树的 title 都被提取（React 批量挂载形状——本次修复的漏网）', async () => {
    mount()
    const wrap = document.createElement('div')
    wrap.innerHTML = '<button title="编辑"><span title="未配置密钥">x</span></button>'
    document.body.appendChild(wrap)
    await flush()
    expect(document.querySelectorAll('[title]').length).toBe(0)
    wrap.remove()
  })

  it('属性路径：连接后再 setAttribute 的 title 也被提取', async () => {
    mount()
    const s = document.createElement('span')
    document.body.appendChild(s)
    s.setAttribute('title', '后设')
    await flush()
    expect(s.hasAttribute('title')).toBe(false)
    s.remove()
  })

  it('挂载前已存在的 title：挂载时全量扫描清除', () => {
    const pre = document.createElement('span')
    pre.setAttribute('title', '先存在')
    document.body.appendChild(pre)
    mount()
    expect(pre.hasAttribute('title')).toBe(false)
    pre.remove()
  })

  it('悬停兜底：观察器未及运行时，mouseover 同步剥链上全部 title，tooltip 取最近 title', async () => {
    vi.useFakeTimers()
    try {
      mount()
      const wrap = document.createElement('div')
      // 子元素自带宽 title、祖先按钮也带 title——复刻红点形态
      wrap.innerHTML = '<button title="编辑" id="btn"><span id="child" title="未配置密钥">x</span></button>'
      document.body.appendChild(wrap)
      // 刻意不 flush：模拟观察器 microtask 尚未执行时用户已悬停
      const child = wrap.querySelector('#child') as HTMLElement
      act(() => {
        child.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      // 链上 title 应被同步剥离（含祖先「编辑」）
      expect(wrap.querySelector('[title]')).toBeNull()
      // 400ms 后自定义 tooltip 出现，文本取**最近**的 title（子元素的「未配置密钥」，与原生取最近语义一致）
      act(() => { vi.advanceTimersByTime(450) })
      const tip = document.querySelector('[role="tooltip"]')
      expect(tip?.textContent).toBe('未配置密钥')
      wrap.remove()
    } finally {
      vi.useRealTimers()
    }
  })
})
