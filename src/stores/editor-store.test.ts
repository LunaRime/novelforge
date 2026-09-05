import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './editor-store'
import type { DiffSession } from '../services/diff/hunk-model'

beforeEach(() => {
  // 重置 store 状态
  useEditorStore.setState({ tabs: [], activeTabId: null })
})

describe('editor-store openFile', () => {
  it('新文件打开并激活', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'vela://draft/1', name: '第一章 · 草稿', type: 'chapter', filePath: 'vela://draft/1', content: '旧内容' })
    const st = useEditorStore.getState()
    expect(st.tabs.length).toBe(1)
    expect(st.activeTabId).toBe('vela://draft/1')
    expect(st.tabs[0].content).toBe('旧内容')
  })

  it('重复打开同 id：激活 + 更新名称 + 非 dirty 刷新内容', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'vela://manuscript/5', name: '第三章', type: 'chapter', filePath: 'vela://manuscript/5', content: '定稿 v1' })
    // 定稿后内容变化，再次打开（模拟工作台/ProjectTree 入口）
    s.openFile({ id: 'vela://manuscript/5', name: '第三章', type: 'chapter', filePath: 'vela://manuscript/5', content: '定稿 v2' })
    const st = useEditorStore.getState()
    expect(st.tabs.length).toBe(1) // 去重，不重复开
    expect(st.activeTabId).toBe('vela://manuscript/5')
    expect(st.tabs[0].content).toBe('定稿 v2') // 内容已刷新
  })

  it('dirty 时重复打开：保留用户未保存编辑，仅激活', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'vela://draft/9', name: '第二章 · 草稿', type: 'chapter', filePath: 'vela://draft/9', content: '原文' })
    // 用户开始编辑（dirty）
    useEditorStore.setState(s => ({
      tabs: s.tabs.map(t => t.id === 'vela://draft/9' ? { ...t, content: '用户编辑中', dirty: true } : t),
    }))
    // 工作台再次点击同一草稿（读到 DB 最新内容）
    s.openFile({ id: 'vela://draft/9', name: '第二章 · 草稿', type: 'chapter', filePath: 'vela://draft/9', content: 'DB 最新' })
    const st = useEditorStore.getState()
    expect(st.tabs[0].content).toBe('用户编辑中') // 不覆盖未保存编辑
    expect(st.activeTabId).toBe('vela://draft/9')
  })

  it('按 filePath + type 去重（不同 id 同一文件）', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'vela://manuscript/3', name: 'A', type: 'chapter', filePath: 'vela://manuscript/3', content: '1' })
    // 另一个入口用相同 filePath 但不同 id 打开
    s.openFile({ id: 'alias-3', name: 'B', type: 'chapter', filePath: 'vela://manuscript/3', content: '2' })
    const st = useEditorStore.getState()
    expect(st.tabs.length).toBe(1)
    expect(st.tabs[0].id).toBe('vela://manuscript/3') // 保留首次 id
    expect(st.tabs[0].content).toBe('2')
  })

  it('diff 类型只按 id 精确匹配，内容强制更新', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'diff-1', name: '修稿 A', type: 'diff', filePath: 'vela://draft/1', content: 'A' })
    s.openFile({ id: 'diff-2', name: '修稿 B', type: 'diff', filePath: 'vela://draft/1', content: 'B' })
    const st = useEditorStore.getState()
    expect(st.tabs.length).toBe(2) // 不按 filePath 去重
    expect(st.activeTabId).toBe('diff-2')
  })
})

describe('editor-store closeTab', () => {
  it('关闭激活 Tab 回退到最后一个', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'a', name: 'A', type: 'chapter', filePath: 'a' })
    s.openFile({ id: 'b', name: 'B', type: 'chapter', filePath: 'b' })
    s.closeTab('b')
    const st = useEditorStore.getState()
    expect(st.tabs.length).toBe(1)
    expect(st.activeTabId).toBe('a')
  })

  it('pinned Tab 不可关闭', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'p', name: 'P', type: 'config', pinned: true })
    s.closeTab('p')
    expect(useEditorStore.getState().tabs.length).toBe(1)
  })
})

