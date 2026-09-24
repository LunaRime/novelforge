// @vitest-environment jsdom
/**
 * MemoryGroup — 侧栏「AI 记忆」导航行为（真机反馈 2026-09-19 改造）
 *
 * 真机反馈：「每个小说章节 AI 记忆为什么就在侧边栏直接打开，为什么不在编辑栏打开？
 * 侧边栏那么小的位置」。
 *
 * 旧行为：行点击 setOpen(true) + memory:read → 在侧栏内联展开 max-h-40 / 0.65rem 的
 * <pre>（编辑态是同样窄小的 textarea），编辑器侧没有任何入口。
 * 新契约：侧栏只做导航（列表 + kind 徽标 + stale 徽标 + 重建 + 删除 + 刷新），
 * 行点击把记忆文件作为编辑器标签页打开（type='memory'，filePath='vela://memory/<file>'），
 * 内容在编辑区全宽渲染；AI 面板复用同一个 MemoryList，行为一致。
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import MemoryGroup, { MemoryList } from './MemoryGroup'
import { useEditorStore } from '../../../stores/editor-store'
import { useMemoryStore } from '../../../stores/memory-store'
import { t } from '../../../shared/locale'
import type { MemoryFileMeta } from '../../../services/memory/memory-codec'

const FILES: MemoryFileMeta[] = [
  { file: 'chapters-1-3.md', kind: 'chapters', range: '1-3', stale: true, mtime: 3 },
  { file: 'book-state.md', kind: 'book', stale: false, mtime: 1 },
]

/** 章节记忆文件正文（含章节块，符合 isValidMemoryContent） */
const CHAPTERS_BODY = '---\nrange: 1-3\n---\n\n# 章节记忆 1-3\n\n## 第 1 章 · 开端\n- 关键事件：主角醒来\n'

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

/**
 * 取文件行的可点击层。
 * 2026-09-25 行重构：行点击从 `<div onClick>`（键盘完全够不到）移到内层主 `<button>`，
 * 重建/删除按钮降为兄弟节点 —— 故此处取「文本含文件名的按钮」即行主按钮
 * （重建/删除是纯图标按钮，textContent 不含文件名）。
 */
function rowOf(container: HTMLElement, file: string): HTMLElement {
  const btns = [...container.querySelectorAll('button')].filter(b => b.textContent?.includes(file))
  return btns[btns.length - 1] as HTMLElement
}

function buttonsByTitle(container: HTMLElement, title: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter(b => b.title === title) as HTMLButtonElement[]
}

