// @vitest-environment jsdom
/**
 * EditorArea — vela://memory/ 记忆标签页（真机反馈 2026-09-19：记忆改在编辑器打开）
 *
 * 契约：
 * 1. type='memory' 的 Tab 在编辑区渲染（全宽、正常字号、可搜索/可关闭），
 *    Tab 图标走记忆分支（Brain），Tab 名 = 记忆文件名
 * 2. 保存分支：vela://memory/ → memory:write(file, 内容)，写前跑与侧栏完全一致的
 *    结构校验（isValidMemoryContent）——坏结构**拒绝落盘**（toast 可见），
 *    因为定稿 DAG 会读这个文件，坏格式会静默产生空洞记忆
 * 3. 保存成功：stripStatusFrontmatter 去 status（编辑后不再 stale）→ 刷新记忆列表
 *    → 清 dirty；日志走 Save:Memory / log:write（LogsView 可观测）
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import EditorArea from './EditorArea'
import { VELA } from '../../services/vela-protocol'
import { stripStatusFrontmatter } from '../../services/memory/memory-codec'
import { useEditorStore } from '../../stores/editor-store'
import { useMemoryStore } from '../../stores/memory-store'
import { useProjectStore } from '../../stores/project-store'
import { useLayoutStore } from '../../stores/layout-store'
import { t } from '../../shared/locale'

const FILE = 'chapters-1-3.md'
const TAB_ID = `${VELA.MEMORY}${FILE}`

/** 合法内容 + status: stale（手动编辑后应不再视为 stale） */
const VALID_STALE = '---\nrange: 1-3\nstatus: stale\n---\n\n## 第 1 章 · 开端\n- 关键事件：主角醒来\n'
/** 非法内容：无章节块 + frontmatter 不完整（下游块解析会静默丢内容） */
const INVALID = '# 随手写的笔记\n没有章节块，也没有 frontmatter\n'

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn() as never
  // jsdom 未实现 scrollIntoView（EditorArea Tab 条自动滚动依赖）
  Element.prototype.scrollIntoView = vi.fn() as never
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const proto = Range.prototype as unknown as Record<string, unknown>
  if (!proto.getClientRects) proto.getClientRects = () => []
  if (!proto.getBoundingClientRect) {
    proto.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) })
  }
  const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  actEnv.IS_REACT_ACT_ENVIRONMENT = true
})

function render(content: string): { container: HTMLElement; root: Root } {
  useEditorStore.setState({
    tabs: [{ id: TAB_ID, name: FILE, type: 'memory', filePath: TAB_ID, content }],
    activeTabId: TAB_ID,
  })
  const container = document.createElement('div')
  container.style.width = '800px'
  container.dataset.testRoot = '1'
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<EditorArea onNewProject={() => {}} />) })
  return { container, root }
}

/** 标记 dirty（模拟用户在编辑器里改过内容——内容与打开时一致，仅置脏标记） */
function markDirty(content: string) {
  act(() => { useEditorStore.getState().updateTabContent(TAB_ID, content) })
}

