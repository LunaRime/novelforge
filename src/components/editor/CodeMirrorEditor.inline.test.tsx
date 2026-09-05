// @vitest-environment jsdom
/**
 * CodeMirrorEditor — L1 inline 接受（Task 4）测试
 *
 * 覆盖契约（设计 §7「CM 事务」行 + §4.3/§4.4/§6 R3/R4/R6）：
 * - 事务/undo：接受 = 带显式递增 Transaction.time + INLINE_ACCEPT_EVENT 标注的独立
 *   dispatch → 连点 3 句可 3 步 Ctrl+Z 逐步还原（R4）；拒绝无 doc 事务、无 undo 事件；
 * - 装饰/浮层/浮条：pending 区段装饰、浮条进度、点击 pending 打开浮层、勾选后接受选中；
 * - 冻结（R6）：pending 区内 CM 输入（input.* userEvent）被 changeFilter 拦截；
 *   区间外手动编辑 → 自动退出会话；
 * - 默认关闭回归：无会话（无 filePath 注入）时 field 空、无浮条、无装饰、编辑不变。
 *
 * 纯 ASCII fixture：子句 token 唯一、位置算术直白（中文 fixture 的坐标手算易错）。
 * 会话经 editor-store 注入（beginInlineSession(filePath)），CodeMirrorEditor 订阅对应 tab。
 * 坐标类断言用 coordsAtPos 桩（CodeMirrorEditor.test.tsx:206-217 模式）。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import CodeMirrorEditor from './CodeMirrorEditor'
import { useEditorStore } from '../../stores/editor-store'
import type { DiffSession, SubHunk } from '../../services/diff/hunk-model'
import { ipc } from '../../services/ipc-client'
import {
  INLINE_ACCEPT_EVENT,
  dispatchAcceptChange,
  deriveRangesFromDoc,
  findPendingRangeAt,
  inlineAcceptExtensions,
  inlineAcceptField,
  setHunkRanges,
} from './codemirror-inline-accept'

// Task 5 A 收尾链白盒断言：finishSelectionSession 经 ipc-client 落 revision。
// 顶层 mock（同 CodeMirrorEditor.test 无 IPC 需求）：既有用例点击「完成」会触发
// finish 链，默认返回 []/{}/0 使清理循环空转、revision-create 静默成功。
vi.mock('../../services/ipc-client', () => {
  const fallback = async (ch: string) => {
    if (ch === 'db:revision-get-pending') return []
    if (ch === 'db:revision-next-index') return 0
    return {}
  }
  return {
    ipc: {
      invoke: vi.fn(fallback),
      on: vi.fn(() => () => {}),
      once: vi.fn(),
      send: vi.fn(),
      isElectron: true,
    },
  }
})

// jsdom 未实现 scrollTo / ResizeObserver / Range 几何（与 CodeMirrorEditor.test 相同防护）
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn() as never
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
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

const ORIG = 'AAA BBB CCC'

/** 3 个子 hunk 的单 MATCH hunk 会话（h0.s0/h0.s1/h0.s2 覆盖 ORIG 全文） */
function mkSession(): DiffSession {
  return {
    sessionId: 's1',
    sourceKind: 'selection',
    baseDocSnapshot: ORIG,
    hunks: [{
      id: 'h0',
      kind: 'MATCH',
      modText: 'AAA1 BBB2 CCC3',
      sub: [
        { id: 'h0.s0', parentId: 'h0', origRange: { from: 0, to: 3 }, origText: 'AAA', modText: 'AAA1' },
        { id: 'h0.s1', parentId: 'h0', origRange: { from: 4, to: 7 }, origText: 'BBB', modText: 'BBB2' },
        { id: 'h0.s2', parentId: 'h0', origRange: { from: 8, to: 11 }, origText: 'CCC', modText: 'CCC3' },
      ],
      decision: 'pending',
    }],
    decisions: {},
  }
}

function renderEditor(
  content: string,
  onChange?: (content: string) => void,
  filePath?: string,
): { container: HTMLElement } {
  const container = document.createElement('div')
  container.style.width = '800px'
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<CodeMirrorEditor content={content} onChange={onChange} filePath={filePath} />) })
  return { container }
}

function getView(container: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(container)
  expect(view).toBeTruthy()
  return view as unknown as EditorView
}

/** 模拟用户一次输入（键入等价事务；显式 time 拉开间隔防 history 分组干扰） */
function userInput(view: EditorView, text: string, time: number): void {
  act(() => {
    view.dispatch({
      changes: { from: view.state.doc.length, insert: text },
      annotations: [Transaction.time.of(time)],
    })
  })
}

/** 会话前置：清 store → 开 tab → 注入 inlineSession（tabId 即 filePath） */
function seedSession(filePath: string) {
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useEditorStore.getState().openFile({ id: filePath, name: 'd', type: 'chapter', filePath, content: ORIG })
  useEditorStore.getState().beginInlineSession(filePath, mkSession())
}

