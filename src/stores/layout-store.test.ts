/**
 * layout-store —— 布局相关契约（UI 真机反馈 2026-09-19/20）
 *
 * 1. 旧的 `sidebarWidth` / `aiPanelWidth` / `bottomPanelHeight` 字段与 setter 已删除：
 *    它们从未被读写，留着会让人以为四个区域的尺寸归 store 管（2026-09-19 已因此给出过错误结论）。
 *    真实尺寸由 `App.tsx` 的 `react-resizable-panels` 承担。
 *
 * 2. `closeRegion` 是「分隔条拖过阈值 → 区域整体关闭」的落点，但**只能在松手后调用**：
 *    `react-resizable-panels` 在拖拽中持有布局，拖拽途中卸载面板会让「注册 N 个 / DOM N−1 个」
 *    不一致，`ResizeObserver` 回调随即抛 `Invalid N panel layout: …` 并刷屏（2026-09-20 实测事故）。
 *    时序由 `App.tsx` 的 `closeOnDragBelow` 保证（武装一次性 pointerup，松手后一个宏任务再关）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useLayoutStore } from './layout-store'

describe('layout-store · 拖拽关闭区域', () => {
  beforeEach(() => {
    useLayoutStore.setState({ sidebarOpen: true, aiPanelOpen: true, bottomPanelOpen: true })
  })

  it('closeRegion(sidebar) → 只关侧栏，另两区不受影响', () => {
    useLayoutStore.getState().closeRegion('sidebar')

    const s = useLayoutStore.getState()
    expect(s.sidebarOpen).toBe(false)
    expect(s.aiPanelOpen).toBe(true)
    expect(s.bottomPanelOpen).toBe(true)
  })

  it('closeRegion(ai) → 只关 AI 面板', () => {
    useLayoutStore.getState().closeRegion('ai')

    const s = useLayoutStore.getState()
    expect(s.aiPanelOpen).toBe(false)
    expect(s.sidebarOpen).toBe(true)
    expect(s.bottomPanelOpen).toBe(true)
  })

  it('closeRegion(bottom) → 只关底栏', () => {
    useLayoutStore.getState().closeRegion('bottom')

    const s = useLayoutStore.getState()
    expect(s.bottomPanelOpen).toBe(false)
    expect(s.sidebarOpen).toBe(true)
    expect(s.aiPanelOpen).toBe(true)
  })

  it('三个区域关闭后都能从显式开关找回（不是单向陷阱）', () => {
    const s = () => useLayoutStore.getState()
    s().closeRegion('sidebar')
    s().closeRegion('ai')
    s().closeRegion('bottom')
    expect([s().sidebarOpen, s().aiPanelOpen, s().bottomPanelOpen]).toEqual([false, false, false])

    // 对应三个真实入口：左侧活动栏 ×2、右侧图标栏 ×1
    s().toggleSidebar()
    s().toggleAIPanel()
    s().toggleBottomPanel()
    expect([s().sidebarOpen, s().aiPanelOpen, s().bottomPanelOpen]).toEqual([true, true, true])
  })
})

describe('layout-store · 布局尺寸不再由 store 承担', () => {
  it('旧尺寸字段与其 setter 均已移除（防止「尺寸归 store 管」的误导）', () => {
    const s = useLayoutStore.getState() as unknown as Record<string, unknown>

    expect(s.sidebarWidth).toBeUndefined()
    expect(s.aiPanelWidth).toBeUndefined()
    expect(s.bottomPanelHeight).toBeUndefined()
    expect(s.setSidebarWidth).toBeUndefined()
    expect(s.setAIPanelWidth).toBeUndefined()
    expect(s.setBottomPanelHeight).toBeUndefined()
  })
})
