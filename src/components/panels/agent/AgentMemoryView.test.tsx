// @vitest-environment jsdom
/**
 * AgentMemoryView — AI 面板记忆入口（CCR P3 Task 3）
 *
 * 验证：
 * 1. 评审项 7：无项目打开空态（显示「打开项目后可查看记忆」而非报错/空白）
 * 2. 文件列表渲染 + 行点击把记忆文件开到**编辑器标签页**（真机反馈 2026-09-19 改造：
 *    面板内不再行内展开内容，编辑器是唯一查看/编辑面）
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
import { useEditorStore } from '../../../stores/editor-store'
import { t } from '../../../shared/locale'

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
              { file: 'book-state.md', kind: 'book', loadMode: 'resident', brief: '主角是苏晚晴', stale: false, mtime: 1 },
              { file: 'shared.md', kind: 'shared', loadMode: 'auto', brief: '用户偏好爽文节奏', stale: true, mtime: 2 },
            ]
          }
          if (ch === 'memory:read') return MEMORY_CONTENT
          return null
        }),
      },
      configurable: true,
    })
    useProjectStore.setState({ currentProject: null })
    useEditorStore.setState({ tabs: [], activeTabId: null })
    resetView()
  })

  it('无项目打开：显示「打开项目后可查看记忆」空态（评审项 7，不报错）', async () => {
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) }) // memory:list 竞态落地
    expect(container.textContent).toContain('打开项目后可查看记忆')
    expect(container.textContent).not.toContain('book-state.md')
    act(() => { root.unmount() })
  })

  it('有项目：文件列表渲染，行点击把记忆文件开到编辑器标签页（面板内不渲染内容，无编辑按钮）', async () => {
    openProject()
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    // 列表（book + shared 两行）与 kind 徽标
    expect(container.textContent).toContain('book-state.md')
    expect(container.textContent).toContain('shared.md')
    expect(container.textContent).toContain('待重建') // shared stale 徽标

    // 行点击 → memory:read（取行主按钮 = 可点击层）
    // 2026-09-25 行重构：行点击从 `<div onClick>` 移到内层主 `<button>`（键盘可达），
    // 故此处改取「文本含文件名的按钮」（重建/删除是纯图标按钮，textContent 不含文件名）
    const rowButtons = [...container.querySelectorAll('button')].filter(b => b.textContent?.includes('book-state.md'))
    const row = rowButtons[rowButtons.length - 1]!
    act(() => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    const invoke = (window.velaAPI.invoke as ReturnType<typeof vi.fn>)
    expect(invoke).toHaveBeenCalledWith('memory:read', 'book-state.md')
    // 内容在编辑器标签页打开（AI 面板不再行内展开）
    const st = useEditorStore.getState()
    expect(st.tabs).toHaveLength(1)
    expect(st.tabs[0]).toMatchObject({
      id: 'vela://memory/book-state.md',
      name: 'book-state.md',
      type: 'memory',
      filePath: 'vela://memory/book-state.md',
    })
    expect(st.tabs[0].content).toBe(MEMORY_CONTENT)
    expect(st.activeTabId).toBe('vela://memory/book-state.md')
    // 面板内不再渲染记忆正文（无行内查看器）
    expect(container.querySelector('pre')).toBeNull()
    expect(container.textContent).not.toContain('记忆内容测试')
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

  it('AgentHeader「记忆」入口（更多选项菜单内）：点击切换 memoryView', async () => {
    const { container, root } = render(<AgentHeader />)
    // 2026-09-22 UI 重做：记忆与历史从标题栏独立图标收进「更多选项」菜单
    // （264px 窄面板里五个图标过于拥挤）
    const moreBtn = [...container.querySelectorAll('button')].find(b => b.title === '更多选项')!
    expect(moreBtn).toBeTruthy()
    act(() => { moreBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 菜单里的「记忆」项（MenuItem 渲染为 button）
    const item = [...container.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '记忆')!
    expect(item).toBeTruthy()
    act(() => { item.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(useAgentStore.getState().memoryView).toBe(true)
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

describe('AgentMemoryView 加载方式选择器 + 常驻总量（C 档第一轮）', () => {
  let invoke: ReturnType<typeof vi.fn>
  const FILES = [
    { file: 'book-state.md', kind: 'book', loadMode: 'resident', brief: '主角是苏晚晴', stale: false, mtime: 1 },
    { file: 'shared.md', kind: 'shared', loadMode: 'auto', brief: '用户偏好爽文节奏', stale: false, mtime: 2 },
  ]

  beforeEach(() => {
    document.body.innerHTML = ''
    useEditorStore.setState({ tabs: [], activeTabId: null })
    invoke = vi.fn(async (ch: string) => {
      if (ch === 'memory:list') return FILES
      if (ch === 'memory:read') return '---\nload_mode: resident\n---\n\n# 全书精要\n主角是苏晚晴'
      if (ch === 'memory:write') return { success: true }
      return null
    })
    Object.defineProperty(window, 'velaAPI', { value: { invoke }, configurable: true })
    openProject()
  })

  it('每行三态选择器 + 三档语义 title（选型解释面）', async () => {
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(container.textContent).toContain('book-state.md')
    for (const label of [t('memory.loadModeResident'), t('memory.loadModeAuto'), t('memory.loadModeManual')]) {
      expect(container.textContent).toContain(label)
    }
    const btns = [...container.querySelectorAll('button')] as HTMLButtonElement[]
    expect(btns.filter(b => b.title === t('memory.loadModeAutoHint')).length).toBe(FILES.length)
    act(() => { root.unmount() })
  })

  it('点「手动」→ 读-改-写 load_mode: manual，并刷新列表', async () => {
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const manualBtn = [...container.querySelectorAll('button')].find(b => b.textContent === t('memory.loadModeManual')) as HTMLButtonElement
    act(() => { manualBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    // ⚠️ mock 声明的形参只有 (ch)，元组类型长度 1 —— 直接索引 [1]/[2] 会触发 TS2493；
    // 转成 unknown[] 再取（本项目既有踩坑：mock 泛型须显式声明参数类型）
    const write = invoke.mock.calls.find(c => c[0] === 'memory:write') as unknown[] | undefined
    expect(write?.[1]).toBe('book-state.md')          // 第一行是 book-state
    expect(String(write?.[2])).toContain('load_mode: manual')
    act(() => { root.unmount() })
  })

  it('常驻总量指示：与注入同源（常驻 N / 4000 tokens）', async () => {
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(container.textContent).toMatch(/常驻记忆 \d+ \/ 4000 tokens/)
    act(() => { root.unmount() })
  })

  it('编辑器里有该文件未保存修改 → 不写盘（守卫，防静默覆盖用户编辑）', async () => {
    useEditorStore.setState({
      tabs: [{ id: 'vela://memory/book-state.md', name: 'book-state.md', type: 'memory', filePath: 'vela://memory/book-state.md', content: '改了一半', dirty: true }],
    })
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const manualBtn = [...container.querySelectorAll('button')].find(b => b.textContent === t('memory.loadModeManual')) as HTMLButtonElement
    act(() => { manualBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(invoke.mock.calls.some(c => c[0] === 'memory:write')).toBe(false)
    expect(useEditorStore.getState().tabs[0].content).toBe('改了一半')  // 编辑缓冲不动
    act(() => { root.unmount() })
  })

  it('编辑器里开着已保存的该文件 → 同样不写盘（评审 I2：两处写入互相覆盖）', async () => {
    useEditorStore.setState({
      tabs: [{ id: 'vela://memory/book-state.md', name: 'book-state.md', type: 'memory', filePath: 'vela://memory/book-state.md', content: '磁盘内容', dirty: false }],
    })
    const { container, root } = render(<AgentMemoryView />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const manualBtn = [...container.querySelectorAll('button')].find(b => b.textContent === t('memory.loadModeManual')) as HTMLButtonElement
    act(() => { manualBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(invoke.mock.calls.some(c => c[0] === 'memory:write')).toBe(false)
    // 不被写、不被标脏（同步编辑器缓冲会经 CodeMirror 回显置 dirty）
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false)
    expect(useEditorStore.getState().tabs[0].content).toBe('磁盘内容')
    act(() => { root.unmount() })
  })
})