/** 会话同步 effect 在 commit 后 dispatch setHunkRanges；等一帧保证 field 就位 */
async function flushSessionSync(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

/** 在 CM 正文上触发一次真实 DOM click（React 委托到组件 onClick） */
function clickContent(container: HTMLElement): void {
  const contentDOM = container.querySelector('.cm-content')
  expect(contentDOM).toBeTruthy()
  act(() => {
    contentDOM?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function fieldOf(view: EditorView) {
  return view.state.field(inlineAcceptField)
}

function findButton(container: HTMLElement, actKey: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-act="${actKey}"]`)
}

function clickButton(container: HTMLElement, actKey: string): void {
  const btn = findButton(container, actKey)
  expect(btn).toBeTruthy()
  act(() => { btn?.click() })
}

function storeSession(filePath: string): DiffSession | undefined {
  return useEditorStore.getState().tabs.find(t => t.id === filePath)?.inlineSession
}

afterEach(() => {
  roots.forEach(r => act(() => r.unmount()))
  roots.length = 0
  document.body.innerHTML = ''
  useEditorStore.setState({ tabs: [], activeTabId: null })
})

// ===== 契约：undo 事务 / 标注 / 零影响（无需会话，纯编辑器） =====

describe('CodeMirrorEditor inline 会话（Task 4）', () => {
  it('无会话时零影响（默认关闭回归）：普通输入不变、field 空、无浮条/装饰', () => {
    const onChange = vi.fn()
    const { container } = renderEditor('old text', onChange)
    const view = getView(container)
    expect(fieldOf(view).ranges).toHaveLength(0)
    expect(container.querySelector('.nf-ia-bar')).toBeFalsy()
    expect(container.querySelector('.nf-ia-pending')).toBeFalsy()
    userInput(view, 'X', 1000)
    expect(view.state.doc.toString()).toBe('old textX')
    expect(onChange).toHaveBeenLastCalledWith('old textX')
  })

  it('接受 = 独立事务：3 次接受 → 3 次 Ctrl+Z 逐步还原（R4 显式 time 防合并）', () => {
    const { container } = renderEditor(ORIG)
    const view = getView(container)
    // 每次接受前用 indexOf 取当前 doc 坐标（生产路径由 field 映射 + derive 处理，
    // 本用例只验证 dispatchAcceptChange 的事务语义：独立递增 time → undo 逐句还原）
    let t = 5000
    const applyNext = (needle: string, insert: string) => {
      const from = view.state.doc.toString().indexOf(needle)
      expect(from).toBeGreaterThanOrEqual(0)
      act(() => { dispatchAcceptChange(view, { from, to: from + needle.length }, insert, t++) })
    }
    applyNext('AAA', 'AAA1')
    applyNext('BBB', 'BBB2')
    applyNext('CCC', 'CCC3')
    expect(view.state.doc.toString()).toBe('AAA1 BBB2 CCC3')
    act(() => { undo(view) }) // 撤销第 3 次接受
    expect(view.state.doc.toString()).toBe('AAA1 BBB2 CCC')
    act(() => { undo(view) }) // 撤销第 2 次接受
    expect(view.state.doc.toString()).toBe('AAA1 BBB CCC')
    act(() => { undo(view) }) // 撤销第 1 次接受
    expect(view.state.doc.toString()).toBe(ORIG)
  })

  it('dispatchAcceptChange 事务带显式 time 与 INLINE_ACCEPT_EVENT 标注（供 handleUpdate 区分自身接受）', () => {
    const { container } = renderEditor(ORIG)
    const view = getView(container)
    const origDispatch = view.dispatch.bind(view)
    const spy = vi.fn((...specs: Parameters<EditorView['dispatch']>) => origDispatch(...specs))
    view.dispatch = spy as never
    const from = view.state.doc.toString().indexOf('AAA')
    dispatchAcceptChange(view, { from, to: from + 3 }, 'AAA1', 7000)
    expect(spy).toHaveBeenCalledTimes(1)
    const spec = spy.mock.calls[0][0] as { annotations?: ReadonlyArray<{ value?: unknown }> }
    const anns = spec.annotations ?? []
    expect(anns.some(a => a.value === 7000)).toBe(true)                 // 显式递增 time（R4）
    expect(anns.some(a => a.value === INLINE_ACCEPT_EVENT)).toBe(true)   // userEvent 标注
    expect(view.state.doc.toString()).toBe('AAA1 BBB CCC')
  })
})

// ===== 模块单元：derive / field effect / changeFilter（无组件，state 级） =====

describe('codemirror-inline-accept 模块（Task 4）', () => {
  it('deriveRangesFromDoc：按 doc 序 indexOf 定位 pending/rejected；跳过 accepted 与找不到的文本', () => {
    const session = mkSession()
    session.decisions = { 'h0.s1': 'accepted', 'h0.s2': 'rejected' }
    // 追加一个 doc 中不存在的子句（手动/历史改动已移除该文本 → 不装饰）
    ;(session.hunks[0].sub as SubHunk[]).push({
      id: 'h0.s3', parentId: 'h0', origRange: { from: 12, to: 18 }, origText: 'ZZZ  ', modText: 'Z1',
    })
    const ranges = deriveRangesFromDoc(session, ORIG)
    expect(ranges).toEqual([
      { id: 'h0.s0', decision: 'pending', from: 0, to: 3 },
      { id: 'h0.s2', decision: 'rejected', from: 8, to: 11 },
    ])
  })

  it('setHunkRanges effect 驱动 field ranges/deco；接受事务后区间随 doc 平移', () => {
    const state = EditorState.create({ doc: ORIG, extensions: inlineAcceptExtensions() })
    const seeded = state.update({ effects: setHunkRanges.of(deriveRangesFromDoc(mkSession(), ORIG)) }).state
    const field = seeded.field(inlineAcceptField)
    expect(field.ranges).toHaveLength(3)
    expect(field.deco.size).toBe(3)
    // 模拟一次接受事务（带标注与显式 time）
    const accepted = seeded.update({
      changes: { from: 0, to: 3, insert: 'AAA1' },
      annotations: [Transaction.time.of(5000), Transaction.userEvent.of(INLINE_ACCEPT_EVENT)],
    }).state
    expect(accepted.doc.toString()).toBe('AAA1 BBB CCC')
    const mapped = accepted.field(inlineAcceptField).ranges
    // h0.s0 的区间被其自身替换事务映射后仍保留（生产路径由会话 effect 重 derive 清除 accepted）
    const s1 = mapped.find(r => r.id === 'h0.s1')
    expect(s1?.from).toBe(5)
    expect(s1?.to).toBe(8)
    expect(mapped.find(r => r.id === 'h0.s2')).toMatchObject({ from: 9, to: 12 })
  })

  it('changeFilter：pending 区间内 CM 输入被整笔拦截；区间外放行；undo 类事务（无输入 userEvent）不拦', () => {
    const state = EditorState.create({ doc: ORIG, extensions: inlineAcceptExtensions() })
    const seeded = state.update({ effects: setHunkRanges.of(deriveRangesFromDoc(mkSession(), ORIG)) }).state
    const type = (st: EditorState, from: number, insert: string, userEvent: string) =>
      st.update({
        changes: { from, to: from, insert },
        annotations: [Transaction.time.of(6000), Transaction.userEvent.of(userEvent)],
      }).state

    // 区间内键入（真实 CM 键入带 input.* userEvent）→ 拦截，doc 不变
    const blocked = type(seeded, 2, 'X', 'input.type')
    expect(blocked.doc.toString()).toBe(ORIG)
    // 区间外键入 → 放行（退出语义由组件 handleUpdate 负责）
    const outside = type(seeded, 11, 'X', 'input.type')
    expect(outside.doc.toString()).toBe('AAA BBB CCCX')
    // undo 类事务（无 userEvent，history 生成）落在区间内不拦（接受可被逐步撤销）
    const undoLike = outside.update({
      changes: { from: 11, to: 12, insert: '' },
      annotations: [Transaction.time.of(7000)],
    }).state
    expect(undoLike.doc.toString()).toBe(ORIG)
  })

  it('findPendingRangeAt：命中 pending 区间；accepted 移出后的区间不命中；区间外 null', () => {
    const state = EditorState.create({ doc: ORIG, extensions: inlineAcceptExtensions() })
    const seeded = state.update({ effects: setHunkRanges.of(deriveRangesFromDoc(mkSession(), ORIG)) }).state
    const view = new EditorView({ state: seeded, parent: document.body })
    try {
      expect(findPendingRangeAt(view, 1)?.id).toBe('h0.s0')
      expect(findPendingRangeAt(view, 6)?.id).toBe('h0.s1')
      expect(findPendingRangeAt(view, 3)).toBeNull() // 边界外（AAA 与 BBB 之间的空格）
      expect(findPendingRangeAt(view, 99)).toBeNull()
    } finally {
      view.destroy()
    }
  })
})

// ===== 会话接线：装饰 / 浮条 / 决策驱动 / 冻结 / 手动编辑退出 =====

describe('inline 会话接线（store 注入）', () => {
  it('会话激活：pending 区装饰生效、浮条出现；会话外零装饰（默认关闭回归）', async () => {
    const filePath = 'vela://draft/9'
    seedSession(filePath)
    const { container } = renderEditor(ORIG, undefined, filePath)
    const view = getView(container)
    await flushSessionSync()
    const doc = fieldOf(view)
    expect(doc.ranges.length).toBeGreaterThan(0) // AAA/BBB/CCC 三个 pending 区间
    expect(doc.ranges.every(r => r.decision === 'pending')).toBe(true)
    expect(doc.deco.size).toBe(3)
    expect(container.querySelector('.nf-ia-bar')).toBeTruthy() // 浮条渲染

    // 会话外：不 seed 的新实例 ranges 为空 + 无浮条
    useEditorStore.setState({ tabs: [], activeTabId: null })
    const plain = renderEditor(ORIG)
    expect(fieldOf(getView(plain.container)).ranges).toHaveLength(0)
    expect(plain.container.querySelector('.nf-ia-bar')).toBeFalsy()
  })

  it('pending 区间渲染 nf-ia-pending 装饰 span；接受后剩余区间仍装饰（decoration 驱动）', async () => {
    const filePath = 'vela://draft/9b'
    seedSession(filePath)
    const { container } = renderEditor(ORIG, undefined, filePath)
    const view = getView(container)
    await flushSessionSync()
    const pendingSpans = () => container.querySelectorAll('.nf-ia-pending').length
    // jsdom 无布局：若 CM 不产出可视区装饰 span（deco set 非空但 DOM 未挂），该用例降级为 C1 的 deco 断言
    expect(pendingSpans()).toBeGreaterThan(0)

    act(() => {
      const r = fieldOf(view).ranges.find(x => x.id === 'h0.s0')
      expect(r).toBeTruthy()
      dispatchAcceptChange(view, r!, 'AAA1', 5000)
      useEditorStore.getState().updateHunkDecision(filePath, 'h0.s0', 'accepted')
    })
    await flushSessionSync()
    expect(fieldOf(view).ranges.find(r => r.id === 'h0.s0')).toBeUndefined()
    expect(fieldOf(view).ranges.map(r => r.id)).toEqual(['h0.s1', 'h0.s2'])
    expect(pendingSpans()).toBe(2)
  })

  it('拒绝 = 纯决策态：doc 不变、无新 undo 事件（undo 后仍是原状）、区间决策变 rejected', () => {
    const filePath = 'vela://draft/10'
    seedSession(filePath)
    const { container } = renderEditor(ORIG, undefined, filePath)
    const view = getView(container)
    act(() => {
      useEditorStore.getState().updateHunkDecision(filePath, 'h0.s1', 'rejected')
    })
    expect(view.state.doc.toString()).toBe(ORIG) // 拒绝不产生 doc 事务
    act(() => { undo(view) })
    expect(view.state.doc.toString()).toBe(ORIG) // 无历史事件可撤销
    const ranges = fieldOf(view).ranges
    expect(ranges.find(r => r.id === 'h0.s1')?.decision).toBe('rejected')
  })

  it('手动编辑 pending 区被 changeFilter 拦截（冻结，R6）', () => {
    const filePath = 'vela://draft/11'
    seedSession(filePath)
    const { container } = renderEditor(ORIG, undefined, filePath)
    const view = getView(container)
    // 在 h0.s0（0..3，'AAA'）内输入（真实键入带 input.type userEvent）→ 整笔事务被拦
    act(() => {
      view.dispatch({
        changes: { from: 2, to: 2, insert: 'X' },
        annotations: [Transaction.time.of(6000), Transaction.userEvent.of('input.type')],
      })
    })
    expect(view.state.doc.toString()).toBe(ORIG)
  })

  it('手动编辑 pending 区之外 → 自动退出会话并清空（R6 简化策略）', async () => {
    const filePath = 'vela://draft/12'
    seedSession(filePath)
    const { container } = renderEditor(ORIG, undefined, filePath)
    const view = getView(container)
    await flushSessionSync()
    expect(storeSession(filePath)).toBeTruthy()

    // 在 doc 末尾（pending 区间之外）键入 → 区间外放行 + handleUpdate 退出会话
    act(() => {
      view.dispatch({
        changes: { from: 11, to: 11, insert: 'X' },
        annotations: [Transaction.time.of(6000), Transaction.userEvent.of('input.type')],
      })
    })
    expect(view.state.doc.toString()).toBe('AAA BBB CCCX')
    expect(storeSession(filePath)).toBeUndefined()
    expect(container.querySelector('.nf-ia-bar')).toBeFalsy()
    expect(fieldOf(view).ranges).toHaveLength(0)
  })

  it('程序化改动触碰 pending 区（无 userEvent：Bold/缩进/气泡替换类）→ 退出会话并清空（评审 I1）', async () => {
    const filePath = 'vela://draft/12b'
    seedSession(filePath)
    const { container } = renderEditor(ORIG, undefined, filePath)
    const view = getView(container)
    await flushSessionSync()
    expect(storeSession(filePath)).toBeTruthy()
    expect(fieldOf(view).ranges.length).toBe(3)

    // 模拟 Bold：无 userEvent 的程序化 dispatch 包裹整个 pending 段 'AAA'（0..3）
    // （与 CodeMirrorEditor 加粗按钮同一形态——changeFilter 只拦输入类 userEvent，此改动会真的落 doc）
    act(() => {
      view.dispatch({ changes: { from: 0, to: 3, insert: '**AAA**' } })
    })
    expect(view.state.doc.toString()).toBe('**AAA** BBB CCC') // Bold 确实生效
    expect(storeSession(filePath)).toBeUndefined()            // 触碰 pending 区 → 会话退出（防装饰漂移）
    await flushSessionSync()
    expect(container.querySelector('.nf-ia-bar')).toBeFalsy()
    expect(fieldOf(view).ranges).toHaveLength(0)              // 装饰/冻结清空
  })

  it('程序化改动在 pending 区之外（无 userEvent）→ 不退出（区间触碰判定只关心 pending 内容）', async () => {
    const filePath = 'vela://draft/12c'
    seedSession(filePath)
    const { container } = renderEditor(ORIG, undefined, filePath)
    const view = getView(container)
    await flushSessionSync()
    expect(storeSession(filePath)).toBeTruthy()

    // 模拟在空白/锚句间隙（pos 3，'AAA' 与 'BBB' 之间）无 userEvent 插入：不触碰任何 pending 区间
    act(() => {
      view.dispatch({ changes: { from: 3, to: 3, insert: '-' } })
    })
    expect(view.state.doc.toString()).toBe('AAA- BBB CCC')
    expect(storeSession(filePath)).toBeTruthy() // 会话保留（field 随 doc 平移；浮层仍可裁决）
    expect(container.querySelector('.nf-ia-bar')).toBeTruthy()
  })

  it('撤销自身接受不退出会话（undo/redo 无输入 userEvent，不触发手动编辑退出）', async () => {
    const filePath = 'vela://draft/13'
    seedSession(filePath)
    const { container } = renderEditor(ORIG, undefined, filePath)
    const view = getView(container)
    await flushSessionSync()
    act(() => {
      const r = fieldOf(view).ranges.find(x => x.id === 'h0.s0')
      dispatchAcceptChange(view, r!, 'AAA1', 5000)
      useEditorStore.getState().updateHunkDecision(filePath, 'h0.s0', 'accepted')
    })
    await flushSessionSync()
    expect(view.state.doc.toString()).toBe('AAA1 BBB CCC')
    act(() => { undo(view) }) // 撤销自身接受 → doc 还原但会话保留（决策表不同步为已知限制）
    expect(view.state.doc.toString()).toBe(ORIG)
    expect(storeSession(filePath)).toBeTruthy()
    expect(container.querySelector('.nf-ia-bar')).toBeTruthy()
  })
})

// ===== 浮层 / 浮条交互（DOM 级） =====

describe('inline 接受浮层与浮条交互', () => {
  let coordsSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    coordsSpy = vi.spyOn(EditorView.prototype, 'coordsAtPos')
      .mockReturnValue({ left: 10, top: 10, right: 30, bottom: 24 })
  })

  afterEach(() => {
    coordsSpy.mockRestore()
  })

  it('点击 pending 区段 → 浮层出现（进度 + 改前/改后预览 + 句级 checkbox）；点击非 pending 区关闭', async () => {
    const filePath = 'vela://draft/20'
    seedSession(filePath)
    const { container } = renderEditor(ORIG, undefined, filePath)
    const view = getView(container)
    await flushSessionSync()

    // 光标落进 pending 段 'AAA'（0..3）再触发真实 click
    act(() => { view.dispatch({ selection: { anchor: 1 } }) })
    clickContent(container)
    const popover = container.querySelector('.nf-ia-popover')
    expect(popover).toBeTruthy()
    expect(popover?.textContent ?? '').toContain('第 1/1 处改动')
    // 改前/改后预览（AAA 划除 + AAA1 高亮）
    expect(popover?.textContent ?? '').toContain('改前')
    expect(popover?.textContent ?? '').toContain('改后')
    expect(popover?.textContent ?? '').toContain('AAA')
    expect(popover?.textContent ?? '').toContain('AAA1')
    // 三个子 hunk checkbox
    const checks = container.querySelectorAll<HTMLInputElement>('.nf-ia-sub-check')
    expect(checks.length).toBe(3)
    // 点击非 pending 处（BBB 与 CCC 之间的空格 pos 7 不在任何区间）→ 关闭
    act(() => { view.dispatch({ selection: { anchor: 7 } }) })
    clickContent(container)
    expect(container.querySelector('.nf-ia-popover')).toBeFalsy()
  })

  it('浮层默认勾选点击的子句 → 接受选中 → doc/决策更新、浮层关闭、剩余 pending 装饰与进度更新', async () => {
    const filePath = 'vela://draft/21'
    seedSession(filePath)
    const { container } = renderEditor(ORIG, undefined, filePath)
    const view = getView(container)
    await flushSessionSync()

    // 浮条初始进度 0/3
    expect(container.querySelector('.nf-ia-bar')?.textContent ?? '').toContain('0/3')

    // 点击 pending 'AAA' 段 → 浮层默认勾选该子句
    act(() => { view.dispatch({ selection: { anchor: 1 } }) })
    clickContent(container)
    const checkAAA = container.querySelector<HTMLInputElement>('input.nf-ia-sub-check[data-sub-id="h0.s0"]')
    expect(checkAAA).toBeTruthy()
    expect(checkAAA?.checked).toBe(true) // 默认勾选点击目标（句级快速接受路径）
    clickButton(container, 'pv-accept-selected')

    expect(view.state.doc.toString()).toBe('AAA1 BBB CCC')
    expect(storeSession(filePath)?.decisions['h0.s0']).toBe('accepted')
    expect(container.querySelector('.nf-ia-popover')).toBeFalsy() // 接受后关闭浮层
    expect(fieldOf(view).ranges.map(r => r.id)).toEqual(['h0.s1', 'h0.s2'])
    expect(container.querySelector('.nf-ia-bar')?.textContent ?? '').toContain('1/3')

    // 再开浮层于 BBB：取消默认勾选 → 接受选中禁用；关闭不改 doc
    act(() => { view.dispatch({ selection: { anchor: 5 } }) })
    clickContent(container)
    expect(container.querySelector('.nf-ia-popover')).toBeTruthy()
    const checkBBB = container.querySelector<HTMLInputElement>('input.nf-ia-sub-check[data-sub-id="h0.s1"]')
    expect(checkBBB?.checked).toBe(true)
    act(() => { checkBBB?.click() }) // 取消勾选
    const acceptBtn = findButton(container, 'pv-accept-selected')
    expect((acceptBtn as HTMLButtonElement | null)?.disabled).toBe(true)
    clickButton(container, 'pv-close')
    expect(container.querySelector('.nf-ia-popover')).toBeFalsy()
    expect(view.state.doc.toString()).toBe('AAA1 BBB CCC')
  })

  it('浮条 全部接受 → 逐句独立事务（3 步 undo 还原）；完成 → 会话清空', async () => {
    const filePath = 'vela://draft/22'
    seedSession(filePath)
    const { container } = renderEditor(ORIG, undefined, filePath)
    const view = getView(container)
    await flushSessionSync()

    clickButton(container, 'accept-all')
    expect(view.state.doc.toString()).toBe('AAA1 BBB2 CCC3')
    const decisions = storeSession(filePath)?.decisions
    expect(decisions).toMatchObject({ 'h0.s0': 'accepted', 'h0.s1': 'accepted', 'h0.s2': 'accepted' })
    expect(container.querySelector('.nf-ia-bar')?.textContent ?? '').toContain('3/3')

    // 全部接受 = 逐个独立事务 → 3 步 Ctrl+Z 逐步还原
    act(() => { undo(view) })
    expect(view.state.doc.toString()).toBe('AAA1 BBB2 CCC')
    act(() => { undo(view) })
    expect(view.state.doc.toString()).toBe('AAA1 BBB CCC')
    act(() => { undo(view) })
    expect(view.state.doc.toString()).toBe(ORIG)

    // 完成 → finishSelectionSession（Task 5：async 收尾链）+ endInlineSession：
    // 浮条/装饰消失、field 清空（已接受文本保留在 doc）。ipc 顶层 mock 使链同步落定。
    clickButton(container, 'finish')
    await flushSessionSync()
    expect(storeSession(filePath)).toBeUndefined()
    expect(container.querySelector('.nf-ia-bar')).toBeFalsy()
    expect(fieldOf(view).ranges).toHaveLength(0)
    expect(view.state.doc.toString()).toBe(ORIG)
  })
})

// ===== A 入口收尾落库链（Task 5）：finishSelectionSession 白盒（mock ipc-client） =====
// A 入口可测契约拆两层（brief Step 2）：① buildSelectionSession 纯函数全测在
// selection-session.test.ts；② 收尾落库链在此白盒断言调用序列。「点击流式按钮进入
// 会话」依赖真实 LLM/状态机，jsdom 不可达——由 Task 6 人工 QA（验收 1/2）覆盖。

describe('A 收尾落库链 finishSelectionSession（Task 5）', () => {
  const resetInvoke = () => {
    const invoke = vi.mocked(ipc.invoke)
    invoke.mockClear()
    invoke.mockImplementation(async (...args: unknown[]) => {
      const ch = String(args[0])
      if (ch === 'db:revision-get-pending') return []
      if (ch === 'db:revision-next-index') return 0
      return {}
    })
  }

  beforeEach(resetInvoke)

  it('A 收尾：完成会话 → 旧 pending 清理 + revision-create 恰一次；正文不在此落库（验收 4）', async () => {
    const invoke = vi.mocked(ipc.invoke)
    invoke.mockImplementation(async (...args: unknown[]) => {
      const ch = String(args[0])
      if (ch === 'db:revision-get-pending') return [{ id: 1 }, { id: 2 }] // 两条旧 pending（R9 要清理）
      if (ch === 'db:revision-next-index') return 3
      if (ch === 'db:revision-mark-discarded') return { success: true }
      if (ch === 'db:revision-create') return { success: true, id: 9 }
      return {}
    })
    const filePath = 'vela://draft/12'
    const doc = '雨下了一整夜。\n天亮了。\n她推开窗。'
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useEditorStore.getState().openFile({ id: filePath, name: 'd', type: 'chapter', filePath, content: doc })
    useEditorStore.getState().beginInlineSession(filePath, mkSession())
    useEditorStore.getState().updateHunkDecision(filePath, 'h0.s1', 'accepted')
    // finishSelectionSession 以导出纯异步函数白盒调用（组件浮条 onFinish 接线同一函数）
    const { finishSelectionSession } = await import('./CodeMirrorEditor')
    await act(async () => {
      await finishSelectionSession(filePath, useEditorStore.getState().tabs.find(t => t.id === filePath)!.content!)
    })
    const calls = invoke.mock.calls.map(c => String(c[0]))
    expect(calls.filter(c => c === 'db:revision-mark-discarded')).toHaveLength(2)
    expect(calls.filter(c => c === 'db:revision-create')).toHaveLength(1)
    expect(calls.indexOf('db:revision-mark-discarded')).toBeLessThan(calls.indexOf('db:revision-create'))
    const createArg = invoke.mock.calls.find(c => String(c[0]) === 'db:revision-create')![1] as { content: string; revisionType: string }
    expect(createArg.content).toBe(doc) // content = 会话最终 doc 实况
    expect(createArg.revisionType).toBe('refine')
    expect(useEditorStore.getState().tabs.find(t => t.id === filePath)!.inlineSession).toBeUndefined()
  })

  it('无接受（全部 pending/拒绝）→ 不落 revision、会话结束（拒绝无 revision）', async () => {
    const invoke = vi.mocked(ipc.invoke)
    const filePath = 'vela://draft/13'
    const doc = '雨下了一整夜。\n天亮了。'
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useEditorStore.getState().openFile({ id: filePath, name: 'd', type: 'chapter', filePath, content: doc })
    useEditorStore.getState().beginInlineSession(filePath, mkSession())
    useEditorStore.getState().updateHunkDecision(filePath, 'h0.s0', 'rejected')
    useEditorStore.getState().updateHunkDecision(filePath, 'h0.s1', 'rejected')
    useEditorStore.getState().updateHunkDecision(filePath, 'h0.s2', 'rejected')
    const { finishSelectionSession } = await import('./CodeMirrorEditor')
    await act(async () => { await finishSelectionSession(filePath, doc) })
    const calls = invoke.mock.calls.map(c => String(c[0]))
    expect(calls.some(c => c.startsWith('db:revision-'))).toBe(false)
    expect(useEditorStore.getState().tabs.find(t => t.id === filePath)!.inlineSession).toBeUndefined()
  })

  it('非 vela://draft 宿主完成 → 仅关会话，零 db:revision 侧链', async () => {
    const invoke = vi.mocked(ipc.invoke)
    const filePath = '/mnt/notes/raw.md'
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useEditorStore.getState().openFile({ id: filePath, name: 'raw', type: 'chapter', filePath, content: ORIG })
    useEditorStore.getState().beginInlineSession(filePath, mkSession())
    useEditorStore.getState().updateHunkDecision(filePath, 'h0.s0', 'accepted')
    const { finishSelectionSession } = await import('./CodeMirrorEditor')
    await act(async () => { await finishSelectionSession(filePath, 'AAA1 BBB CCC') })
    expect(invoke).not.toHaveBeenCalled()
    expect(useEditorStore.getState().tabs.find(t => t.id === filePath)!.inlineSession).toBeUndefined()
  })

  // ===== 评审 I-1 修复（round 1）：收尾重入防护（per-session in-flight + 会话身份 end） =====

  it('重入防护：并发/重复 finish 调用只跑一条收尾链——get-pending/mark-discarded/create 各一套（I-1 双击不变量）', async () => {
    const invoke = vi.mocked(ipc.invoke)
    invoke.mockImplementation(async (...args: unknown[]) => {
      const ch = String(args[0])
      if (ch === 'db:revision-get-pending') return [{ id: 1 }, { id: 2 }]
      if (ch === 'db:revision-next-index') return 3
      if (ch === 'db:revision-mark-discarded') return { success: true }
      if (ch === 'db:revision-create') return { success: true, id: 9 }
      return {}
    })
    const filePath = 'vela://draft/31'
    const doc = '雨下了一整夜。\n天亮了。\n她推开窗。'
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useEditorStore.getState().openFile({ id: filePath, name: 'd', type: 'chapter', filePath, content: doc })
    useEditorStore.getState().beginInlineSession(filePath, mkSession())
    useEditorStore.getState().updateHunkDecision(filePath, 'h0.s1', 'accepted')
    const { finishSelectionSession } = await import('./CodeMirrorEditor')
    // 同一会话的两次 finish 并发（双击「完成」的等价形态：两链都在旧链 finally 前启动）
    await act(async () => {
      await Promise.all([
        finishSelectionSession(filePath, doc),
        finishSelectionSession(filePath, doc),
      ])
    })
    const calls = invoke.mock.calls.map(c => String(c[0]))
    expect(calls.filter(c => c === 'db:revision-get-pending')).toHaveLength(1) // 第二条链被 in-flight 挡掉
    expect(calls.filter(c => c === 'db:revision-mark-discarded')).toHaveLength(2)
    expect(calls.filter(c => c === 'db:revision-create')).toHaveLength(1) // R9：双击也只产生一条 pending refine
    expect(useEditorStore.getState().tabs.find(t => t.id === filePath)!.inlineSession).toBeUndefined()
  })

  it('浮条双击「完成」→ 仅一条收尾链（I-1 UI 路径：按钮重复点击不产生第二链）', async () => {
    const filePath = 'vela://draft/33'
    seedSession(filePath)
    const { container } = renderEditor(ORIG, undefined, filePath)
    const view = getView(container)
    await flushSessionSync()
    useEditorStore.getState().updateHunkDecision(filePath, 'h0.s0', 'accepted')
    // 双击：同一 act tick 内连点两次——第二条点击在旧链 finally 清会话前到达（bar 仍挂载），
    // 必须被 in-flight 挡掉（若分两次 act，第一次点击的 flush 已把链跑完并卸 bar，非双击形态）
    act(() => {
      const btn = findButton(container, 'finish')
      expect(btn).toBeTruthy()
      btn?.click()
      btn?.click()
    })
    await flushSessionSync()
    const calls = vi.mocked(ipc.invoke).mock.calls.map(c => String(c[0]))
    expect(calls.filter(c => c === 'db:revision-get-pending')).toHaveLength(1)
    expect(calls.filter(c => c === 'db:revision-create')).toHaveLength(1)
    expect(storeSession(filePath)).toBeUndefined()
    expect(container.querySelector('.nf-ia-bar')).toBeFalsy()
    expect(fieldOf(view).ranges).toHaveLength(0)
  })

  it('收尾 in-flight 中新会话接管 → 旧链 finally 不清新会话（I-1 会话身份 end）', async () => {
    const invoke = vi.mocked(ipc.invoke)
    let releasePending!: (value: unknown[]) => void
    invoke.mockImplementation(async (...args: unknown[]) => {
      const ch = String(args[0])
      if (ch === 'db:revision-get-pending') {
        // 挂起旧链，模拟 IPC round-trip 窗口
        return new Promise<unknown[]>(res => { releasePending = res })
      }
      if (ch === 'db:revision-next-index') return 0
      if (ch === 'db:revision-create') return { success: true, id: 1 }
      return {}
    })
    const filePath = 'vela://draft/32'
    const doc = '雨下了一整夜。\n天亮了。'
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useEditorStore.getState().openFile({ id: filePath, name: 'd', type: 'chapter', filePath, content: doc })
    useEditorStore.getState().beginInlineSession(filePath, mkSession()) // sessionId 's1'
    useEditorStore.getState().updateHunkDecision(filePath, 'h0.s0', 'accepted')
    const { finishSelectionSession } = await import('./CodeMirrorEditor')
    let chain!: Promise<void>
    await act(async () => { chain = finishSelectionSession(filePath, doc) }) // 挂起在 get-pending
    // 窗口期内用户开启新会话（另一轮「应用为修改建议」beginInlineSession 覆盖）
    const takeover = { ...mkSession(), sessionId: 's2' }
    await act(async () => { useEditorStore.getState().beginInlineSession(filePath, takeover) })
    await act(async () => {
      releasePending([]) // 旧链收尾完成（旧链 finally 执行 endSessionIfSame）
      await chain
    })
    expect(useEditorStore.getState().tabs.find(t => t.id === filePath)!.inlineSession?.sessionId).toBe('s2')
  })

  it('legacy vela://draft/ch{n}（非数字 id）→ 不建 revision、仅关会话（M-1 防 NaN 入参）', async () => {
    const invoke = vi.mocked(ipc.invoke)
    const filePath = 'vela://draft/ch5'
    const doc = 'AAA BBB CCC'
    useEditorStore.setState({ tabs: [], activeTabId: null })
    useEditorStore.getState().openFile({ id: filePath, name: 'd', type: 'chapter', filePath, content: doc })
    useEditorStore.getState().beginInlineSession(filePath, mkSession())
    useEditorStore.getState().updateHunkDecision(filePath, 'h0.s1', 'accepted')
    const { finishSelectionSession } = await import('./CodeMirrorEditor')
    await act(async () => { await finishSelectionSession(filePath, doc) })
    expect(invoke).not.toHaveBeenCalled() // NaN 不进入 db:revision-* 查询
    expect(useEditorStore.getState().tabs.find(t => t.id === filePath)!.inlineSession).toBeUndefined()
  })
})
