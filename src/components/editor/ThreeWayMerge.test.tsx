// @vitest-environment jsdom
/**
 * ThreeWayMerge 弹窗行为回归锁（L1 Task 1 R1）——
 * diff-core 抽取（src/services/diff/paragraph-align.ts）前后，弹窗两个入口共用
 * 的 computeSegments→buildMergeSegments 语义必须字节级等价：本文件在改动前先绿，
 * 组件切换 import 后 4 条仍绿 = 行为零变化证据。
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ThreeWayMerge from './ThreeWayMerge'

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn() as never
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  }
})

const roots: Root[] = []
function renderMerge(original: string, modified: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const onComplete = vi.fn()
  act(() => {
    root.render(<ThreeWayMerge originalContent={original} modifiedContent={modified} onComplete={onComplete} />)
  })
  return { container, onComplete }
}
function findButton(container: HTMLElement, labelPart: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button'))
    .find(b => (b.textContent ?? '').includes(labelPart))
  expect(btn, `button containing "${labelPart}"`).toBeTruthy()
  return btn as HTMLButtonElement
}

describe('ThreeWayMerge 弹窗行为（抽取回归锁 R1）', () => {
  it('全部修稿 → 完成：onComplete 收到与 modifiedContent 逐字节一致的结果', () => {
    const original = '一\n\n二\n\n三'
    const modified = '一改\n\n二\n\n三'
    const { container, onComplete } = renderMerge(original, modified)
    act(() => { findButton(container, '全部修稿').click() })
    act(() => { findButton(container, '完成合并').click() })
    expect(onComplete).toHaveBeenCalledWith('一改\n\n二\n\n三')
  })
  it('不动任何 hunk → 完成：onComplete 返回 originalContent', () => {
    const original = '甲\n\n乙\n\n丙'
    const modified = '甲x\n\n乙\n\n丙'
    const { container, onComplete } = renderMerge(original, modified)
    act(() => { findButton(container, '完成合并').click() })
    expect(onComplete).toHaveBeenCalledWith('甲\n\n乙\n\n丙')
  })
  it('全部还原 → 完成：回到原稿', () => {
    const { container, onComplete } = renderMerge('A\n\nB', 'A2\n\nB')
    act(() => { findButton(container, '全部修稿').click() })
    act(() => { findButton(container, '全部原稿').click() })
    act(() => { findButton(container, '完成合并').click() })
    expect(onComplete).toHaveBeenCalledWith('A\n\nB')
  })
  it('段拆 1:2 与纯增段仍产出 hunk（完成 = 修稿全文）', () => {
    const original = '第一段\n\n第二段'
    const modified = '第一段甲\n\n第二段甲\n\n新增段落' // 拆?/增段混合——仅验证完成输出 == 修稿正文
    const { container, onComplete } = renderMerge(original, modified)
    act(() => { findButton(container, '全部修稿').click() })
    act(() => { findButton(container, '完成合并').click() })
    expect(onComplete).toHaveBeenCalledWith(modified)
  })
})

afterEach(() => {
  roots.forEach(r => act(() => r.unmount()))
  roots.length = 0
  document.body.innerHTML = ''
})
