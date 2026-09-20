/**
 * layout-store — 「缩到阈值即收起该区域」（UI 真机反馈 2026-09-19 第 ② 条）
 *
 * 契约：
 * - 拖拽把区域缩到 `minSize` 以下时，`react-resizable-panels` 的 `collapsible` 面板会折到
 *   `collapsedSize`（默认 0%），其 `onResize` 随之给出 `asPercentage === 0`；
 *   App.tsx 据此调用 `collapseRegion` 把该区域**收起**（而不是停在死窄条）。
 * - 三个区域都必须能**重新打开**，否则「收起」会变成找不回来的单向陷阱：
 *   侧栏 / 底栏 ← 左侧活动栏（`toggleSidebar` / `setBottomTab` / `openBottomTab`），
 *   AI 面板 ← 右侧图标栏（`toggleAIPanel`）。
 * - 旧的 `sidebarWidth` / `aiPanelWidth` / `bottomPanelHeight` 字段已删除：它们从未被读写，
 *   留着会让人误以为布局尺寸由 store 管（2026-09-19 已因此给出过错误结论）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useLayoutStore } from './layout-store'

describe('layout-store · collapseRegion（缩到阈值即收起）', () => {
  beforeEach(() => {
    useLayoutStore.setState({ sidebarOpen: true, aiPanelOpen: true, bottomPanelOpen: true })
  })

  it('collapseRegion(sidebar) → 只收起侧栏，另两区不受影响', () => {
    useLayoutStore.getState().collapseRegion('sidebar')

    const s = useLayoutStore.getState()
    expect(s.sidebarOpen).toBe(false)
    expect(s.aiPanelOpen).toBe(true)
    expect(s.bottomPanelOpen).toBe(true)
  })

  it('collapseRegion(ai) → 只收起 AI 面板，另两区不受影响', () => {
    useLayoutStore.getState().collapseRegion('ai')

    const s = useLayoutStore.getState()
    expect(s.aiPanelOpen).toBe(false)
    expect(s.sidebarOpen).toBe(true)
    expect(s.bottomPanelOpen).toBe(true)
  })

  it('collapseRegion(bottom) → 只收起底栏，另两区不受影响', () => {
    useLayoutStore.getState().collapseRegion('bottom')

    const s = useLayoutStore.getState()
    expect(s.bottomPanelOpen).toBe(false)
    expect(s.sidebarOpen).toBe(true)
    expect(s.aiPanelOpen).toBe(true)
  })

  it('三区收起后都能重新打开（收起不是单向陷阱）', () => {
    const s = () => useLayoutStore.getState()
    s().collapseRegion('sidebar')
    s().collapseRegion('ai')
    s().collapseRegion('bottom')
    expect([s().sidebarOpen, s().aiPanelOpen, s().bottomPanelOpen]).toEqual([false, false, false])

    // 对应三个真实入口：左侧活动栏 ×2、右侧图标栏 ×1
    s().toggleSidebar()
    s().toggleAIPanel()
    s().toggleBottomPanel()
    expect([s().sidebarOpen, s().aiPanelOpen, s().bottomPanelOpen]).toEqual([true, true, true])
  })

  it('旧布局尺寸字段与其 setter 已移除（防止「尺寸归 store 管」的误导）', () => {
    const s = useLayoutStore.getState() as unknown as Record<string, unknown>

    expect(s.sidebarWidth).toBeUndefined()
    expect(s.aiPanelWidth).toBeUndefined()
    expect(s.bottomPanelHeight).toBeUndefined()
    expect(s.setSidebarWidth).toBeUndefined()
    expect(s.setAIPanelWidth).toBeUndefined()
    expect(s.setBottomPanelHeight).toBeUndefined()
  })
})