describe('MemoryGroup — 侧栏记忆导航（点击开编辑器标签页）', () => {
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.body.innerHTML = ''
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useMemoryStore.setState({ files: [], loading: false })
    invoke = vi.fn(async (ch: string) => {
      if (ch === 'memory:list') return FILES
      if (ch === 'memory:read') return CHAPTERS_BODY
      if (ch === 'memory:write' || ch === 'memory:delete' || ch === 'memory:mark-stale') return { success: true }
      return null
    })
    Object.defineProperty(window, 'velaAPI', {
      value: { invoke, on: () => () => {}, once: () => {}, send: () => {}, setZoomLevel: () => {}, setZoomFactor: () => {}, getZoomLevel: () => 0 },
      configurable: true,
    })
  })

  it('行点击 → 以 vela://memory/<file> 打开编辑器标签页（type=memory，内容来自 memory:read）', async () => {
    const { container, root } = render(<MemoryGroup projectPath="/mock/proj" />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(container.textContent).toContain('chapters-1-3.md')

    act(() => { rowOf(container, 'chapters-1-3.md').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    const st = useEditorStore.getState()
    expect(st.tabs).toHaveLength(1)
    expect(st.tabs[0]).toMatchObject({
      id: 'vela://memory/chapters-1-3.md',
      name: 'chapters-1-3.md',
      type: 'memory',
      filePath: 'vela://memory/chapters-1-3.md',
    })
    expect(st.tabs[0].content).toBe(CHAPTERS_BODY)
    expect(st.activeTabId).toBe('vela://memory/chapters-1-3.md')
    expect(invoke).toHaveBeenCalledWith('memory:read', 'chapters-1-3.md')
    act(() => { root.unmount() })
  })

  it('行键盘可达：主按钮是 <button>，操作按钮降为兄弟，且无 button 嵌套 button（2026-09-25 重构契约）', async () => {
    const { container, root } = render(<MemoryGroup projectPath="/mock/proj" />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    // 1) 行主按钮可由 querySelectorAll('button') 找到，且可聚焦（键盘 Tab/Enter 可达）
    const main = rowOf(container, 'chapters-1-3.md') as HTMLButtonElement
    expect(main.tagName).toBe('BUTTON')
    expect(main.disabled).toBe(false)
    main.focus()
    expect(document.activeElement).toBe(main)

    // 2) 硬约束：不允许 button 嵌 button（非法 HTML + 焦点被外层吞掉）
    expect(container.querySelectorAll('button button')).toHaveLength(0)

    // 3) 重建/删除降为兄弟节点：行容器内共 3 个按钮，且它们不在主按钮内
    const rowBox = main.parentElement as HTMLElement
    const rowButtons = [...rowBox.querySelectorAll('button')]
    expect(rowButtons).toHaveLength(3)
    expect(main.contains(rowButtons[1])).toBe(false)
    expect(main.contains(rowButtons[2])).toBe(false)

    // 4) 行容器本身不再有点击处理器：点击外层 div 不打开标签页
    act(() => { rowBox.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(useEditorStore.getState().tabs).toHaveLength(0)

    // 5) 点击主按钮触发原回调（打开编辑器标签页）
    act(() => { main.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    const st = useEditorStore.getState()
    expect(st.tabs).toHaveLength(1)
    expect(st.tabs[0]).toMatchObject({ type: 'memory', filePath: 'vela://memory/chapters-1-3.md' })
    act(() => { root.unmount() })
  })

  it('侧栏不再行内展开：点击后内容不渲染在侧栏（无 pre / textarea / 正文）', async () => {
    const { container, root } = render(<MemoryGroup projectPath="/mock/proj" />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    act(() => { rowOf(container, 'chapters-1-3.md').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    expect(container.querySelector('pre')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).not.toContain('主角醒来')
    act(() => { root.unmount() })
  })

  it('侧栏保留导航要素：kind 徽标 + stale 徽标 + 重建按钮 + 删除按钮 + 刷新', async () => {
    const { container, root } = render(<MemoryGroup projectPath="/mock/proj" />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    // kind 徽标（章节 / 全书）+ stale 徽标
    expect(container.textContent).toContain(t('memory.kindChapters'))
    expect(container.textContent).toContain(t('memory.kindBook'))
    expect(container.textContent).toContain(t('memory.stale'))
    // 每行一个重建 + 一个删除，头部一个刷新
    expect(buttonsByTitle(container, t('memory.rebuild'))).toHaveLength(FILES.length)
    expect(buttonsByTitle(container, t('action.delete'))).toHaveLength(FILES.length)
    expect(buttonsByTitle(container, t('action.refresh'))).toHaveLength(1)
    act(() => { root.unmount() })
  })

  it('重建按钮（章节文件）→ memory:mark-stale + 列表刷新，且不打开标签页', async () => {
    const { container, root } = render(<MemoryGroup projectPath="/mock/proj" />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    const listCallsBefore = invoke.mock.calls.filter(c => c[0] === 'memory:list').length

    const rebuild = buttonsByTitle(container, t('memory.rebuild')).find(b =>
      b.closest('div')?.textContent?.includes('chapters-1-3.md'))!
    act(() => { rebuild.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    expect(invoke).toHaveBeenCalledWith('memory:mark-stale', 'chapters-1-3.md')
    // 重建后刷新 stale 徽标（列表重载）
    expect(invoke.mock.calls.filter(c => c[0] === 'memory:list').length).toBeGreaterThan(listCallsBefore)
    expect(useEditorStore.getState().tabs).toHaveLength(0)
    act(() => { root.unmount() })
  })

  it('删除按钮 → confirm 二次确认后 memory:delete + 列表刷新', async () => {
    const { container, root } = render(<MemoryGroup projectPath="/mock/proj" />)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    const del = buttonsByTitle(container, t('action.delete')).find(b =>
      b.closest('div')?.textContent?.includes('book-state.md'))!
    act(() => { del.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    // 确认弹窗渲染到 body（非 container）
    const confirmBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent === t('dialog.confirm'))!
    expect(confirmBtn).toBeTruthy()
    act(() => { confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 300)) })

    expect(invoke).toHaveBeenCalledWith('memory:delete', 'book-state.md')
    act(() => { root.unmount() })
  })

  it('MemoryList（AI 面板复用入口）：点击同样打开编辑器标签页，无行内编辑入口', async () => {
    const { container, root } = render(
      <MemoryList files={FILES} onRebuild={() => {}} onSaved={async () => {}} />
    )
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    act(() => { rowOf(container, 'book-state.md').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    const st = useEditorStore.getState()
    expect(st.tabs).toHaveLength(1)
    expect(st.tabs[0]).toMatchObject({
      id: 'vela://memory/book-state.md',
      type: 'memory',
      filePath: 'vela://memory/book-state.md',
    })
    // 编辑器成为唯一编辑面：列表内不再有行内查看/编辑控件
    expect(container.querySelector('pre')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).not.toContain(t('action.edit'))
    act(() => { root.unmount() })
  })
})
