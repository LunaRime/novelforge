// @vitest-environment jsdom
/**
 * AgentMemoryView — AI 面板记忆入口（CCR P3 Task 3）
 *
 * 验证：
 * 1. 评审项 7：无项目打开空态（显示「打开项目后可查看记忆」而非报错/空白）
 * 2. 文件列表渲染 + 行展开查看（memory:read）
 * 3. 返回按钮 → memoryView=false（恢复对话视图）
 * 4. AgentHeader「记忆」按钮 → toggleMemoryView（active 态切换）
 * 5. AgentConversation memoryView=true → 渲染记忆视图（视图切换链路）
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import AgentMemoryView from './AgentMemoryView'
import AgentHeader from './AgentHeader'
import AgentConversation from './AgentConversation'
import { useAgentStore } from '../../../stores/agent-store'
import { useProjectStore } from '../../../stores/project-store'

const MEMORY_CONTENT = '---\n---\n\n# 记忆内容测试'

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn() as never
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function render(ui: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

/** 模拟项目打开（path-only mock，类型绕过 as never） */
const openProject = () => {
  useProjectStore.setState({ currentProject: { path: '/mock/proj' } as never })
}

/** 重置面板视图状态 */
const resetView = () => {
  useAgentStore.setState({ memoryView: false, showHistory: false })
}

describe('AgentMemoryView 记忆查看器（AI 面板入口）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    Object.defineProperty(window, 'velaAPI', {
      value: {
        invoke: vi.fn(async (ch: string) => {
          if (ch === 'memory:list') {
            return [
              { file: 'book-state.md', kind: 'book', stale: false, mtime: 1 },
              { file: 'shared.md', kind: 'shared', stale: true, mtime: 2 },
            ]
          }
          if (ch === 'memory:read') return MEMORY_CONTENT
          return null
        }),
      },
      configurable: true,
    })
    useProjectStore.setState({ currentProject: null })
    resetView()
  })

  it('无项目打开：显示「打开项目后可查看记忆」空态（评审项 7，不报错）', async () => {
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) }) // memory:list 竞态落地
    expect(container.textContent).toContain('打开项目后可查看记忆')
    expect(container.textContent).not.toContain('book-state.md')
    act(() => { root.unmount() })
  })

  it('有项目：文件列表渲染，行展开后 memory:read 内容展示（只读，无编辑按钮）', async () => {
    openProject()
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    // 列表（book + shared 两行）与 kind 徽标
    expect(container.textContent).toContain('book-state.md')
    expect(container.textContent).toContain('shared.md')
    expect(container.textContent).toContain('待重建') // shared stale 徽标

    // 行点击 → memory:read（取最内层匹配 div = 可点击行）
    const rowDivs = [...container.querySelectorAll('div')].filter(d => d.textContent?.includes('book-state.md'))
    const row = rowDivs[rowDivs.length - 1]!
    act(() => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(container.textContent).toContain('记忆内容测试')
    const invoke = (window.velaAPI.invoke as ReturnType<typeof vi.fn>)
    expect(invoke).toHaveBeenCalledWith('memory:read', 'book-state.md')
    // 面板视图只读：行内无编辑按钮
    expect(container.textContent).not.toContain('编辑')
    act(() => { root.unmount() })
  })

  it('返回按钮：memoryView 恢复 false（回到对话视图）', async () => {
    openProject()
    useAgentStore.setState({ memoryView: true })
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    const back = [...container.querySelectorAll('button')].find(b => b.title === '返回对话')!
    act(() => { back.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(useAgentStore.getState().memoryView).toBe(false)
    act(() => { root.unmount() })
  })

  it('AgentHeader「记忆」按钮：点击切换 memoryView', async () => {
    const { container, root } = render(<AgentHeader />)
    const btn = [...container.querySelectorAll('button')].find(b => b.title === '记忆')!
    expect(btn).toBeTruthy()
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(useAgentStore.getState().memoryView).toBe(true)
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(useAgentStore.getState().memoryView).toBe(false)
    act(() => { root.unmount() })
  })

  it('AgentConversation 切换链路：memoryView=true 渲染记忆视图而非对话/空态', async () => {
    openProject()
    useAgentStore.setState({ memoryView: true })
    const { container, root } = render(<AgentConversation />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(container.textContent).toContain('book-state.md')
    expect(container.textContent).toContain('记忆')
    act(() => { root.unmount() })
  })
})
