// @vitest-environment jsdom
/**
 * CodeMirrorEditor — 外部 content 同步与撤销历史测试（C3 根因验证与修复回归）
 *
 * 背景链路：DraftEditor/ArchFileViewer onChange → updateTabContent → store →
 * content prop → CodeMirrorEditor useEffect。
 *
 * 根因（已代码级确认）：ReactCodeMirror 的受控 value 同步
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
 * 前提：@codemirror/state 已通过 pnpm.overrides 统一到 6.7.1（此前根依赖
 * 6.6.0 与 @codemirror/commands@6.10.4 嵌套 6.7.1 双实例并存，history
 * StateField 被 6.6.0 的 flatten 静默丢弃 → undo 完全失效），本用例依赖
 * 单实例环境下历史管线恢复可用。
 *
 * 注：jsdom 中 cm6 keymap 的 keydown 不会触发（keyboard 事件经由
 * KeyboardEvent 构造派发不进入 cm6 的按键处理），故 Ctrl+Z 用
 * historyKeymap 绑定的同一个 undo 命令直接调用（同一模块实例、语义等价）。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EditorView } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { undo } from '@codemirror/commands'
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

/** 模拟用户一次输入（与键入等价的事务；time 参数强制拉开间隔，防 history 新组 500ms 分组干扰） */
function userInput(view: EditorView, text: string, time: number): void {
  act(() => {
    view.dispatch({
      changes: { from: view.state.doc.length, insert: text },
      annotations: [Transaction.time.of(time)],
    })
  })
}

afterEach(() => {
  roots.forEach(r => act(() => r.unmount()))
  roots.length = 0
  document.body.innerHTML = ''
})

describe('CodeMirrorEditor 撤销行为（外部同步不进 undo 栈）', () => {
  it('外部 content 同步（切文件/AI 刷新）不应让撤销回到旧内容', () => {
    const onChange = vi.fn()
    const { container, rerender } = renderEditor('旧内容', onChange)
    const view = getView(container)
    expect(view.state.doc.toString()).toBe('旧内容')

    // 用户输入 "编辑一"
    userInput(view, '编辑一', 1000)
    expect(view.state.doc.toString()).toBe('旧内容编辑一')
    expect(onChange).toHaveBeenLastCalledWith('旧内容编辑一')

    // 外部内容同步（updateTabContent 链路 / 切换文件）：content prop 变为不同文本，
    // 修复后走 view.dispatch(addToHistory:false)——整文替换不进 undo 栈
    act(() => { rerender('外部同步内容N') })
    expect(view.state.doc.toString()).toBe('外部同步内容N')

    // Ctrl+Z：撤销的应是用户自身编辑前的状态；若 undo 无效果（外部同步未进栈），
    // 文档保持外部内容——不应跳回 "旧内容编辑一"（修复前会跳回旧内容）
    act(() => { undo(view) })
    expect(view.state.doc.toString()).toBe('外部同步内容N')
  })

  it('编辑 → 外部回写相同内容 → 编辑 → undo 只撤销最后一次编辑', () => {
    const onChange = vi.fn()
    const { container, rerender } = renderEditor('旧内容', onChange)
    const view = getView(container)

    // 用户输入 "编辑一" → "编辑二"
    userInput(view, '编辑一', 1000)
    userInput(view, '编辑二', 2000)
    expect(view.state.doc.toString()).toBe('旧内容编辑一编辑二')
    expect(onChange).toHaveBeenCalledTimes(2)

    // 外部回写相同内容（模拟 onChange → store → content prop 回路）：
    // content 与 lastEmittedContentRef 相等 → 不再 dispatch → onChange 不再触发
    act(() => { rerender('旧内容编辑一编辑二') })
    expect(view.state.doc.toString()).toBe('旧内容编辑一编辑二')
    expect(onChange).toHaveBeenCalledTimes(2)

    // Ctrl+Z：只撤销 "编辑二"，外部回写不产生可撤销事件
    act(() => { undo(view) })
    expect(view.state.doc.toString()).toBe('旧内容编辑一')

    // 再按一次：撤销 "编辑一"
    act(() => { undo(view) })
    expect(view.state.doc.toString()).toBe('旧内容')
  })

  it('多次外部同步不累积 undo 事件（后续同步仍只撤销用户编辑）', () => {
    const { container, rerender } = renderEditor('旧内容')
    const view = getView(container)

    userInput(view, '编辑一', 1000)

    act(() => { rerender('外部A') })
    expect(view.state.doc.toString()).toBe('外部A')
    act(() => { rerender('外部B') })
    expect(view.state.doc.toString()).toBe('外部B')

    // 两次外部同步后，Ctrl+Z 不应跳回旧内容（无整文替换可撤销）
    act(() => { undo(view) })
    expect(view.state.doc.toString()).toBe('外部B')
    act(() => { undo(view) })
    expect(view.state.doc.toString()).toBe('外部B')
  })
})