/** 点击信息栏的保存按钮（仅 dirty 时渲染） */
function clickSave(container: HTMLElement) {
  const btn = [...container.querySelectorAll('button')].find(b => b.title === t('tip.saveShortcut'))!
  expect(btn).toBeTruthy()
  act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

/** toast 走 requestAnimationFrame 入队（Toast.tsx show()）→ 等一帧再断言 */
const flushToast = async () => { await act(async () => { await new Promise(r => setTimeout(r, 50)) }) }

describe('EditorArea — 记忆文件标签页', () => {
  let invoke: ReturnType<typeof vi.fn>
  let writeCalls: unknown[][]

  beforeEach(() => {
    // 只摘测试容器：body.innerHTML='' 会把 #vela-toast-root 一起摘掉（Toast 的 _addToast
    // 仍指向已游离的旧容器）→ 后续 toast 渲染进游离节点，断言看不到
    document.querySelectorAll('[data-test-root]').forEach(el => el.remove())
    writeCalls = []
    invoke = vi.fn(async (ch: string, ...args: unknown[]) => {
      if (ch === 'memory:list') return []
      if (ch === 'memory:write') { writeCalls.push([ch, ...args]); return { success: true } }
      return null
    })
    Object.defineProperty(window, 'velaAPI', {
      value: { invoke, on: () => () => {}, once: () => {}, send: () => {}, setZoomLevel: () => {}, setZoomFactor: () => {}, getZoomLevel: () => 0 },
      configurable: true,
    })
    useMemoryStore.setState({ files: [], loading: false })
    useProjectStore.setState({ currentProject: { path: '/mock/proj' } as never })
    useLayoutStore.setState({ sidebarView: 'project' })
  })

  it('记忆 Tab 在编辑区渲染：内容可见 + Tab 名 = 文件名 + 记忆图标（不再是侧栏小窗）', async () => {
    const { container, root } = render(VALID_STALE)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })

    // 编辑区挂载了真实编辑器（全宽渲染内容，而不是侧栏 max-h-40 的 pre）
    expect(container.querySelector('.cm-editor')).toBeTruthy()
    expect(container.querySelector('.cm-content')?.textContent).toContain('第 1 章 · 开端')
    // Tab 条：文件名即显示名，图标走 memory 分支
    expect(container.textContent).toContain(FILE)
    expect(container.querySelector('.lucide-brain')).toBeTruthy()
    act(() => { root.unmount() })
  })

  it('保存非法内容：拒绝落盘（不调 memory:write）+ toast 可见 + 保持 dirty', async () => {
    const { container, root } = render(INVALID)
    markDirty(INVALID)
    clickSave(container)
    await flushToast()

    expect(writeCalls).toHaveLength(0)
    expect(document.body.textContent).toContain(t('memory.invalidFormat'))
    // 内容没落盘 → 不得清 dirty（否则用户以为已保存）
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.dirty).toBe(true)
    expect(tab.content).toBe(INVALID)
    act(() => { root.unmount() })
  })

  it('保存合法内容：memory:write(文件名, 去 status) + 刷新列表 + 清 dirty + Save:Memory 日志', async () => {
    const { container, root } = render(VALID_STALE)
    markDirty(VALID_STALE)
    clickSave(container)
    await flushToast()

    // 写入：文件名原样（不含 vela:// 前缀），内容已去掉 status（编辑后不再 stale）
    expect(writeCalls).toHaveLength(1)
    const [, file, written] = writeCalls[0] as [string, string, string]
    expect(file).toBe(FILE)
    expect(written).toBe(stripStatusFrontmatter(VALID_STALE))
    expect(written).not.toContain('status: stale')
    expect(written).toContain('## 第 1 章 · 开端')
    // 列表刷新（stale 徽标消失）
    expect(invoke.mock.calls.filter(c => c[0] === 'memory:list').length).toBeGreaterThan(0)
    // 日志（LogsView 可观测）+ 成功 toast
    const logCall = invoke.mock.calls.find(c => c[0] === 'log:write' && c[2] === 'Save:Memory')
    expect(logCall?.[1]).toBe('info')
    expect(String(logCall?.[3])).toContain(FILE)
    expect(document.body.textContent).toContain(t('save.success'))
    // 保存成功：清 dirty；编辑器文本保持用户所写（刻意不回写 tab.content——
    // 回写会触发 CodeMirror 外部内容同步并经 onChange 回显，把 Tab 再次置脏，
    // 保存成功却显示「有未保存修改」；落盘内容与列表徽标见上）
    const tab = useEditorStore.getState().tabs[0]
    expect(tab.dirty).toBe(false)
    expect(tab.content).toBe(VALID_STALE)
    act(() => { root.unmount() })
  })

  it('写入失败：toast 失败 + error 日志，且不清 dirty（未落盘不得显示已保存）', async () => {
    invoke.mockImplementation(async (ch: string, ...args: unknown[]) => {
      if (ch === 'memory:list') return []
      if (ch === 'memory:write') { writeCalls.push([ch, ...args]); return { success: false } }
      return null
    })
    const { container, root } = render(VALID_STALE)
    markDirty(VALID_STALE)
    clickSave(container)
    await flushToast()

    expect(writeCalls).toHaveLength(1)
    // 失败不得静默：可见 toast（下层写入通道返回 {success:false} 时抛错走 catch）
    const reason = String(new Error(t('status.unknown')))
    expect(document.body.textContent).toContain(t('save.failed').replace('{error}', () => reason))
    const logCall = invoke.mock.calls.find(c => c[0] === 'log:write' && c[2] === 'Save:Memory')
    expect(logCall?.[1]).toBe('error')
    expect(useEditorStore.getState().tabs[0].dirty).toBe(true)
    act(() => { root.unmount() })
  })
})
