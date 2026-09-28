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

// mock IPC（架构完整性检查：返回 archGenerated=2 → 触发未完成弹窗）
vi.mock('../../services/ipc-client', () => ({
  ipc: {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'project:get-summary') {
        return {
          name: '测试项目', path: 'E:\\test\\project', totalChapters: 3,
          chapters: [], draftChapters: [], blueprintCount: 0, archGenerated: 2,
        }
      }
      return null
    }),
  },
}))

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
    const buttons = Array.from(container.querySelectorAll('[data-project-square]'))
    expect(buttons.length).toBe(2)
    // 首字（中文取首字）
    expect(buttons[0].textContent).toContain('斗')
    expect(buttons[1].textContent).toContain('穿')
    // 悬停提示含全名 + 路径
    expect(buttons[0].getAttribute('title')).toContain('斗罗大陆虚界之痕')
    expect(buttons[0].getAttribute('title')).toContain('E:\\vale\\小说\\斗罗大陆虚界之痕')
  })

  it('超过 5 个项目时全部渲染（可见窗口 5 个，其余用滚轮循环浏览——不再截断丢弃）', () => {
    useProjectStore.setState({
      recentProjects: Array.from({ length: 7 }, (_, i) => makeProject(`项目${i + 1}`, `E:\\p${i + 1}`)),
    })
    const { container } = render(<ProjectSquareList />)
    const buttons = Array.from(container.querySelectorAll('[data-project-square]'))
    expect(buttons.length).toBe(7)
  })

  it('当前项目被过滤（方块列表不含已打开项目）', () => {
    useProjectStore.setState({
      currentProject: { name: '斗罗大陆虚界之痕', path: 'E:\\vale\\小说\\斗罗大陆虚界之痕' } as never,
    })
    const { container } = render(<ProjectSquareList />)
    const buttons = Array.from(container.querySelectorAll('[data-project-square]'))
    expect(buttons.length).toBe(1)
    expect(buttons[0].textContent).toContain('穿')
  })

  it('删除入口是**独立的** button 且不嵌在方块按钮内（回归：键盘此前完全够不到）', () => {
    const { container } = render(<ProjectSquareList />)
    const deleteButtons = Array.from(container.querySelectorAll('button[aria-label]'))

    expect(deleteButtons.length).toBe(2) // 每个项目一个
    for (const btn of deleteButtons) {
      // ① 不能是 <button> 嵌 <button>（非法 HTML，且焦点会被外层吞掉）
      expect(btn.closest('button[data-project-square]')).toBeNull()
      // ② 必须是真 button（原生支持 Enter/Space），而不是 span[role=button]
      expect(btn.tagName).toBe('BUTTON')
    }
  })

  it('点击方块 → 调用 openProject 并切换到项目结构视图', async () => {
    const { container } = render(<ProjectSquareList />)
    const openProjectMock = useProjectStore.getState().openProject as ReturnType<typeof vi.fn>
    const buttons = Array.from(container.querySelectorAll('[data-project-square]'))
    await act(async () => { buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await Promise.resolve() })
    // openProject 被调用（keepView 模式）
    expect(openProjectMock).toHaveBeenCalledWith('E:\\vale\\小说\\斗罗大陆虚界之痕', { keepView: true })
    // 进入项目结构视图（工作台已并入项目结构）
    expect(useLayoutStore.getState().sidebarView).toBe('project')
  })

  it('故事架构未完成（archGenerated < 4）→ 弹出填充提示', async () => {
    const { container } = render(<ProjectSquareList />)
    const buttons = Array.from(container.querySelectorAll('[data-project-square]'))
    await act(async () => { buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 等待 summary 检查完成（异步 IPC；Dialog 用 Portal 渲染到 body）
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const bodyText = document.body.textContent || ''
    expect(bodyText).toContain('故事架构未填充完成')
    expect(bodyText).toContain('去填充')
  })

  it('关闭架构提示弹窗 → 弹窗消失', async () => {
    const { container } = render(<ProjectSquareList />)
    const buttons = Array.from(container.querySelectorAll('[data-project-square]'))
    await act(async () => { buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    // 点击"关闭"（Portal 到 body）
    const closeBtn = Array.from(document.body.querySelectorAll('button'))
      .find(b => (b.textContent || '').trim() === '关闭')
    expect(closeBtn).toBeTruthy()
    await act(async () => { closeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const bodyText = document.body.textContent || ''
    expect(bodyText).not.toContain('故事架构未填充完成')
  })

  // ===== 滚轮循环（2026-09-28：替代原生滚动条） =====

  /** 滚动容器（[data-square-list]） */
  function scroller(container: HTMLElement): HTMLElement {
    return container.querySelector('[data-square-list]') as HTMLElement
  }

  /** 派发滚轮事件，返回事件对象（可查 defaultPrevented） */
  function wheel(el: HTMLElement, deltaY: number, deltaMode = 0): WheelEvent {
    const e = new WheelEvent('wheel', { deltaY, deltaMode, bubbles: true, cancelable: true })
    el.dispatchEvent(e)
    return e
  }

  /** 7 个最近项目（3 个滚动位置：0/1/2） */
  function seedSeven() {
    useProjectStore.setState({
      recentProjects: Array.from({ length: 7 }, (_, i) => makeProject(`项目${i + 1}`, `E:\\p${i + 1}`)),
    })
  }

  it('滚轮下滚一格 → 列表前进一个方块（循环模式，容器无原生滚动条）', () => {
    seedSeven()
    const { container } = render(<ProjectSquareList />)
    const el = scroller(container)
    expect(el.className).toContain('overflow-hidden')
    expect(el.className).not.toContain('overflow-y-auto')
    wheel(el, 100)
    expect(el.scrollTop).toBe(36) // 一个方块步长（jsdom 无布局 → 保底 36）
    wheel(el, 100)
    expect(el.scrollTop).toBe(72)
  })

  it('滚到底继续下滚 → 循环回顶部；顶部上滚 → 循环到底部', () => {
    seedSeven()
    const { container } = render(<ProjectSquareList />)
    const el = scroller(container)
    wheel(el, 100)
    wheel(el, 100) // offset → 2（末位）
    expect(el.scrollTop).toBe(72)
    wheel(el, 100) // 末位再下滚 → wrap 回顶部
    expect(el.scrollTop).toBe(0)
    wheel(el, -100) // 顶部上滚 → wrap 到末位
    expect(el.scrollTop).toBe(72)
  })

  it('触控板小步累积到阈值才走一格（不逐事件触发）', () => {
    seedSeven()
    const { container } = render(<ProjectSquareList />)
    const el = scroller(container)
    wheel(el, 20)
    wheel(el, 20)
    expect(el.scrollTop).toBe(0) // 40 < 阈值 50：未达
    wheel(el, 20)
    expect(el.scrollTop).toBe(36) // 60 ≥ 50：走一格
  })

  it('行模式滚轮（deltaMode=1）按一格处理', () => {
    seedSeven()
    const { container } = render(<ProjectSquareList />)
    const el = scroller(container)
    wheel(el, 3, 1) // 3 行 ≈ 120px ≥ 阈值
    expect(el.scrollTop).toBe(36)
  })

  it('方块不被 flex 压缩（可见窗口靠 overflow-hidden 裁剪，不挤压——2026-09-28 实测回归）', () => {
    seedSeven()
    const { container } = render(<ProjectSquareList />)
    const squares = [...container.querySelectorAll('[data-project-square]')]
    expect(squares).toHaveLength(7)
    for (const sq of squares) {
      expect(sq.parentElement?.className).toContain('flex-shrink-0')
    }
  })

  it('项目 ≤5 个（无可滚空间）→ 滚轮不移动列表', () => {
    // beforeEach 里是 2 个项目
    const { container } = render(<ProjectSquareList />)
    const el = scroller(container)
    wheel(el, 100)
    expect(el.scrollTop).toBe(0)
    // 注：不断言 defaultPrevented —— jsdom 环境存在 document 级 wheel preventDefault
    //（随 React root 卸载消失，已定位非本组件行为），该断言在此环境不可靠；
    // 本组件契约「无可滚空间时不动列表」由 scrollTop 覆盖。
  })
})