// ===== Task 3: 加粗（prose 模式 markdown 渲染）=====

/**
 * 加粗按钮位于 Bubble Menu 中，而 Bubble Menu 的坐标计算依赖
 * coordsAtPos / DOM Range 几何——jsdom 无布局引擎，文本坐标测量失败
 * （coordsAtPos 返回 null 会导致程序主动关闭气泡）。因此对 coordsAtPos
 * 打桩返回固定坐标，使 Bubble Menu 在 jsdom 中也能完成定位并渲染。
 * 选区经由 view.dispatch 直接设置（编辑器未聚焦时 CM 不写 DOM 选区，
 * 窗口选区为空 → 气泡定位走 coordsAtPos 分支，打桩生效）。
 */
function renderWithMode(
  mode: 'document' | 'prose',
  content: string,
  onChange?: (c: string) => void,
): HTMLElement {
  const container = document.createElement('div')
  container.style.width = '800px'
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<CodeMirrorEditor mode={mode} content={content} onChange={onChange} />)
  })
  return container
}

/** 加粗按钮无 title/aria-label（与其他工具栏按钮一致），以 lucide Bold 图标类定位 */
function findBoldButton(container: HTMLElement): HTMLButtonElement | null {
  const btn = Array.from(container.querySelectorAll('button'))
    .find(b => b.querySelector('svg.lucide-bold'))
  return (btn as HTMLButtonElement | undefined) ?? null
}

/** Bubble Menu 定位在 requestAnimationFrame 中执行；等待一帧让 setBubblePos 生效 */
async function flushBubbleFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => { requestAnimationFrame(() => resolve()) })
  })
}

describe('CodeMirrorEditor 加粗（prose 模式）', () => {
  let coordsSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    coordsSpy = vi.spyOn(EditorView.prototype, 'coordsAtPos')
      .mockReturnValue({ left: 10, top: 10, right: 30, bottom: 24 })
  })

  afterEach(() => {
    coordsSpy.mockRestore()
  })

  it('prose 模式：选中文本后点击加粗按钮，文本被 ** 包裹', async () => {
    const onChange = vi.fn()
    const container = renderWithMode('prose', '力王虎父子冲', onChange)
    const view = getView(container)

    // 选中全文 → handleUpdate.selectionSet → Bubble Menu 打开并渲染加粗按钮
    act(() => { view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }) })
    await flushBubbleFrame()

    const boldBtn = findBoldButton(container)
    expect(boldBtn).toBeTruthy()

    act(() => { boldBtn?.click() })
    expect(view.state.doc.toString()).toBe('**力王虎父子冲**')
    expect(onChange).toHaveBeenCalledWith('**力王虎父子冲**')
  })

  it('prose 模式启用 markdown 高亮：**文本** 解析为粗体语法节点（StrongEmphasis）', async () => {
    const onChange = vi.fn()
    const container = renderWithMode('prose', '**力王虎**父子冲', onChange)
    const view = getView(container)
    // lang-markdown 语法解析为异步分片执行；小文档等待片刻后同步强制补全
    await act(async () => { await new Promise<void>(r => setTimeout(() => r(), 100)) })
    const tree = ensureSyntaxTree(view.state, view.state.doc.length, 1000)
    expect(tree).toBeTruthy()
    // StrongEmphasis 位于 Document > Paragraph 内，覆盖 **力王虎**（内容为中间文本）
    const strong = tree?.topNode.getChild('Paragraph')?.getChild('StrongEmphasis')
    expect(strong).toBeTruthy()
    expect(view.state.sliceDoc(strong?.from ?? 0, strong?.to ?? 0)).toBe('**力王虎**')
  })

  it('prose 与 document 模式均渲染加粗按钮（document 行为不回归）', async () => {
    const onChange = vi.fn()

    const prose = renderWithMode('prose', '内容甲', onChange)
    const proseView = getView(prose)
    act(() => { proseView.dispatch({ selection: { anchor: 0, head: proseView.state.doc.length } }) })
    await flushBubbleFrame()
    expect(findBoldButton(prose)).toBeTruthy()

    const doc = renderWithMode('document', '内容乙', onChange)
    const docView = getView(doc)
    act(() => { docView.dispatch({ selection: { anchor: 0, head: docView.state.doc.length } }) })
    await flushBubbleFrame()
    expect(findBoldButton(doc)).toBeTruthy()
  })
})
