// @vitest-environment jsdom
/**
 * CodeMirrorEditor — 外部 content 同步测试（C3 根因验证与修复的回归覆盖）
 *
 * 背景链路：DraftEditor/ArchFileViewer onChange → updateTabContent → store →
 * content prop → CodeMirrorEditor useEffect。
 *
 * 根因（已在代码级确认）：ReactCodeMirror 的受控 value 同步
 * （node_modules/@uiw/react-codemirror/esm/useCodeMirror.js 的 value effect）
 * dispatch 整文替换时只带 ExternalChange 注解（防 onChange 回显），
 * 未带 addToHistory:false——该事务默认进入 undo 历史栈（@codemirror/commands
 * 的 historyField.update 仅跳过 annotation(Transaction.addToHistory) === false
 * 的事务）。因此切文件 / AI 刷新后 Ctrl+Z 会先撤销「整文替换」而非用户自身编辑。
 *
 * 修复：外部同步改为 view.dispatch({ changes, addToHistory: false })——
 * 整文替换不进 undo 栈，且 editorContent state 不变 → ReactCodeMirror 的
 * value prop 不变 → 不会再触发其带历史的同步 dispatch。
 *
 * 本测试覆盖 jsdom 可确定性验证的同步契约：
 * 1) 外部 content 变化应用到编辑器（view 存在走手动 dispatch 路径）
 * 2) 外部回写相同内容不重复 dispatch（lastEmittedContentRef 回路防护）
 * 3) 多次外部同步内容正确叠加
 *
 * 说明：jsdom 中未能验证 Ctrl+Z 撤销行为本身——本项目存在
 * @codemirror/state 双实例（根 6.6.0 vs @codemirror/commands@6.10.4
 * 嵌套 6.7.1）：6.6.0 的 flatten 以 instanceof 识别扩展，6.7.1 的
 * history StateField 被静默丢弃 → undo/undoDepth 完全失效（任何事务都
 * 不进历史），且 cm6 的 keydown 在 jsdom 中不触发 keymap，故撤销断言
 * 无法在此环境可靠执行。撤销行为按 brief 的手动验证清单确认
 * （见 task-1-report.md 结论）。
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EditorView } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import CodeMirrorEditor from './CodeMirrorEditor'

// jsdom 未实现 scrollTo / ResizeObserver（与 AgentConversation.test 相同防护）
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn() as never
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // jsdom 未实现 Range 几何接口（CodeMirror 文本坐标测量依赖）
  const proto = Range.prototype as unknown as Record<string, unknown>
  if (!proto.getClientRects) {
    proto.getClientRects = () => []
  }
  if (!proto.getBoundingClientRect) {
    proto.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) })
  }
})

const roots: Root[] = []

function renderEditor(
  content: string,
  onChange?: (content: string) => void,
): { container: HTMLElement; rerender: (content: string) => void } {
  const container = document.createElement('div')
  container.style.width = '800px'
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<CodeMirrorEditor content={content} onChange={onChange} />) })
  return {
    container,
    rerender: (next: string) => act(() => {
      root.render(<CodeMirrorEditor content={next} onChange={onChange} />)
    }),
  }
}

function getView(container: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(container)
  expect(view).toBeTruthy()
  return view as unknown as EditorView
}

afterEach(() => {
  roots.forEach(r => act(() => r.unmount()))
  roots.length = 0
  document.body.innerHTML = ''
})

describe('CodeMirrorEditor 外部 content 同步', () => {
  it('外部 content 同步（切文件/AI 刷新）应用到编辑器内容', () => {
    const onChange = vi.fn()
    const { container, rerender } = renderEditor('旧内容', onChange)
    const view = getView(container)
    expect(view.state.doc.toString()).toBe('旧内容')

    // 用户输入（与键入等价的事务）
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: '编辑一' },
        annotations: [Transaction.time.of(1000)],
      })
    })
    expect(view.state.doc.toString()).toBe('旧内容编辑一')
    expect(onChange).toHaveBeenLastCalledWith('旧内容编辑一')

    // 外部内容同步（updateTabContent 链路 / 切换文件）：content prop 变为不同文本
    // 修复后走 view.dispatch（addToHistory:false），内容必须正确应用
    act(() => { rerender('外部同步内容N') })
    expect(view.state.doc.toString()).toBe('外部同步内容N')
  })

  it('外部回写相同内容不重复 dispatch（lastEmittedContentRef 回路防护）', () => {
    const onChange = vi.fn()
    const { container, rerender } = renderEditor('旧内容', onChange)
    const view = getView(container)

    // 用户输入 "编辑一" → "编辑二"
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: '编辑一' },
        annotations: [Transaction.time.of(1000)],
      })
    })
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: '编辑二' },
        annotations: [Transaction.time.of(2000)],
      })
    })
    expect(view.state.doc.toString()).toBe('旧内容编辑一编辑二')
    expect(onChange).toHaveBeenCalledTimes(2)

    // 外部回写相同内容（模拟 onChange → store → content prop 回路）：
    // content 与 lastEmittedContentRef 相等 → 不再 dispatch → onChange 不再触发
    act(() => { rerender('旧内容编辑一编辑二') })
    expect(view.state.doc.toString()).toBe('旧内容编辑一编辑二')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('多次外部同步内容正确叠加（每次同步都反映最新外部内容）', () => {
    const { container, rerender } = renderEditor('旧内容')
    const view = getView(container)

    act(() => { rerender('外部A') })
    expect(view.state.doc.toString()).toBe('外部A')
    act(() => { rerender('外部B') })
    expect(view.state.doc.toString()).toBe('外部B')
  })
})
