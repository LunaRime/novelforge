// @vitest-environment jsdom
/**
 * ManuscriptGroup — RM-SB-01 回归（2026-09-27 真机实锤）
 *
 * 修复前：ChapterExportDialog 挂在 SidebarGroup children 里 → 收起态（open=false）children
 * 不渲染 → 点击导出零响应、exportOpen 静默置位，之后展开卡片时弹窗"报复性"自行出现。
 * 修复后：对话框挂在折叠门之外 —— 收起态点击导出，弹窗立即可见；只展开不点导出则不出现。
 */
import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ManuscriptGroup from './ManuscriptGroup'
import { t } from '../../../shared/locale'

const FILES = [
  { path: 'vela://manuscript/1', name: 'chapter_1.md', isDir: false },
  { path: 'vela://manuscript/2', name: 'chapter_2.md', isDir: false },
]

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(node) })
  return container
}

beforeAll(() => {
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  g.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ManuscriptGroup — RM-SB-01 导出弹窗（2026-09-27）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    const invoke = vi.fn(async () => null)
    Object.defineProperty(window, 'velaAPI', {
      value: { invoke, on: () => () => {}, once: () => {}, send: () => {}, setZoomLevel: () => {}, setZoomFactor: () => {}, getZoomLevel: () => 0 },
      configurable: true,
    })
  })

  it('收起态点「批量导出」→ 弹窗立即可见（挂在折叠门之外）', async () => {
    const el = render(<ManuscriptGroup files={FILES} projectPath="/mock/proj" />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })

    const exportBtn = [...el.querySelectorAll('button')].find(b => b.title === t('export.batchExportTip'))!
    expect(exportBtn).toBeTruthy()
    await act(async () => { exportBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    // Radix portal → document.body
    expect(document.body.textContent).toContain(t('export.chapterPreview'))
  })

  it('只在收起态展开卡片、不点导出 → 不出现弹窗（exportOpen 不再泄漏）', async () => {
    const el = render(<ManuscriptGroup files={FILES} projectPath="/mock/proj" />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })

    const head = [...el.querySelectorAll('button')].find(b => b.textContent?.includes(t('manuscript.title')))!
    await act(async () => { head.click() })

    expect(document.body.textContent).not.toContain(t('export.chapterPreview'))
  })
})
