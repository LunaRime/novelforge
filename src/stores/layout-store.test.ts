/**
 * layout-store —— 布局相关契约（UI 真机反馈 2026-09-19/20）
 *
 * 1. 旧的 `sidebarWidth` / `aiPanelWidth` / `bottomPanelHeight` 字段与 setter 已删除：
 *    它们从未被读写，留着会让人以为四个区域的尺寸归 store 管（2026-09-19 已因此给出过错误结论）。
 *    真实尺寸由 `App.tsx` 的 `react-resizable-panels`（`defaultSize` / `minSize` / `collapsible`）承担。
 *
 * 2. ⚠️ 这里**刻意没有** `collapseRegion` 之类的「拖到最小尺寸以下就把区域关掉」动作。
 *    2026-09-20 实测：`collapsible` 面板折叠时库仍在自己的注册表里保留该面板，
 *    如果此时把 `*Open` 置 false 让 `App.tsx` 卸载它，就会出现「注册 3 个面板 / DOM 只有 2 个」
 *    的不一致，`ResizeObserver` 回调随即抛 `Invalid 3 panel layout: …` 并刷屏。
 *    区域「缩到一定程度即收起」由库自身的 `collapsible` 完成（折到 `collapsedSize`，默认 0%），
 *    拖回即可恢复；显式开关仍走 `toggleSidebar` / `toggleAIPanel` / `toggleBottomPanel`。
 */
import { describe, expect, it } from 'vitest'
import { useLayoutStore } from './layout-store'

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

  it('刻意不提供「折叠即关闭区域」的 store 动作（会导致面板注册表与 DOM 不一致）', () => {
    const s = useLayoutStore.getState() as unknown as Record<string, unknown>

    expect(s.collapseRegion).toBeUndefined()
  })

  it('三个区域仍有显式开关动作（收起后可从活动栏找回）', () => {
    const s = useLayoutStore.getState()
    useLayoutStore.setState({ sidebarOpen: false, aiPanelOpen: false, bottomPanelOpen: false })

    s.toggleSidebar()
    s.toggleAIPanel()
    s.toggleBottomPanel()

    const after = useLayoutStore.getState()
    expect([after.sidebarOpen, after.aiPanelOpen, after.bottomPanelOpen]).toEqual([true, true, true])
  })
})
