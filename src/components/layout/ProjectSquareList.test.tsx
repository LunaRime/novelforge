// @vitest-environment jsdom
/**
 * ProjectSquareList — LT 项目方块列表测试
 *
 * 验证：
 * - 方块渲染（截断名 + 首字/首字母）
 * - 最多 5 个限制
 * - 点击方块 → openProject + 进工作台视图
 * - 悬停提示含全名/路径
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ProjectSquareList from './ProjectSquareList'
import { useProjectStore } from '../../stores/project-store'
import { useLayoutStore } from '../../stores/layout-store'

function render(ui: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

const makeProject = (name: string, path: string) => ({ name, path, updatedAt: Date.now() })

describe('ProjectSquareList LT 方块列表', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    useLayoutStore.setState({ sidebarOpen: true, sidebarView: 'home' })
    useProjectStore.setState({
      currentProject: null,
      recentProjects: [
        makeProject('斗罗大陆虚界之痕', 'E:\\vale\\小说\\斗罗大陆虚界之痕'),
        makeProject('穿越斗罗之我即天命', 'E:\\vale\\小说\\穿越斗罗之我即天命'),
      ],
      // mock openProject（避免真实 IPC 链路）
      openProject: vi.fn(async () => true) as never,
    })
  })

  it('渲染方块（显示首字/首字母 + 悬停全名）', () => {
    const { container } = render(<ProjectSquareList />)
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons.length).toBe(2)
    // 首字（中文取首字）
    expect(buttons[0].textContent).toContain('斗')
    expect(buttons[1].textContent).toContain('穿')
    // 悬停提示含全名 + 路径
    expect(buttons[0].getAttribute('title')).toContain('斗罗大陆虚界之痕')
    expect(buttons[0].getAttribute('title')).toContain('E:\\vale\\小说\\斗罗大陆虚界之痕')
  })

  it('超过 5 个项目时只显示 5 个', () => {
    useProjectStore.setState({
      recentProjects: Array.from({ length: 7 }, (_, i) => makeProject(`项目${i + 1}`, `E:\\p${i + 1}`)),
    })
    const { container } = render(<ProjectSquareList />)
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons.length).toBe(5)
  })

  it('当前项目被过滤（方块列表不含已打开项目）', () => {
    useProjectStore.setState({
      currentProject: { name: '斗罗大陆虚界之痕', path: 'E:\\vale\\小说\\斗罗大陆虚界之痕' } as never,
    })
    const { container } = render(<ProjectSquareList />)
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons.length).toBe(1)
    expect(buttons[0].textContent).toContain('穿')
  })

  it('点击方块 → 调用 openProject 并切换到工作台视图', async () => {
    const { container } = render(<ProjectSquareList />)
    const openProjectMock = useProjectStore.getState().openProject as ReturnType<typeof vi.fn>
    const buttons = Array.from(container.querySelectorAll('button'))
    await act(async () => { buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await Promise.resolve() })
    // openProject 被调用（keepView 模式）
    expect(openProjectMock).toHaveBeenCalledWith('E:\\vale\\小说\\斗罗大陆虚界之痕', { keepView: true })
    // 进入工作台视图
    expect(useLayoutStore.getState().sidebarView).toBe('workspace')
  })
})