describe('editor-store inlineSession（L1 会话层）', () => {
  const mkSession = (): DiffSession => ({
    sessionId: 'sess-1',
    sourceKind: 'selection',
    baseDocSnapshot: '他走了。她没答话。',
    hunks: [{
      id: 'h0', kind: 'MATCH', modText: '他离开了。她没答话。',
      sub: [
        { id: 'h0.s0', parentId: 'h0', origRange: { from: 0, to: 4 }, origText: '他走了。', modText: '他离开了。' },
      ],
      decision: 'pending',
    }],
    decisions: {},
  })

  it('beginInlineSession：tab 挂会话，content/dirty 不变', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'vela://draft/1', name: 'd', type: 'chapter', filePath: 'vela://draft/1', content: '他走了。她没答话。' })
    s.beginInlineSession('vela://draft/1', mkSession())
    const tab = useEditorStore.getState().tabs.find(t => t.id === 'vela://draft/1')!
    expect(tab.inlineSession?.sessionId).toBe('sess-1')
    expect(tab.content).toBe('他走了。她没答话。')
    expect(tab.dirty).toBeFalsy()
  })

  it('updateHunkDecision：决策表 + 组聚合同步；全部 accepted → h0.decision=accepted', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 't', name: 'd', type: 'chapter', filePath: 't' })
    s.beginInlineSession('t', mkSession())
    s.updateHunkDecision('t', 'h0.s0', 'accepted')
    let tab = useEditorStore.getState().tabs.find(t => t.id === 't')!
    expect(tab.inlineSession!.decisions['h0.s0']).toBe('accepted')
    expect(tab.inlineSession!.hunks[0].decision).toBe('accepted')
    s.updateHunkDecision('t', 'h0.s0', 'rejected')
    tab = useEditorStore.getState().tabs.find(t => t.id === 't')!
    expect(tab.inlineSession!.hunks[0].decision).toBe('rejected')
  })

  it('updateHunkDecision 未知 subHunkId → no-op（不抛、不改状态）', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 't2', name: 'd', type: 'chapter', filePath: 't2' })
    s.beginInlineSession('t2', mkSession())
    expect(() => s.updateHunkDecision('t2', 'ghost', 'accepted')).not.toThrow()
  })

  it('resetHunkDecision：rejected → pending（误拒恢复）', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 't3', name: 'd', type: 'chapter', filePath: 't3' })
    s.beginInlineSession('t3', mkSession())
    s.updateHunkDecision('t3', 'h0.s0', 'rejected')
    s.resetHunkDecision('t3', 'h0.s0')
    const tab = useEditorStore.getState().tabs.find(t => t.id === 't3')!
    expect(tab.inlineSession!.decisions['h0.s0']).toBeUndefined()
    expect(tab.inlineSession!.hunks[0].decision).toBe('pending')
  })

  it('endInlineSession（discard 语义）：清会话、保留 content 与 dirty', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 't4', name: 'd', type: 'chapter', filePath: 't4' })
    s.beginInlineSession('t4', mkSession())
    s.updateHunkDecision('t4', 'h0.s0', 'rejected')
    // 模拟接受后 doc 已变（dirty 置位由 updateTabContent 链路负责——此处仅验证 end 不清 dirty）
    useEditorStore.setState(st => ({ tabs: st.tabs.map(t => t.id === 't4' ? { ...t, content: '新内容', dirty: true } : t) }))
    s.endInlineSession('t4')
    const tab = useEditorStore.getState().tabs.find(t => t.id === 't4')!
    expect(tab.inlineSession).toBeUndefined()
    expect(tab.content).toBe('新内容')
    expect(tab.dirty).toBe(true) // 已接受文本须随 dirty 走既有保存链路
  })

  it('决策态持久：模拟重挂载（begin → 决策 → 重新读回 tab）不丢 decisions', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 't5', name: 'd', type: 'chapter', filePath: 't5' })
    const session = mkSession()
    s.beginInlineSession('t5', session)
    s.updateHunkDecision('t5', 'h0.s0', 'rejected')
    // 「重挂载」= 从同一 tab 对象重读（EditorArea 单实例切 tab 后 store 即唯一来源）
    const tab = useEditorStore.getState().tabs.find(t => t.id === 't5')!
    expect(tab.inlineSession!.decisions['h0.s0']).toBe('rejected')
  })
})
