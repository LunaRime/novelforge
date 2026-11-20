// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { selectWorkbenchPanels, useLayoutStore } from './layout-store'

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

describe('工作台模式', () => {
  it('没有模式字段的旧偏好在构建态恢复，切入写作态默认收起三块面板', async () => {
    localStorage.setItem('novelforge:layout', JSON.stringify({ version: 0, state: {
      sidebarOpen: false, sidebarView: 'project', aiPanelOpen: true, rightView: 'ai-output', bottomPanelOpen: true, bottomTab: 'log',
    } }))
    await useLayoutStore.persist.rehydrate()
    expect(state().workbenchMode).toBe('build')
    expect(selectWorkbenchPanels(state())).toMatchObject({ sidebarOpen: false, aiPanelOpen: true, rightView: 'ai-output', bottomTab: 'log' })
    state().setWorkbenchMode('write')
    expect(selectWorkbenchPanels(state())).toEqual({ sidebarOpen: false, aiPanelOpen: false, rightView: 'agent', bottomPanelOpen: false, bottomTab: 'tasks' })
    expect(state().sidebarView).toBe('project')
  })

  it('写作态召回和关闭面板，构建态仍可恢复各自的开关和视图', () => {
    state().openRightPanel('ai-output')
    state().openBottomTab('log')
    state().setWorkbenchMode('write')
    state().toggleSidebar()
    state().openRightPanel('agent')
    state().openBottomTab('tasks')
    state().closeRegion('sidebar')
    expect(selectWorkbenchPanels(state())).toEqual({ sidebarOpen: false, aiPanelOpen: true, rightView: 'agent', bottomPanelOpen: true, bottomTab: 'tasks' })
    state().setWorkbenchMode('build')
    expect(selectWorkbenchPanels(state())).toMatchObject({ sidebarOpen: true, aiPanelOpen: true, rightView: 'ai-output', bottomPanelOpen: true, bottomTab: 'log' })
    state().setWorkbenchMode('write')
    expect(selectWorkbenchPanels(state())).toMatchObject({ sidebarOpen: false, aiPanelOpen: true, rightView: 'agent', bottomPanelOpen: true, bottomTab: 'tasks' })
  })

  it('重新加载恢复工作状态和写作面板，F11 专注状态只在本次会话生效', async () => {
    state().setWorkbenchMode('write')
    state().openRightPanel('agent')
    state().toggleFocusMode()
    expect(state()).toMatchObject({ workbenchMode: 'write', focusMode: true })
    expect(selectWorkbenchPanels(state()).aiPanelOpen).toBe(true)
    state().toggleFocusMode()
    expect(state()).toMatchObject({ workbenchMode: 'write', focusMode: false })
    state().toggleFocusMode()

    const stored = localStorage.getItem('novelforge:layout')!
    useLayoutStore.setState(useLayoutStore.getInitialState(), true)
    localStorage.setItem('novelforge:layout', stored)
    await useLayoutStore.persist.rehydrate()
    expect(state()).toMatchObject({ workbenchMode: 'write', focusMode: false })
    expect(selectWorkbenchPanels(state())).toMatchObject({ aiPanelOpen: true, bottomPanelOpen: false })
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
