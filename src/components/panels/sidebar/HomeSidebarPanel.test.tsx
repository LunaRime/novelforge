// @vitest-environment jsdom
/**
 * HomeSidebarPanel — 侧栏「主页」（2026-09-28 改版）
 *
 * 本次改版：欢迎页的「最近项目」迁入本视图；按钮列在「打开项目」下方新增「导入小说」入口
 * （功能 = 既有 ImportNovelDialog，经 `layout-store.openImportNovel` 触发）。
 * 契约要点：
 * - 行片形态（MenuRow）：主按钮 = 跳转（悬停置换 ›）、删除按钮作兄弟且**常驻**
 *   （不搞 hover 才显形 —— spec「操作按钮常驻」不变量）；
 * - 最近项目**过滤当前项目**（与 LT 栏 ProjectSquareList 同口径，避免与上方当前项目卡重复）；
 * - 无最近项目时整块不渲染。
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import HomeSidebarPanel from './HomeSidebarPanel'
import { useProjectStore } from '../../../stores/project-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { confirmDeleteProject } from '../../ui/Confirm'
import { t } from '../../../shared/locale'

// mock IPC（本组件经「打开项目」按钮调用 dialog:select-folder；测试不触发真实链路）
vi.mock('../../../services/ipc-client', () => ({
  ipc: { invoke: vi.fn(async () => null) },
}))

// mock 确认对话框（默认「仅移出列表」分支）
vi.mock('../../ui/Confirm', () => ({
  confirmDeleteProject: vi.fn(async () => 'remove'),
}))

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function render(ui: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

const makeProject = (name: string, path: string) => ({ name, path, updatedAt: Date.now() })

/** 最近项目行的主按钮（titleHint 含路径；纯图标按钮 title 不含路径） */
function rowButton(container: HTMLElement, path: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find(b => b.title.includes(path)) as HTMLButtonElement
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement
}

describe('HomeSidebarPanel — 侧栏主页（最近项目迁入 + 导入入口）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.mocked(confirmDeleteProject).mockResolvedValue('remove')
    useLayoutStore.setState({ importNovelOpen: false })
    useProjectStore.setState({
      currentProject: null,
      recentProjects: [
        makeProject('甲项目', '/p/a'),
        makeProject('乙项目', '/p/b'),
      ],
      // mock actions（避免真实 IPC 链路）
      openProject: vi.fn(async () => true) as never,
      deleteProjectFolder: vi.fn(async () => {}) as never,
      removeRecentProject: vi.fn(async () => {}) as never,
    })
  })

  it('渲染最近项目行：名称进正文、完整路径进悬停提示', () => {
    const { container } = render(<HomeSidebarPanel />)
    const row = rowButton(container, '/p/a')
    expect(row).toBeDefined()
    expect(row.textContent).toContain('甲项目')
    expect(row.title).toContain('甲项目')
    expect(row.title).toContain('/p/a')
  })

  it('当前项目被过滤（不与上方当前项目卡重复）', () => {
    useProjectStore.setState({
      currentProject: { name: '甲项目', path: '/p/a' } as never,
    })
    const { container } = render(<HomeSidebarPanel />)
    expect(container.querySelectorAll('button[title*="/p/"]')).toHaveLength(1)
    expect([...container.querySelectorAll('button')].some(b => b.title.includes('/p/a') && !b.title.includes('/p/b'))).toBe(false)
  })

  it('点击行 → openProject(路径)', () => {
    const { container } = render(<HomeSidebarPanel />)
    act(() => { rowButton(container, '/p/a').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(useProjectStore.getState().openProject).toHaveBeenCalledWith('/p/a')
  })

  it('删除按钮常驻（非 hover 才显形）且独立于行主按钮；点击走确认流程的「移出」分支', async () => {
    const { container } = render(<HomeSidebarPanel />)
    const delBtn = [...container.querySelectorAll('button')].find(b => b.title === t('project.deleteTooltip')) as HTMLButtonElement
    expect(delBtn).toBeDefined()
    // 常驻：不得使用 opacity-0 之类的 hover 显形门控
    expect(delBtn.className).not.toContain('opacity-0')

    act(() => { delBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    expect(vi.mocked(confirmDeleteProject)).toHaveBeenCalled()
    expect(useProjectStore.getState().removeRecentProject).toHaveBeenCalledWith('/p/a')
    // 删除点击不得误触发行的主行为（兄弟形态：外层无点击处理器）
    expect(useProjectStore.getState().openProject).not.toHaveBeenCalled()
  })

  it('「导入小说」按钮：位于「打开项目」下方，点击置位 layout-store.importNovelOpen', () => {
    const { container } = render(<HomeSidebarPanel />)
    const labels = [...container.querySelectorAll('button')].map(b => b.textContent ?? '')
    const iNew = labels.findIndex(x => x.includes(t('dialog.newProject')))
    const iOpen = labels.findIndex(x => x.includes(t('action.openProject')))
    const iImport = labels.findIndex(x => x.includes(t('welcome.importNovel')))
    expect(iNew).toBeGreaterThanOrEqual(0)
    expect(iOpen).toBeGreaterThan(iNew)
    expect(iImport).toBeGreaterThan(iOpen)

    act(() => { buttonByText(container, t('welcome.importNovel')).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(useLayoutStore.getState().importNovelOpen).toBe(true)
  })

  it('无最近项目时整块不渲染（含标题）', () => {
    useProjectStore.setState({ recentProjects: [] })
    const { container } = render(<HomeSidebarPanel />)
    expect(container.textContent).not.toContain(t('project.recent'))
  })
})
