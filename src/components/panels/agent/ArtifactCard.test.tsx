// @vitest-environment jsdom
/**
 * ArtifactCard — 可供性接线（2026-09-27 修复）
 *
 * 修复前：`<div onClick>` 键盘不可达；只有 file/tab 三类有动作，其余产物类型
 * hover 变色、点下去零响应（"假按钮"）。
 * 修复后：有可达目标的类型 = 整卡原生 button；blueprint_generated → 跳章节草稿；
 * workflow_started → 打开底部「任务」面板；无目标的类型 = 静态卡（无按钮、无点击形态）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ArtifactCard from './ArtifactCard'
import { useLayoutStore } from '../../../stores/layout-store'

const openDraftByChapterMock = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../sidebar/SidebarShared', () => ({
  openDraftByChapter: openDraftByChapterMock,
}))

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
  vi.clearAllMocks()
})

describe('ArtifactCard — 可供性接线（2026-09-27）', () => {
  it('blueprint_generated（带 chapterNumber）→ 整卡是 button；点击跳章节草稿', async () => {
    const el = render(<ArtifactCard artifact={{ type: 'blueprint_generated', name: '第3章 雪夜入谷', metadata: { chapterNumber: 3 } }} />)
    const btn = el.querySelector('button')!
    expect(btn).toBeTruthy()
    btn.focus()
    expect(document.activeElement).toBe(btn)
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(openDraftByChapterMock).toHaveBeenCalledWith(3, '第3章 雪夜入谷')
  })

  it('workflow_started → 点击打开底部「任务」面板', async () => {
    useLayoutStore.setState({ bottomPanelOpen: false, bottomTab: 'log' })
    const el = render(<ArtifactCard artifact={{ type: 'workflow_started', name: '章节创作流水线' }} />)
    await act(async () => { (el.querySelector('button') as HTMLButtonElement).click() })
    expect(useLayoutStore.getState().bottomTab).toBe('tasks')
    expect(useLayoutStore.getState().bottomPanelOpen).toBe(true)
  })

  it('无可达目标的类型（如 summary_updated）→ 静态卡：不渲染按钮、不做可点暗示', () => {
    const el = render(<ArtifactCard artifact={{ type: 'summary_updated', name: '摘要更新' }} />)
    expect(el.querySelector('button')).toBeNull()
    expect(el.textContent).toContain('摘要更新')
  })
})
