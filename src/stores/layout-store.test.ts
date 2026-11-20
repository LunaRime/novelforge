// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useLayoutStore } from './layout-store'

const state = useLayoutStore.getState

beforeEach(() => {
  useLayoutStore.setState(useLayoutStore.getInitialState(), true)
  useLayoutStore.persist.clearStorage()
})

describe('layout-store · 拖拽关闭区域', () => {
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

describe('工作台偏好', () => {
  it('升级旧偏好时读取常用面板并移除预览模式字段', async () => {
    localStorage.setItem('novelforge:layout', JSON.stringify({ version: 0, state: {
      sidebarOpen: false, sidebarView: 'project', aiPanelOpen: true, rightView: 'ai-output', bottomPanelOpen: true, bottomTab: 'log',
      workbenchMode: 'write', writingPanels: { sidebarOpen: true, aiPanelOpen: false },
    } }))
    await useLayoutStore.persist.rehydrate()
    expect(state()).toMatchObject({ sidebarOpen: false, sidebarView: 'project', aiPanelOpen: true, rightView: 'ai-output', bottomTab: 'log' })
    expect(state()).not.toHaveProperty('workbenchMode')
    expect(state()).not.toHaveProperty('writingPanels')
    expect(localStorage.getItem('novelforge:layout')).not.toContain('writingPanels')
  })

  it('F11 不修改面板偏好，也不会把专注状态持久化', async () => {
    state().openRightPanel('ai-output')
    state().toggleFocusMode()
    expect(state()).toMatchObject({ focusMode: true, aiPanelOpen: true, rightView: 'ai-output' })
    const stored = localStorage.getItem('novelforge:layout')!
    useLayoutStore.setState(useLayoutStore.getInitialState(), true)
    localStorage.setItem('novelforge:layout', stored)
    await useLayoutStore.persist.rehydrate()
    expect(state()).toMatchObject({ focusMode: false, aiPanelOpen: true, rightView: 'ai-output' })
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
